"use strict";

/*
|--------------------------------------------------------------------------
| Ollama (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Native API: POST {baseUrl}/api/chat (default http://localhost:11434; a
| baseUrl ending in /v1 is accepted and trimmed). Streaming is NDJSON and
| on by default in Ollama, so stream:false is always sent explicitly.
| Images travel as base64 in message.images, tool arguments as objects,
| response_format as `format` (a JSON schema or "json"). No key is
| needed; one is sent as a bearer token when set (hosted Ollama).
|--------------------------------------------------------------------------
*/

const { LLMProvider, trimSlash } = require("./LLMProvider");
const { ProviderError } = require("./ProviderError");
const { readNdjson } = require("./StreamReaders");
const {
    partsOf,
    textOf,
    toolCallsOf,
    toolNameIndex,
    argumentsObject,
    chatResponse,
    makeUsage
} = require("./Messages");


function messagesOf(messages) {

    const names = toolNameIndex(messages);

    return messages
        .filter(Boolean)
        .map(message => {

            const role = message.role === "developer" ? "system" : message.role;

            const parts = partsOf(message.content);

            const out = {
                role,
                content: parts.filter(part => part.type === "text").map(part => part.text).join("")
            };

            const images = parts.filter(part => part.type === "image" && part.data).map(part => part.data);

            if (images.length > 0) {
                out.images = images;
            }

            if (role === "assistant") {

                const calls = toolCallsOf(message);

                if (calls.length > 0) {
                    out.tool_calls = calls.map(call => ({ function: { name: call.name, arguments: argumentsObject(call.arguments) } }));
                }
            }

            if (role === "tool") {

                out.content = textOf(message.content);

                const name = names.get(message.tool_call_id) || message.name;

                if (name) {
                    out.tool_name = name;
                }
            }

            return out;
        });
}


function formatOf(responseFormat) {

    if (!responseFormat || typeof responseFormat !== "object") {
        return null;
    }

    if (responseFormat.type === "json_schema" && responseFormat.json_schema && responseFormat.json_schema.schema) {
        return responseFormat.json_schema.schema;
    }

    if (responseFormat.type === "json_object" || responseFormat.type === "json_schema") {
        return "json";
    }

    return null;
}


function finishOf(reason, calls) {

    if (reason === "length") {
        return "length";
    }

    return calls > 0 ? "tool_calls" : "stop";
}


class OllamaProvider extends LLMProvider {

    constructor(spec = {}, deps = {}) {

        super(spec, deps);

        this.baseUrl = trimSlash(this.baseUrl).replace(/\/v1$/, "");
    }


    defaultBaseUrl() {
        return "http://localhost:11434";
    }


    capabilities() {

        return {
            streaming: true,
            tools: true,
            vision: true,
            promptCaching: "none",
            tokenCount: "estimate",
            responseFormat: true
        };
    }


    body(request, stream) {

        const body = {
            model: request.model,
            messages: messagesOf(request.messages),
            stream: Boolean(stream)
        };

        if (Array.isArray(request.tools) && request.tools.length > 0) {
            body.tools = request.tools;
        }

        const format = formatOf(request.responseFormat);

        if (format) {
            body.format = format;
        }

        const options = {};

        if (request.temperature !== undefined) {
            options.temperature = request.temperature;
        }

        if (request.maxTokens > 0) {
            options.num_predict = request.maxTokens;
        }

        if (Object.keys(options).length > 0) {
            body.options = options;
        }

        return body;
    }


    buildHttp(request, stream) {

        return {
            url: `${this.requireBaseUrl()}/api/chat`,
            headers: {
                "content-type": "application/json",
                accept: stream ? "application/x-ndjson" : "application/json",
                ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
                ...this.headers
            },
            body: JSON.stringify(this.body(request, stream))
        };
    }


    callsOf(message) {

        return (Array.isArray(message && message.tool_calls) ? message.tool_calls : [])
            .map(call => ({
                id: call.id,
                name: call.function && call.function.name,
                arguments: (call.function && call.function.arguments) || {}
            }));
    }


    parseResponse(body, request) {

        if (body && body.error) {
            throw ProviderError.fromBody(this.name, body, 500);
        }

        if (!body || !body.message) {

            throw new ProviderError(
                `${this.name} answered without a message`,
                { provider: this.name, code: "invalid_response", retryable: false }
            );
        }

        const calls = this.callsOf(body.message);

        return chatResponse({
            model: body.model || request.model,
            provider: this.name,
            text: body.message.content || "",
            toolCalls: calls,
            finishReason: finishOf(body.done_reason, calls.length),
            usage: makeUsage({ input: body.prompt_eval_count, output: body.eval_count })
        });
    }


    async readStream(response, request, onDelta) {

        let text = "";
        let model = request.model;
        let reason = null;
        let usage = {};

        const calls = [];

        for await (const chunk of readNdjson(response.body)) {

            if (chunk.error) {
                throw ProviderError.fromBody(this.name, chunk, 500);
            }

            model = chunk.model || model;

            const message = chunk.message || {};

            if (message.content) {

                text += message.content;

                onDelta({ type: "text", text: message.content });
            }

            for (const call of this.callsOf(message)) {

                calls.push(call);

                onDelta({ type: "tool_call", index: calls.length - 1, id: call.id || null, name: call.name, arguments: JSON.stringify(call.arguments) });
            }

            if (chunk.done) {

                reason = chunk.done_reason || "stop";

                usage = { input: chunk.prompt_eval_count, output: chunk.eval_count };

                break;
            }
        }

        return chatResponse({
            model,
            provider: this.name,
            text,
            toolCalls: calls,
            finishReason: finishOf(reason, calls.length),
            usage: makeUsage(usage)
        });
    }
}

OllamaProvider.providerName = "ollama";


module.exports = {
    OllamaProvider
};
