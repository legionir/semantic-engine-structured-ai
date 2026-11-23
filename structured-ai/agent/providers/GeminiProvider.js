"use strict";

/*
|--------------------------------------------------------------------------
| Google Gemini (roadmap P1-1)
|--------------------------------------------------------------------------
|
| POST {baseUrl}/v1beta/models/{model}:generateContent (streaming:
| :streamGenerateContent?alt=sse) with x-goog-api-key.
|
|   system/developer messages  -> systemInstruction
|   assistant                  -> role "model", functionCall parts
|   tool results               -> functionResponse parts (the name is
|                                 looked up from the matching tool call)
|   image parts                -> inlineData / fileData
|   tool parameters            -> the OpenAPI subset Gemini accepts
|                                 (additionalProperties, $schema, ...
|                                 removed; ["x","null"] -> nullable)
|
| responseMimeType application/json is only sent without tools (the API
| refuses the combination). Caching is implicit; cached tokens are
| reported from usageMetadata. countTokens uses :countTokens.
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
    toolNameIndex,
    toolDeclarations,
    argumentsObject,
    chatResponse,
    makeUsage
} = require("./Messages");


const allowedSchemaKeys = new Set([
    "type", "format", "title", "description", "nullable", "enum",
    "properties", "required", "items", "minItems", "maxItems",
    "minimum", "maximum", "minLength", "maxLength", "pattern",
    "anyOf", "propertyOrdering"
]);


function sanitizeSchema(schema) {

    if (Array.isArray(schema)) {
        return schema.map(sanitizeSchema);
    }

    if (!schema || typeof schema !== "object") {
        return schema;
    }

    const out = {};

    for (const [key, value] of Object.entries(schema)) {

        if (!allowedSchemaKeys.has(key)) {
            continue;
        }

        if (key === "type" && Array.isArray(value)) {

            const types = value.filter(type => type !== "null");

            out.type = types[0] || "string";

            if (types.length !== value.length) {
                out.nullable = true;
            }

            continue;
        }

        if (key === "properties" && value && typeof value === "object") {

            out.properties = {};

            for (const [name, property] of Object.entries(value)) {
                out.properties[name] = sanitizeSchema(property);
            }

            continue;
        }

        out[key] = key === "items" || key === "anyOf" ? sanitizeSchema(value) : value;
    }

    return out;
}


function partOf(part) {

    if (part.type === "text") {
        return { text: part.text };
    }

    if (part.data) {
        return { inlineData: { mimeType: part.mediaType, data: part.data } };
    }

    return { fileData: { mimeType: part.mediaType, fileUri: part.url } };
}


function contentsOf(messages) {

    const names = toolNameIndex(messages);

    const out = [];

    const push = (role, parts) => {

        if (parts.length === 0) {
            return;
        }

        const last = out[out.length - 1];

        if (last && last.role === role) {
            last.parts.push(...parts);
        } else {
            out.push({ role, parts });
        }
    };

    for (const message of messages) {

        if (!message || message.role === "system" || message.role === "developer") {
            continue;
        }

        if (message.role === "tool") {

            push("user", [{
                functionResponse: {
                    name: names.get(message.tool_call_id) || message.name || "tool",
                    response: { content: textOf(message.content) }
                }
            }]);

            continue;
        }

        const parts =
            partsOf(message.content)
                .filter(part => part.type !== "text" || part.text !== "")
                .map(partOf);

        if (message.role === "assistant") {

            for (const call of toolCallsOf(message)) {
                parts.push({ functionCall: { name: call.name, args: argumentsObject(call.arguments) } });
            }

            push("model", parts);

            continue;
        }

        push("user", parts);
    }

    return out;
}


function finishOf(reason, calls) {

    if (reason === "MAX_TOKENS") {
        return "length";
    }

    if (calls > 0) {
        return "tool_calls";
    }

    return reason ? "stop" : null;
}


function usageOf(metadata) {

    const value = metadata || {};

    return makeUsage({
        input: value.promptTokenCount,
        output: value.candidatesTokenCount,
        total: value.totalTokenCount,
        cached: value.cachedContentTokenCount
    });
}


class GeminiProvider extends LLMProvider {

    defaultBaseUrl() {
        return "https://generativelanguage.googleapis.com";
    }


    capabilities() {

        return {
            streaming: true,
            tools: true,
            vision: true,
            promptCaching: "implicit",
            tokenCount: "native",
            responseFormat: true
        };
    }


    modelPath(request) {

        const model = String(request.model || "").replace(/^models\//, "");

        return `${this.requireBaseUrl()}/${this.spec.apiVersion || "v1beta"}/models/${encodeURIComponent(model)}`;
    }


    headersOf(stream) {

        return {
            ...this.jsonHeaders(stream),
            ...(this.apiKey ? { "x-goog-api-key": this.apiKey } : {}),
            ...this.headers
        };
    }


    shared(request) {

        const body = { contents: contentsOf(request.messages) };

        const system = systemText(request.messages);

        if (system) {
            body.systemInstruction = { parts: [{ text: system }] };
        }

        const tools = toolDeclarations(request.tools);

        if (tools.length > 0) {

            body.tools = [{
                functionDeclarations: tools.map(tool => {

                    const declaration = { name: tool.name, description: tool.description };

                    const parameters = sanitizeSchema(tool.parameters);

                    if (parameters && parameters.properties && Object.keys(parameters.properties).length > 0) {
                        declaration.parameters = parameters;
                    }

                    return declaration;
                })
            }];
        }

        return body;
    }


    body(request) {

        const body = this.shared(request);

        const config = {};

        if (request.temperature !== undefined) {
            config.temperature = request.temperature;
        }

        if (request.maxTokens > 0) {
            config.maxOutputTokens = request.maxTokens;
        }

        if (request.responseFormat && !body.tools) {
            config.responseMimeType = "application/json";
        }

        if (Object.keys(config).length > 0) {
            body.generationConfig = config;
        }

        return body;
    }


    buildHttp(request, stream) {

        return {
            url: `${this.modelPath(request)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
            headers: this.headersOf(stream),
            body: JSON.stringify(this.body(request))
        };
    }


    collect(body, state) {

        if (body && body.error) {
            throw ProviderError.fromBody(this.name, body);
        }

        const candidate = body && Array.isArray(body.candidates) ? body.candidates[0] : null;

        if (!candidate) {

            if (body && body.promptFeedback && body.promptFeedback.blockReason) {

                throw new ProviderError(
                    `${this.name} blocked the prompt (${body.promptFeedback.blockReason})`,
                    { provider: this.name, code: "blocked", retryable: false }
                );
            }

            return "";
        }

        let text = "";

        for (const part of (candidate.content && candidate.content.parts) || []) {

            if (typeof part.text === "string" && part.thought !== true) {
                text += part.text;
            }

            if (part.functionCall) {

                state.calls.push({
                    id: part.functionCall.id || `call_${state.calls.length + 1}`,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {}
                });
            }
        }

        state.text += text;

        if (candidate.finishReason) {
            state.finish = candidate.finishReason;
        }

        if (body.usageMetadata) {
            state.usage = body.usageMetadata;
        }

        state.model = body.modelVersion || state.model;
        state.id = body.responseId || state.id;

        return text;
    }


    result(state) {

        return chatResponse({
            id: state.id,
            model: state.model,
            provider: this.name,
            text: state.text,
            toolCalls: state.calls,
            finishReason: finishOf(state.finish, state.calls.length),
            usage: usageOf(state.usage)
        });
    }


    parseResponse(body, request) {

        const state = { text: "", calls: [], finish: null, usage: null, model: request.model, id: null };

        if (!body || !Array.isArray(body.candidates)) {

            this.collect(body, state);

            throw new ProviderError(
                `${this.name} answered without candidates`,
                { provider: this.name, code: "invalid_response", retryable: false }
            );
        }

        this.collect(body, state);

        return this.result(state);
    }


    async readStream(response, request, onDelta) {

        const state = { text: "", calls: [], finish: null, usage: null, model: request.model, id: null };

        for await (const event of readSse(response.body)) {

            const data = parseEventData(event);

            if (!data) {
                continue;
            }

            const before = state.calls.length;

            const text = this.collect(data, state);

            if (text) {
                onDelta({ type: "text", text });
            }

            for (let index = before; index < state.calls.length; index++) {

                const call = state.calls[index];

                onDelta({ type: "tool_call", index, id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
            }
        }

        return this.result(state);
    }


    async countTokens(request) {

        try {

            const prepared = this.prepare(request);

            const model = String(prepared.model || "").replace(/^models\//, "");

            const response = await this.send({
                url: `${this.modelPath(prepared)}:countTokens`,
                headers: this.headersOf(false),
                body: JSON.stringify({ generateContentRequest: { model: `models/${model}`, ...this.shared(prepared) } })
            });

            const body = JSON.parse(await response.text());

            if (Number.isFinite(body.totalTokens)) {
                return { tokens: body.totalTokens, method: "native" };
            }

        } catch {
            /* fall back to the estimate */
        }

        return { tokens: estimateRequestTokens(request), method: "estimate" };
    }
}

GeminiProvider.providerName = "gemini";


module.exports = {
    GeminiProvider,
    sanitizeSchema
};
