"use strict";

/*
|--------------------------------------------------------------------------
| AWS Bedrock Converse (roadmap P1-1)
|--------------------------------------------------------------------------
|
| POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
| (streaming: /converse-stream, an AWS event stream). One request shape
| for every Bedrock model family.
|
| Auth, in this order:
|   apiKey                      a Bedrock API key, sent as a bearer token
|   accessKeyId + secretAccessKey (+ sessionToken)
|                               IAM credentials, SigV4-signed
| Neither -> ProviderError missing_credentials (never retried).
|
|   system messages      -> system blocks (+ a cachePoint with
|                           promptCaching on Anthropic / Nova models)
|   assistant tool_calls -> toolUse blocks
|   tool results         -> toolResult blocks in a user turn
|   image parts (base64) -> image blocks; image URLs are not supported by
|                           Converse and are passed as a text note
|--------------------------------------------------------------------------
*/

const { LLMProvider } = require("./LLMProvider");
const { ProviderError } = require("./ProviderError");
const { decodeEventStream } = require("./EventStream");
const { signRequest } = require("./AwsSigV4");
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


const imageFormats = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpeg"],
    ["image/jpg", "jpeg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"]
]);


const exceptionStatus = new Map([
    ["throttlingException", 429],
    ["serviceUnavailableException", 503],
    ["internalServerException", 500],
    ["modelStreamErrorException", 500],
    ["modelTimeoutException", 504],
    ["validationException", 400],
    ["accessDeniedException", 403],
    ["resourceNotFoundException", 404]
]);


function blockOf(part) {

    if (part.type === "text") {
        return { text: part.text };
    }

    if (part.data && imageFormats.has(part.mediaType)) {
        return { image: { format: imageFormats.get(part.mediaType), source: { bytes: part.data } } };
    }

    return { text: `[image: ${part.url || part.mediaType}]` };
}


function messagesOf(messages) {

    const out = [];

    const push = (role, content) => {

        if (content.length === 0) {
            return;
        }

        const last = out[out.length - 1];

        if (last && last.role === role) {
            last.content.push(...content);
        } else {
            out.push({ role, content });
        }
    };

    for (const message of messages) {

        if (!message || message.role === "system" || message.role === "developer") {
            continue;
        }

        if (message.role === "tool") {

            push("user", [{
                toolResult: {
                    toolUseId: message.tool_call_id,
                    content: [{ text: textOf(message.content) || "(no output)" }]
                }
            }]);

            continue;
        }

        const content =
            partsOf(message.content)
                .filter(part => part.type !== "text" || part.text !== "")
                .map(blockOf);

        if (message.role === "assistant") {

            for (const call of toolCallsOf(message)) {
                content.push({ toolUse: { toolUseId: call.id, name: call.name, input: argumentsObject(call.arguments) } });
            }

            push("assistant", content.filter(block => !block.image));

            continue;
        }

        push("user", content);
    }

    if (out.length > 0 && out[0].role !== "user") {
        out.unshift({ role: "user", content: [{ text: "(continue)" }] });
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

    return makeUsage({
        input: value.inputTokens,
        output: value.outputTokens,
        total: value.totalTokens,
        cached: value.cacheReadInputTokens
    });
}


class BedrockProvider extends LLMProvider {

    region() {
        return this.spec.region || "us-east-1";
    }


    defaultBaseUrl(spec) {
        return `https://bedrock-runtime.${(spec && spec.region) || "us-east-1"}.amazonaws.com`;
    }


    capabilities() {

        return {
            streaming: true,
            tools: true,
            vision: true,
            promptCaching: "model-dependent",
            tokenCount: "estimate",
            responseFormat: false
        };
    }


    cachesPrompt(model) {
        return this.promptCaching && /anthropic|amazon\.nova/i.test(String(model || ""));
    }


    body(request) {

        const body = { messages: messagesOf(request.messages) };

        const system = systemText(request.messages);

        if (system) {

            body.system = [{ text: system }];

            if (this.cachesPrompt(request.model)) {
                body.system.push({ cachePoint: { type: "default" } });
            }
        }

        const inference = {};

        if (request.maxTokens > 0) {
            inference.maxTokens = request.maxTokens;
        }

        if (request.temperature !== undefined) {
            inference.temperature = Math.min(1, request.temperature);
        }

        if (Object.keys(inference).length > 0) {
            body.inferenceConfig = inference;
        }

        const tools = toolDeclarations(request.tools);

        if (tools.length > 0) {

            body.toolConfig = {
                tools: tools.map(tool => ({
                    toolSpec: {
                        name: tool.name,
                        description: tool.description || tool.name,
                        inputSchema: { json: tool.parameters }
                    }
                }))
            };
        }

        return body;
    }


    buildHttp(request, stream) {

        const url = `${this.requireBaseUrl()}/model/${encodeURIComponent(request.model)}/${stream ? "converse-stream" : "converse"}`;

        const body = JSON.stringify(this.body(request));

        const headers = {
            "content-type": "application/json",
            accept: stream ? "application/vnd.amazon.eventstream" : "application/json",
            ...this.headers
        };

        if (this.apiKey) {
            return { url, body, headers: { ...headers, authorization: `Bearer ${this.apiKey}` } };
        }

        if (this.spec.accessKeyId && this.spec.secretAccessKey) {

            return {
                url,
                body,
                headers: signRequest({
                    method: "POST",
                    url,
                    headers,
                    body,
                    region: this.region(),
                    service: "bedrock",
                    accessKeyId: this.spec.accessKeyId,
                    secretAccessKey: this.spec.secretAccessKey,
                    sessionToken: this.spec.sessionToken,
                    now: this.spec.now ? new Date(this.spec.now) : new Date()
                })
            };
        }

        throw new ProviderError(
            "bedrock needs a Bedrock API key (AGENT_API_KEY) or IAM credentials (BEDROCK_ACCESS_KEY_ID and BEDROCK_SECRET_ACCESS_KEY)",
            { provider: this.name, code: "missing_credentials", retryable: false }
        );
    }


    parseResponse(body, request) {

        const message = body && body.output && body.output.message;

        if (!message || !Array.isArray(message.content)) {

            if (body && (body.message || body.Message)) {
                throw ProviderError.fromBody(this.name, body);
            }

            throw new ProviderError(
                `${this.name} answered without output.message`,
                { provider: this.name, code: "invalid_response", retryable: false }
            );
        }

        const texts = [];
        const calls = [];

        for (const block of message.content) {

            if (typeof block.text === "string") {
                texts.push(block.text);
            } else if (block.toolUse) {
                calls.push({ id: block.toolUse.toolUseId, name: block.toolUse.name, arguments: block.toolUse.input || {} });
            }
        }

        return chatResponse({
            model: request.model,
            provider: this.name,
            text: texts.join(""),
            toolCalls: calls,
            finishReason: finishOf(body.stopReason),
            usage: usageOf(body.usage)
        });
    }


    async readStream(response, request, onDelta) {

        let stop = null;
        let usage = null;

        const blocks = [];

        for await (const frame of decodeEventStream(response.body)) {

            const kind = frame.headers[":message-type"];

            let payload = {};

            try {
                payload = frame.payload.length > 0 ? JSON.parse(frame.payload.toString("utf8")) : {};
            } catch {
                payload = {};
            }

            if (kind === "exception" || kind === "error") {

                const type = frame.headers[":exception-type"] || frame.headers[":error-code"] || "streamException";

                const status = exceptionStatus.get(type) || 500;

                throw new ProviderError(
                    `${this.name} stream reported ${type}: ${payload.message || payload.Message || frame.headers[":error-message"] || ""}`,
                    { provider: this.name, status, code: type }
                );
            }

            const type = frame.headers[":event-type"];

            if (type === "contentBlockStart") {

                const start = (payload.start && payload.start.toolUse) || {};

                blocks[payload.contentBlockIndex] = { id: start.toolUseId, name: start.name, text: "", json: "", tool: Boolean(start.name) };

            } else if (type === "contentBlockDelta") {

                const index = payload.contentBlockIndex || 0;

                const block = blocks[index] || (blocks[index] = { text: "", json: "", tool: false });

                const delta = payload.delta || {};

                if (typeof delta.text === "string") {

                    block.text += delta.text;

                    onDelta({ type: "text", text: delta.text });

                } else if (delta.toolUse) {

                    block.json += delta.toolUse.input || "";

                    onDelta({ type: "tool_call", index, id: block.id, name: block.name, arguments: delta.toolUse.input || "" });
                }

            } else if (type === "messageStop") {

                stop = payload.stopReason || stop;

            } else if (type === "metadata") {

                usage = payload.usage || usage;
            }
        }

        const present = blocks.filter(Boolean);

        return chatResponse({
            model: request.model,
            provider: this.name,
            text: present.filter(block => !block.tool).map(block => block.text).join(""),
            toolCalls: present.filter(block => block.tool).map(block => ({ id: block.id, name: block.name, arguments: block.json || "{}" })),
            finishReason: finishOf(stop),
            usage: usageOf(usage)
        });
    }
}

BedrockProvider.providerName = "bedrock";


module.exports = {
    BedrockProvider
};
