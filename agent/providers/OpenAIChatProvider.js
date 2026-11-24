"use strict";

/*
|--------------------------------------------------------------------------
| OpenAI Chat Completions (roadmap P1-1)
|--------------------------------------------------------------------------
|
|   openai              https://api.openai.com/v1/chat/completions
|   openai-compatible   any server that speaks the same API (vLLM,
|                       LM Studio, LiteLLM, the local smart router that
|                       AGENT_BASE_URL points at by default, ...)
|
| The request is already in this format, so messages, tools and
| response_format pass through. Streaming assembles text and tool-call
| deltas by index. Prompt caching is automatic on OpenAI; cached prompt
| tokens are reported in usage.cached_tokens.
|--------------------------------------------------------------------------
*/

const { LLMProvider } = require("./LLMProvider");
const { ProviderError } = require("./ProviderError");
const { readSse, parseEventData } = require("./StreamReaders");
const { chatResponse, makeUsage } = require("./Messages");


function usageOf(usage) {

    const value = usage || {};

    return makeUsage({
        input: value.prompt_tokens,
        output: value.completion_tokens,
        total: value.total_tokens,
        cached:
            (value.prompt_tokens_details && value.prompt_tokens_details.cached_tokens) ||
            value.cached_tokens
    });
}


class OpenAIChatProvider extends LLMProvider {

    defaultBaseUrl() {
        return "https://api.openai.com/v1";
    }


    capabilities() {

        return {
            streaming: true,
            tools: true,
            vision: true,
            promptCaching: "automatic",
            tokenCount: "estimate",
            responseFormat: true
        };
    }


    endpoint() {
        return `${this.requireBaseUrl()}/chat/completions`;
    }


    authHeaders() {
        return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    }


    /* stream_options.include_usage; off for unknown compatible servers */
    streamUsage() {
        return this.spec.streamUsage !== undefined ? Boolean(this.spec.streamUsage) : true;
    }


    body(request, stream) {

        const body = {
            model: request.model,
            messages: request.messages
        };

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        if (Array.isArray(request.tools) && request.tools.length > 0) {

            body.tools = request.tools;

            if (request.parallelToolCalls !== undefined) {
                body.parallel_tool_calls = request.parallelToolCalls;
            }

            if (request.toolChoice) {
                body.tool_choice = request.toolChoice;
            }
        }

        if (request.responseFormat) {
            body.response_format = request.responseFormat;
        }

        if (request.maxTokens > 0) {
            body.max_tokens = request.maxTokens;
        }

        if (stream) {

            body.stream = true;

            if (this.streamUsage()) {
                body.stream_options = { include_usage: true };
            }
        }

        return body;
    }


    buildHttp(request, stream) {

        return {
            url: this.endpoint(request),
            headers: {
                ...this.jsonHeaders(stream),
                ...this.authHeaders(),
                ...this.headers
            },
            body: JSON.stringify(this.body(request, stream))
        };
    }


    parseResponse(body, request) {

        if (body && body.error) {
            throw ProviderError.fromBody(this.name, body);
        }

        const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;

        if (!choice || !choice.message) {

            throw new ProviderError(
                `${this.name} answered without choices[0].message`,
                { provider: this.name, code: "invalid_response", retryable: false }
            );
        }

        return {
            ...body,
            object: body.object || "chat.completion",
            model: body.model || request.model,
            provider: this.name,
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", ...choice.message },
                    finish_reason: choice.finish_reason || "stop"
                }
            ],
            usage: usageOf(body.usage)
        };
    }


    async readStream(response, request, onDelta) {

        let id = null;
        let model = request.model;
        let text = "";
        let finish = null;
        let usage = null;

        const calls = [];

        for await (const event of readSse(response.body)) {

            if (String(event.data).trim() === "[DONE]") {
                break;
            }

            const chunk = parseEventData(event);

            if (!chunk) {
                continue;
            }

            if (chunk.error) {
                throw ProviderError.fromBody(this.name, chunk);
            }

            id = chunk.id || id;
            model = chunk.model || model;

            if (chunk.usage) {
                usage = chunk.usage;
            }

            const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;

            if (!choice) {
                continue;
            }

            const delta = choice.delta || {};

            if (typeof delta.content === "string" && delta.content !== "") {

                text += delta.content;

                onDelta({ type: "text", text: delta.content });
            }

            for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {

                const index = Number.isInteger(call.index) ? call.index : calls.length;

                const slot = calls[index] || (calls[index] = { id: null, name: "", arguments: "" });

                const fn = call.function || {};

                if (call.id) {
                    slot.id = call.id;
                }

                if (fn.name && !slot.name) {
                    slot.name = fn.name;
                }

                if (typeof fn.arguments === "string") {
                    slot.arguments += fn.arguments;
                }

                onDelta({
                    type: "tool_call",
                    index,
                    id: slot.id,
                    name: slot.name,
                    arguments: typeof fn.arguments === "string" ? fn.arguments : ""
                });
            }

            if (choice.finish_reason) {
                finish = choice.finish_reason;
            }
        }

        return chatResponse({
            id,
            model,
            provider: this.name,
            text,
            toolCalls: calls.filter(Boolean),
            finishReason: finish,
            usage: usageOf(usage)
        });
    }
}

OpenAIChatProvider.providerName = "openai";


class OpenAICompatibleProvider extends OpenAIChatProvider {

    defaultBaseUrl() {
        return "";
    }


    capabilities() {
        return { ...super.capabilities(), promptCaching: "server-dependent" };
    }


    streamUsage() {
        return this.spec.streamUsage !== undefined ? Boolean(this.spec.streamUsage) : false;
    }
}

OpenAICompatibleProvider.providerName = "openai-compatible";


module.exports = {
    OpenAIChatProvider,
    OpenAICompatibleProvider,
    usageOf
};
