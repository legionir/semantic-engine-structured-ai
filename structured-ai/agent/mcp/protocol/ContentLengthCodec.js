"use strict";

/*
|--------------------------------------------------------------------------
| Content-Length framing — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| The language-server tradition: a Content-Length header, then the JSON
| body. The semantic-engine sidecar speaks this framing.
|--------------------------------------------------------------------------
*/

const HEADER_SEPARATOR = "\r\n\r\n";

const CONTENT_LENGTH_PATTERN = /Content-Length:\s*(\d+)/i;


function encode(message) {

    const body =
        JSON.stringify(message);

    return `Content-Length: ${
        Buffer.byteLength(body, "utf8")
    }${HEADER_SEPARATOR}${body}`;
}


function startsWithHeader(buffer) {

    const probe =
        buffer
            .slice(0, 15)
            .toString("utf8")
            .toLowerCase();

    if ("content-length:".startsWith(probe)) {
        return probe === "content-length:" ? true : "pending";
    }

    return false;
}


function takeFramed(buffer, onDiagnostic) {

    const separator =
        buffer.indexOf(HEADER_SEPARATOR);

    if (separator === -1) {
        return { consumed: false, buffer };
    }

    const header =
        buffer.slice(0, separator).toString("utf8");

    const match =
        CONTENT_LENGTH_PATTERN.exec(header);

    if (!match) {

        if (onDiagnostic) {

            onDiagnostic(
                `message header without Content-Length: ${header.slice(0, 120)}`
            );
        }

        return {
            consumed: true,
            buffer: buffer.slice(separator + HEADER_SEPARATOR.length),
            body: null
        };
    }

    const length =
        parseInt(match[1], 10);

    const end =
        separator + HEADER_SEPARATOR.length + length;

    if (buffer.length < end) {
        return { consumed: false, buffer };
    }

    const body =
        buffer
            .slice(separator + HEADER_SEPARATOR.length, end)
            .toString("utf8");

    return {
        consumed: true,
        buffer: buffer.slice(end),
        body
    };
}


module.exports = {
    HEADER_SEPARATOR,
    CONTENT_LENGTH_PATTERN,
    encode,
    startsWithHeader,
    takeFramed
};
