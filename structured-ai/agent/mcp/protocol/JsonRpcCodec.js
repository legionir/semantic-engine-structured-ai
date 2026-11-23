"use strict";

/*
|--------------------------------------------------------------------------
| JSON-RPC 2.0 codec — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| Every MCP transport speaks the same language. Only the wrapping
| differs; the envelope lives here once.
|--------------------------------------------------------------------------
*/

const JSONRPC_VERSION = "2.0";

const PROTOCOL_VERSION = "2025-06-18";

const SUPPORTED_PROTOCOL_VERSIONS = [
    "2025-06-18",
    "2025-03-26",
    "2024-11-05"
];

const CLIENT_INFO = {
    name: "structured-ai",
    version: "0.1.0"
};


let sequence = 0;


function nextId() {

    sequence += 1;

    return sequence;
}


function request(method, params, id) {

    return {
        jsonrpc: JSONRPC_VERSION,
        id: id === undefined ? nextId() : id,
        method,
        params: params || {}
    };
}


function notification(method, params) {

    return {
        jsonrpc: JSONRPC_VERSION,
        method,
        params: params || {}
    };
}


function isResponse(message) {

    return Boolean(
        message &&
        typeof message === "object" &&
        message.id !== undefined &&
        message.id !== null &&
        (
            Object.prototype.hasOwnProperty.call(message, "result") ||
            Object.prototype.hasOwnProperty.call(message, "error")
        )
    );
}


function isNotification(message) {

    return Boolean(
        message &&
        typeof message === "object" &&
        typeof message.method === "string" &&
        (message.id === undefined || message.id === null)
    );
}


/*
| P0-6: a server may send requests of its own (ping, roots/list, ...).
| They carry both a method and an id, and must be answered with the same
| id, or a spec-compliant server waits for an answer that never comes.
*/

function isRequest(message) {

    return Boolean(
        message &&
        typeof message === "object" &&
        typeof message.method === "string" &&
        message.id !== undefined &&
        message.id !== null
    );
}


function response(id, result) {

    return {
        jsonrpc: JSONRPC_VERSION,
        id,
        result: result === undefined ? {} : result
    };
}


function errorResponse(id, code, message, data) {

    const error = {
        code: Number.isInteger(code) ? code : -32603,
        message: String(message || "internal error")
    };

    if (data !== undefined) {
        error.data = data;
    }

    return {
        jsonrpc: JSONRPC_VERSION,
        id,
        error
    };
}


/*
| tools/call answers with a content array. Text content that parses as
| JSON is the structured result the caller asked for; anything else is
| returned as text so an image or a resource link is not silently lost.
*/

function unpackToolResult(result) {

    if (
        !result ||
        typeof result !== "object"
    ) {
        return result;
    }

    if (
        result.structuredContent &&
        typeof result.structuredContent === "object"
    ) {
        return result.structuredContent;
    }

    if (!Array.isArray(result.content)) {
        return result;
    }

    const texts =
        result.content.filter(
            item => item && item.type === "text" && typeof item.text === "string"
        );

    if (texts.length === 0) {
        return result;
    }

    if (texts.length === 1) {

        try {

            const parsed = JSON.parse(texts[0].text);

            if (parsed && typeof parsed === "object") {
                return parsed;
            }

            return { text: texts[0].text, value: parsed };

        } catch {

            return { text: texts[0].text };
        }
    }

    return {
        text:
            texts.map(item => item.text).join("\n"),

        parts:
            result.content.length
    };
}


module.exports = {
    JSONRPC_VERSION,
    PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    CLIENT_INFO,
    nextId,
    request,
    notification,
    isResponse,
    isNotification,
    isRequest,
    response,
    errorResponse,
    unpackToolResult
};
