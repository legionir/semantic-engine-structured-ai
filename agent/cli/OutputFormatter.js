"use strict";

/* CLI output boundary — EXECUTION_PLAN Phase 26. */

function actionError(error) {
    return {
        version: "1.0",
        action: "final",
        tool_calls: null,
        delegations: null,
        response: null,
        data: null,
        error: {
            code: error.name || "RUNTIME_ERROR",
            message: error.message,
            retryable: false
        }
    };
}


function json(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}


function writeJson(stream, value) {
    stream.write(json(value));
}


function writeText(stream, value) {
    stream.write(`${String(value)}\n`);
}


function formatDuration(ms) {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}


module.exports = {
    actionError,
    json,
    writeJson,
    writeText,
    formatDuration
};
