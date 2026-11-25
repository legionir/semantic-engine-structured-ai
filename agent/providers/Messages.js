"use strict";

/*
|--------------------------------------------------------------------------
| Message helpers (roadmap P1-1)
|--------------------------------------------------------------------------
|
| The provider layer speaks one request shape, the OpenAI chat format the
| runtime already builds (RequestBuilder):
|
|   { model, messages, tools, toolChoice, parallelToolCalls,
|     responseFormat, maxTokens, temperature, stream }
|
| messages are { role: system|developer|user|assistant|tool, content,
| tool_calls?, tool_call_id? } where content is a string or a list of
| parts ({type:"text"}, {type:"image_url"}, {type:"image"}). Every
| adapter answers in the chat.completion shape, so ActionParser,
| NativeToolCallAdapter and ResponseRepair work unchanged for all of
| them.
|--------------------------------------------------------------------------
*/

function parseDataUrl(url) {

    const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(String(url || ""));

    if (!match || !match[2]) {
        return null;
    }

    return {
        mediaType: match[1] || "image/png",
        data: match[3]
    };
}


function guessMediaType(url) {

    const name = String(url || "").toLowerCase().split("?")[0];

    if (/\.jpe?g$/.test(name)) {
        return "image/jpeg";
    }

    if (/\.gif$/.test(name)) {
        return "image/gif";
    }

    if (/\.webp$/.test(name)) {
        return "image/webp";
    }

    return "image/png";
}


function imagePart(url) {

    const inline = parseDataUrl(url);

    if (inline) {
        return { type: "image", mediaType: inline.mediaType, data: inline.data };
    }

    return { type: "image", url: String(url || ""), mediaType: guessMediaType(url) };
}


/* Normalised parts: { type: "text", text } | { type: "image", mediaType, data | url } */
function partsOf(content) {

    if (content === null || content === undefined) {
        return [];
    }

    if (typeof content === "string") {
        return content === "" ? [] : [{ type: "text", text: content }];
    }

    if (!Array.isArray(content)) {
        return [{ type: "text", text: JSON.stringify(content) }];
    }

    const parts = [];

    for (const part of content) {

        if (typeof part === "string") {
            parts.push({ type: "text", text: part });
            continue;
        }

        if (!part || typeof part !== "object") {
            continue;
        }

        if (["text", "input_text", "output_text"].includes(part.type)) {
            parts.push({ type: "text", text: String(part.text === undefined ? "" : part.text) });
            continue;
        }

        if (part.type === "image_url" || part.type === "input_image") {

            const url =
                typeof part.image_url === "string"
                    ? part.image_url
                    : part.image_url && part.image_url.url;

            parts.push(imagePart(url));

            continue;
        }

        if (part.type === "image") {

            if (part.data) {
                parts.push({ type: "image", mediaType: part.mediaType || part.media_type || "image/png", data: part.data });
            } else if (part.source && part.source.data) {
                parts.push({ type: "image", mediaType: part.source.media_type || "image/png", data: part.source.data });
            } else if (part.url || (part.source && part.source.url)) {
                parts.push(imagePart(part.url || part.source.url));
            }

            continue;
        }

        parts.push({ type: "text", text: JSON.stringify(part) });
    }

    return parts;
}


function textOf(content) {

    return partsOf(content)
        .filter(part => part.type === "text")
        .map(part => part.text)
        .join("");
}


function systemText(messages) {

    return (messages || [])
        .filter(message => message && (message.role === "system" || message.role === "developer"))
        .map(message => textOf(message.content))
        .filter(text => text !== "")
        .join("\n\n");
}


function argumentsText(value) {

    if (typeof value === "string") {
        return value;
    }

    return JSON.stringify(value === undefined || value === null ? {} : value);
}


/* Tool arguments as an object for APIs that take structured input. */
function argumentsObject(value) {

    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim() !== "") {

        try {

            const parsed = JSON.parse(value);

            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }

        } catch {
            /* unreadable arguments are replayed as an empty object */
        }
    }

    return {};
}


/* [{ id, name, arguments (string) }] from an assistant message. */
function toolCallsOf(message) {

    const calls = Array.isArray(message && message.tool_calls) ? message.tool_calls : [];

    return calls
        .map((call, index) => ({
            id: call.id || `call_${index + 1}`,
            name: (call.function && call.function.name) || call.name || "",
            arguments: argumentsText(call.function ? call.function.arguments : call.arguments)
        }))
        .filter(call => call.name !== "");
}


/* tool_call_id -> tool name, for APIs whose tool results carry a name. */
function toolNameIndex(messages) {

    const names = new Map();

    for (const message of messages || []) {

        if (message && message.role === "assistant") {

            for (const call of toolCallsOf(message)) {
                names.set(call.id, call.name);
            }
        }
    }

    return names;
}


/* [{ name, description, parameters }] from OpenAI-style tool declarations. */
function toolDeclarations(tools) {

    return (Array.isArray(tools) ? tools : [])
        .map(tool => {

            const fn = tool && tool.function ? tool.function : tool;

            if (!fn || !fn.name) {
                return null;
            }

            return {
                name: fn.name,
                description: fn.description || "",
                parameters: fn.parameters || { type: "object", properties: {} }
            };
        })
        .filter(Boolean);
}


function number(value) {

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
}


function makeUsage({ input, output, total, cached } = {}) {

    const prompt = number(input);
    const completion = number(output);

    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: number(total) || prompt + completion,
        cached_tokens: number(cached)
    };
}


/* The chat.completion answer every adapter returns. */
function chatResponse({ id, model, provider, text, toolCalls, finishReason, usage, raw }) {

    const calls =
        (toolCalls || [])
            .filter(call => call && call.name)
            .map((call, index) => ({
                id: call.id || `call_${index + 1}`,
                type: "function",
                function: {
                    name: call.name,
                    arguments: argumentsText(call.arguments)
                }
            }));

    const content = typeof text === "string" ? text : "";

    const message = {
        role: "assistant",
        content: calls.length > 0 && content === "" ? null : content
    };

    if (calls.length > 0) {
        message.tool_calls = calls;
    }

    const response = {
        id: id || `${provider}-${Date.now().toString(36)}`,
        object: "chat.completion",
        model: model || null,
        provider,
        choices: [
            {
                index: 0,
                message,
                finish_reason: finishReason || (calls.length > 0 ? "tool_calls" : "stop")
            }
        ],
        usage: usage && usage.prompt_tokens !== undefined ? usage : makeUsage(usage)
    };

    if (raw !== undefined) {
        Object.defineProperty(response, "raw", { value: raw, enumerable: false });
    }

    return response;
}


module.exports = {
    parseDataUrl,
    partsOf,
    textOf,
    systemText,
    argumentsText,
    argumentsObject,
    toolCallsOf,
    toolNameIndex,
    toolDeclarations,
    makeUsage,
    chatResponse
};
