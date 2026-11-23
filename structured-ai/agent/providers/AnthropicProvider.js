"use strict";

/*
|--------------------------------------------------------------------------
| Anthropic Messages API (roadmap P1-1)
|--------------------------------------------------------------------------
|
| POST {baseUrl}/v1/messages with x-api-key and anthropic-version.
|
|   system/developer messages  -> system blocks
|   assistant tool_calls       -> tool_use blocks
|   tool results               -> tool_result blocks in a user turn
|   image parts                -> image blocks (base64 or url)
|
| Consecutive turns of the same role are merged (the API requires
| alternation) and empty text blocks are dropped (the API rejects them).
| With promptCaching the system prompt and the tool list end in an
| ephemeral cache_control breakpoint, so the long, stable prefix is read
| from cache on the following iterations. countTokens uses
| /v1/messages/count_tokens.
|--------------------------------------------------------------------------
*/

const { LLMProvider } = require("./LLMProvider");
const { ProviderError } = require("./ProviderError");
const { readSse, parseEventData } = require("./StreamReaders");
const { estimateRequestTokens } = require("./TokenCounter");
const {
    partsOf,
    textOf,
    systemText,
    toolCallsOf,
    toolDeclarations,
    argumentsObject,
    chatResponse,
    makeUsage
} = require("./Messages");


function imageBlock(part) {

    if (part.data) {
        return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } };
    }

    return { type: "image", source: { type: "url", url: part.url } };
}


function messagesOf(messages) {

    const out = [];

    const push = (role, blocks) => {

        if (blocks.length === 0) {
            return;
        }

        const last = out[out.length - 1];

        if (last && last.role === role) {
            last.content.push(...blocks);
        } else {
            out.push({ role, content: blocks });
        }
    };

    for (const message of messages) {

        if (!message || message.role === "system" || message.role === "developer") {
            continue;
        }

        if (message.role === "tool") {

            push("user", [{
                type: "tool_result",
                tool_use_id: message.tool_call_id,
                content: textOf(message.content) || "(no output)"
            }]);

            continue;
        }

        const blocks =
            partsOf(message.content)
                .filter(part => part.type !== "text" || part.text !== "")
                .map(part => (part.type === "text" ? { type: "text", text: part.text } : imageBlock(part)));

        if (message.role === "assistant") {

            for (const call of toolCallsOf(message)) {
                blocks.push({ type: "tool_use", id: call.id, name: call.name, input: argumentsObject(call.arguments) });
            }

            push("assistant", blocks.filter(block => block.type !== "image"));

            continue;
        }

        push("user", blocks);
    }

    if (out.length > 0 && out[0].role !== "user") {
        out.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
    }

    return out;
}


function finishOf(reason) {

    if (reason === "max_tokens") {
        return "length";
    }

    if (reason === "tool_use") {
        return "tool_calls";
    }

    return reason ? "stop" : null;
}


function usageOf(usage) {

    const value = usage || {};

    const cacheRead = Number(value.cache_read_input_tokens) || 0;
    const cacheWrite = Number(value.cache_creation_input_tokens) || 0;

    return makeUsage({
        input: (Number(value.input_tokens) || 0) + cacheRead + cacheWrite,
        output: value.output_tokens,
        cached: cacheRead
    });
}


class AnthropicProvider extends LLMProvider {

    defaultBaseUrl() {
        return "https://api.anthropic.com";
    }


    capabilities() {

        return {
            streaming: true,
            tools: true,
            vision: true,
            promptCaching: "explicit",
            tokenCount: "native",
            responseFormat: false
        };
    }


    headersOf(stream) {

        return {
            ...this.jsonHeaders(stream),
            "x-api-key": this.apiKey,
            "anthropic-version": this.spec.version || "2023-06-01",
            ...this.headers
        };
    }


    shared(request) {

        const body = { model: request.model, messages: messagesOf(request.messages) };

        const system = systemText(request.messages);

        if (system) {

            body.system = [
                this.promptCaching
                    ? { type: "text", text: system, cache_control: { type: "ephemeral" } }
                    : { type: "text", text: system }
            ];
        }

        const tools = toolDeclarations(request.tools);

        if (tools.length > 0) {

            body.tools = tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters
            }));

            if (this.promptCaching) {
                body.tools[body.tools.length - 1].cache_control = { type: "ephemeral" };
            }
        }

        return body;
    }


    body(request, stream) {

        const body = this.shared(request);

        /* max_tokens is required by this API */
        body.max_tokens =
            request.maxTokens > 0
                ? request.maxTokens
                : Number(this.spec.maxTokens) > 0
                    ? Number(this.spec.maxTokens)
                    : 8192;

        if (request.temperature !== undefined) {
            body.temperature = Math.min(1, request.temperature);
        }

        if (stream) {
            body.stream = true;
        }

        return body;
    }


    buildHttp(request, stream) {

        return {
            url: `${this.requireBaseUrl()}/v1/messages`,
            headers: this.headersOf(stream),
            body: JSON.stringify(this.body(request, stream))
        };
    }


    parseResponse(body, request) {

        if (body && body.type === "error") {
            throw ProviderError.fromBody(this.name, body);
        }

        if (!body || !Array.isArray(body.content)) {

            throw new ProviderError(
                `${this.name} answered without content blocks`,
                { provider: this.name, code: "invalid_response", retryable: false }
            );
        }

        const texts = [];
        const calls = [];

        for (const block of body.content) {

            if (block.type === "text") {
                texts.push(block.text || "");
            } else if (block.type === "tool_use") {
                calls.push({ id: block.id, name: block.name, arguments: block.input || {} });
            }
        }

        return chatResponse({
            id: body.id,
            model: body.model || request.model,
            provider: this.name,
            text: texts.join(""),
            toolCalls: calls,
            finishReason: finishOf(body.stop_reason),
            usage: usageOf(body.usage)
        });
    }


    async readStream(response, request, onDelta) {

        let id = null;
        let model = request.model;
        let stop = null;
        let usage = {};

        const blocks = [];

        for await (const event of readSse(response.body)) {

            const data = parseEventData(event);

            if (!data) {
                continue;
            }

            const type = data.type || event.event;

            if (type === "message_start" && data.message) {

                id = data.message.id || id;
                model = data.message.model || model;
                usage = { ...usage, ...(data.message.usage || {}) };

            } else if (type === "content_block_start") {

                const block = data.content_block || {};

                blocks[data.index] = {
                    type: block.type,
                    id: block.id,
                    name: block.name,
                    text: block.text || "",
                    json: ""
                };

            } else if (type === "content_block_delta") {

                const block = blocks[data.index] || (blocks[data.index] = { type: "text", text: "", json: "" });

                const delta = data.delta || {};

                if (delta.type === "text_delta") {

                    block.text += delta.text || "";

                    onDelta({ type: "text", text: delta.text || "" });

                } else if (delta.type === "input_json_delta") {

                    block.json += delta.partial_json || "";

                    onDelta({
                        type: "tool_call",
                        index: data.index,
                        id: block.id,
                        name: block.name,
                        arguments: delta.partial_json || ""
                    });
                }

            } else if (type === "message_delta") {

                if (data.delta && data.delta.stop_reason) {
                    stop = data.delta.stop_reason;
                }

                usage = { ...usage, ...(data.usage || {}) };

            } else if (type === "error") {

                throw ProviderError.fromBody(this.name, data);

            } else if (type === "message_stop") {

                break;
            }
        }

        const present = blocks.filter(Boolean);

        return chatResponse({
            id,
            model,
            provider: this.name,
            text: present.filter(block => block.type === "text").map(block => block.text).join(""),
            toolCalls:
                present
                    .filter(block => block.type === "tool_use")
                    .map(block => ({ id: block.id, name: block.name, arguments: block.json || "{}" })),
            finishReason: finishOf(stop),
            usage: usageOf(usage)
        });
    }


    async countTokens(request) {

        try {

            const prepared = this.prepare(request);

            const response = await this.send({
                url: `${this.requireBaseUrl()}/v1/messages/count_tokens`,
                headers: this.headersOf(false),
                body: JSON.stringify(this.shared(prepared))
            });

            const body = JSON.parse(await response.text());

            if (Number.isFinite(body.input_tokens)) {
                return { tokens: body.input_tokens, method: "native" };
            }

        } catch {
            /* fall back to the estimate */
        }

        return { tokens: estimateRequestTokens(request), method: "estimate" };
    }
}

AnthropicProvider.providerName = "anthropic";


module.exports = {
    AnthropicProvider
};
