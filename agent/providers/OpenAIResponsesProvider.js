"use strict";

/*
|--------------------------------------------------------------------------
| OpenAI Responses API (roadmap P1-1)
|--------------------------------------------------------------------------
|
| POST {baseUrl}/responses. The chat request is mapped to
|
|   system/developer messages  -> instructions
|   user / assistant text      -> message items (input_text, output_text,
|                                 input_image)
|   assistant tool_calls       -> function_call items
|   tool results               -> function_call_output items
|   response_format            -> text.format
|
| and the answer's output items back to a chat.completion. store:false,
| so nothing is kept on the server between calls.
|--------------------------------------------------------------------------
*/

const { LLMProvider } = require("./LLMProvider");
const { ProviderError } = require("./ProviderError");
const { readSse, parseEventData } = require("./StreamReaders");
const {
    partsOf,
    textOf,
    systemText,
    toolCallsOf,
    toolDeclarations,
    chatResponse,
    makeUsage
} = require("./Messages");


function inputOf(messages) {

    const input = [];

    for (const message of messages) {

        if (!message || message.role === "system" || message.role === "developer") {
            continue;
        }

        if (message.role === "tool") {

            input.push({
                type: "function_call_output",
                call_id: message.tool_call_id,
                output: textOf(message.content)
            });

            continue;
        }

        if (message.role === "assistant") {

            const text = textOf(message.content);

            if (text !== "") {

                input.push({
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text }]
                });
            }

            for (const call of toolCallsOf(message)) {

                input.push({
                    type: "function_call",
                    call_id: call.id,
                    name: call.name,
                    arguments: call.arguments
                });
            }

            continue;
        }

        const content =
            partsOf(message.content).map(part =>
                part.type === "text"
                    ? { type: "input_text", text: part.text }
                    : {
                        type: "input_image",
                        image_url: part.data ? `data:${part.mediaType};base64,${part.data}` : part.url
                    }
            );

        if (content.length > 0) {
            input.push({ type: "message", role: "user", content });
        }
    }

    return input;
}


function formatOf(responseFormat) {

    if (!responseFormat || typeof responseFormat !== "object") {
        return null;
    }

    if (responseFormat.type === "json_schema" && responseFormat.json_schema) {

        return {
            type: "json_schema",
            name: responseFormat.json_schema.name || "response",
            schema: responseFormat.json_schema.schema || {},
            strict: responseFormat.json_schema.strict === true
        };
    }

    if (responseFormat.type === "json_object") {
        return { type: "json_object" };
    }

    return null;
}


class OpenAIResponsesProvider extends LLMProvider {

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


    body(request, stream) {

        const body = {
            model: request.model,
            input: inputOf(request.messages),
            store: false
        };

        const instructions = systemText(request.messages);

        if (instructions) {
            body.instructions = instructions;
        }

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        const tools = toolDeclarations(request.tools);

        if (tools.length > 0) {

            body.tools = tools.map(tool => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }));

            if (request.parallelToolCalls !== undefined) {
                body.parallel_tool_calls = request.parallelToolCalls;
            }
        }

        const format = formatOf(request.responseFormat);

        if (format) {
            body.text = { format };
        }

        if (request.maxTokens > 0) {
            body.max_output_tokens = request.maxTokens;
        }

        if (stream) {
            body.stream = true;
        }

        return body;
    }


    buildHttp(request, stream) {

        return {
            url: `${this.requireBaseUrl()}/responses`,
            headers: {
                ...this.jsonHeaders(stream),
                ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
                ...this.headers
            },
            body: JSON.stringify(this.body(request, stream))
        };
    }


    parseResponse(body, request) {

        if (body && body.error) {
            throw ProviderError.fromBody(this.name, body);
        }

        if (!body || !Array.isArray(body.output)) {

            throw new ProviderError(
                `${this.name} answered without an output list`,
                { provider: this.name, code: "invalid_response", retryable: false }
            );
        }

        const texts = [];
        const calls = [];

        for (const item of body.output) {

            if (item && item.type === "message") {

                for (const part of item.content || []) {

                    if (part.type === "output_text") {
                        texts.push(part.text || "");
                    } else if (part.type === "refusal") {
                        texts.push(part.refusal || "");
                    }
                }

            } else if (item && item.type === "function_call") {

                calls.push({
                    id: item.call_id || item.id,
                    name: item.name,
                    arguments: item.arguments
                });
            }
        }

        const usage = body.usage || {};

        const truncated =
            body.status === "incomplete" &&
            body.incomplete_details &&
            body.incomplete_details.reason === "max_output_tokens";

        return chatResponse({
            id: body.id,
            model: body.model || request.model,
            provider: this.name,
            text: texts.join(""),
            toolCalls: calls,
            finishReason: truncated ? "length" : null,
            usage: makeUsage({
                input: usage.input_tokens,
                output: usage.output_tokens,
                total: usage.total_tokens,
                cached: usage.input_tokens_details && usage.input_tokens_details.cached_tokens
            })
        });
    }


    async readStream(response, request, onDelta) {

        let text = "";

        for await (const event of readSse(response.body)) {

            const data = parseEventData(event);

            if (!data) {
                continue;
            }

            const type = data.type || event.event;

            if (type === "response.output_text.delta") {

                text += data.delta || "";

                onDelta({ type: "text", text: data.delta || "" });

            } else if (type === "response.function_call_arguments.delta") {

                onDelta({
                    type: "tool_call",
                    index: data.output_index || 0,
                    id: data.item_id || null,
                    name: "",
                    arguments: data.delta || ""
                });

            } else if (type === "response.completed" || type === "response.incomplete") {

                return this.parseResponse(data.response || {}, request);

            } else if (type === "response.failed") {

                throw ProviderError.fromBody(this.name, (data.response && data.response.error) || data);

            } else if (type === "error") {

                throw ProviderError.fromBody(this.name, data);
            }
        }

        /* the stream ended without response.completed: keep what arrived */
        return chatResponse({
            model: request.model,
            provider: this.name,
            text,
            finishReason: "length"
        });
    }
}

OpenAIResponsesProvider.providerName = "openai-responses";


module.exports = {
    OpenAIResponsesProvider
};
