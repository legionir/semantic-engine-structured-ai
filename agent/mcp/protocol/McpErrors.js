"use strict";

/*
|--------------------------------------------------------------------------
| MCP / JSON-RPC errors — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
*/

/*
| A JSON-RPC error object is not an Error, and the message a server puts
| in it is the only useful part of it for the model, so the data is kept
| but flattened into something that can be thrown.
*/

function toError(payload, context) {

    const detail =
        payload && typeof payload === "object"
            ? payload
            : { message: String(payload) };

    const text =
        detail.message ||
        JSON.stringify(detail);

    const error =
        new Error(
            context
                ? `${context}: ${text}`
                : text
        );

    error.rpc_code = detail.code;
    error.rpc_data = detail.data;

    return error;
}


module.exports = {
    toError
};
