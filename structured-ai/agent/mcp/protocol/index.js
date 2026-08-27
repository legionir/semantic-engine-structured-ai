"use strict";

/*
|--------------------------------------------------------------------------
| MCP Wire Protocol — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| JSON-RPC envelope, Content-Length / NDJSON framing, and the SSE
| event-stream decoder. Historical require("./protocol") stays a
| wrapper over this module.
|--------------------------------------------------------------------------
*/

const jsonrpc = require("./JsonRpcCodec");
const contentLength = require("./ContentLengthCodec");
const ndjson = require("./NdjsonCodec");
const errors = require("./McpErrors");


const FRAMING = {
    CONTENT_LENGTH: "content-length",
    NDJSON: "ndjson",
    AUTO: "auto"
};


function encode(message, framing) {

    if (framing === FRAMING.NDJSON) {
        return ndjson.encode(message);
    }

    return contentLength.encode(message);
}


class MessageDecoder {

    constructor(onMessage, onDiagnostic) {

        this.buffer = Buffer.alloc(0);

        this.onMessage = onMessage || (() => {});

        this.onDiagnostic = onDiagnostic || (() => {});

        /*
        | Which framing the last decoded message used, so a transport
        | can answer a server in the framing that server speaks.
        */

        this.lastFraming = null;
    }


    reset() {

        this.buffer = Buffer.alloc(0);
    }


    push(chunk) {

        this.buffer =
            Buffer.concat([
                this.buffer,
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8")
            ]);

        this.drain();
    }


    /*
    | The buffer may hold a header framed message, a bare line, or the
    | first bytes of either. Anything incomplete stays in the buffer.
    */

    drain() {

        for (;;) {

            if (this.buffer.length === 0) {
                return;
            }

            const looksFramed =
                this.startsWithHeader();

            if (looksFramed === "pending") {
                return;
            }

            const consumed =
                looksFramed
                    ? this.takeFramed()
                    : this.takeLine();

            if (!consumed) {
                return;
            }
        }
    }


    /*
    | "pending" means the buffer is too short to tell the two framings
    | apart yet, which happens when a chunk boundary lands inside the
    | word Content-Length.
    */

    startsWithHeader() {

        return contentLength.startsWithHeader(this.buffer);
    }


    takeFramed() {

        const taken =
            contentLength.takeFramed(this.buffer, text => this.onDiagnostic(text));

        this.buffer = taken.buffer;

        if (!taken.consumed) {
            return false;
        }

        if (taken.body !== null && taken.body !== undefined) {

            this.lastFraming = FRAMING.CONTENT_LENGTH;

            this.deliver(taken.body);
        }

        return true;
    }


    takeLine() {

        const taken =
            ndjson.takeLine(this.buffer, text => this.onDiagnostic(text));

        this.buffer = taken.buffer;

        if (!taken.consumed) {
            return false;
        }

        if (taken.overflow) {
            return true;
        }

        if (taken.line !== "") {

            this.lastFraming = FRAMING.NDJSON;

            this.deliver(taken.line);
        }

        return true;
    }


    deliver(text) {

        let message;

        try {

            message = JSON.parse(text);

        } catch (error) {

            this.onDiagnostic(
                `message is not valid JSON (${error.message}): ${text.slice(0, 200)}`
            );

            return;
        }

        this.onMessage(message);
    }
}


/*
| Server sent events carry the same JSON-RPC messages, one per "data:"
| field, with events separated by a blank line.
*/

class EventStreamDecoder {

    constructor(onEvent, onDiagnostic) {

        this.buffer = "";

        this.onEvent = onEvent || (() => {});

        this.onDiagnostic = onDiagnostic || (() => {});
    }


    push(chunk) {

        this.buffer +=
            Buffer.isBuffer(chunk)
                ? chunk.toString("utf8")
                : String(chunk);

        for (;;) {

            const boundary =
                this.findBoundary();

            if (boundary === -1) {
                return;
            }

            const block =
                this.buffer.slice(0, boundary.index);

            this.buffer =
                this.buffer.slice(boundary.index + boundary.length);

            this.emitBlock(block);
        }
    }


    findBoundary() {

        const candidates = [
            { index: this.buffer.indexOf("\n\n"), length: 2 },
            { index: this.buffer.indexOf("\r\n\r\n"), length: 4 }
        ].filter(candidate => candidate.index !== -1);

        if (candidates.length === 0) {
            return -1;
        }

        return candidates.sort(
            (a, b) => a.index - b.index
        )[0];
    }


    emitBlock(block) {

        let event = "message";

        const data = [];

        for (const rawLine of block.split(/\r?\n/)) {

            const line = rawLine.trimEnd();

            if (line === "" || line.startsWith(":")) {
                continue;
            }

            const colon = line.indexOf(":");

            const field =
                colon === -1 ? line : line.slice(0, colon);

            const value =
                colon === -1
                    ? ""
                    : line.slice(colon + 1).replace(/^ /, "");

            if (field === "event") {
                event = value;
            } else if (field === "data") {
                data.push(value);
            }
        }

        if (data.length === 0) {
            return;
        }

        this.onEvent({
            event,
            data: data.join("\n")
        });
    }
}


module.exports = {
    ...jsonrpc,
    ...errors,
    FRAMING,
    encode,
    MessageDecoder,
    EventStreamDecoder
};
