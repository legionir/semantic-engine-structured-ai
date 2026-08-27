"use strict";

/*
|--------------------------------------------------------------------------
| NDJSON framing — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| The specification's other framing: one JSON object per line.
|--------------------------------------------------------------------------
*/

function encode(message) {

    return `${JSON.stringify(message)}\n`;
}


function takeLine(buffer, onDiagnostic) {

    const newline =
        buffer.indexOf(0x0a);

    if (newline === -1) {

        /*
        | A server that never sends a newline would otherwise grow
        | this buffer without bound. The ceiling is read here rather
        | than captured, so it can be retuned while a run is going.
        */

        const ceiling =
            require("../../lib/storage").get("MCP_MAX_MESSAGE_BYTES");

        if (buffer.length > ceiling) {

            if (onDiagnostic) {

                onDiagnostic(
                    `discarding an unterminated message larger than ${ceiling} bytes`
                );
            }

            return {
                consumed: true,
                buffer: Buffer.alloc(0),
                line: null,
                overflow: true
            };
        }

        return { consumed: false, buffer };
    }

    const line =
        buffer.slice(0, newline).toString("utf8").trim();

    return {
        consumed: true,
        buffer: buffer.slice(newline + 1),
        line
    };
}


module.exports = {
    encode,
    takeLine
};
