/*
|--------------------------------------------------------------------------
| MCP Wire Protocol
|--------------------------------------------------------------------------
|
| Every MCP transport speaks the same language: JSON-RPC 2.0 messages.
| Only the way those messages are wrapped differs, so the envelope, the
| framing and the result unpacking live here once and every transport
| borrows them.
|
|   stdio      Content-Length headers, or one JSON object per line
|   http       one POST per message, answer in the response body
|   sse        POST to send, a long lived event stream to receive
|   websocket  one JSON object per text frame
|
| A server that answers "tools/call" returns its payload wrapped in a
| content array. The runtime wants the payload, so unpacking is part of
| the protocol rather than something every call site repeats.
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

const FRAMING = {
    CONTENT_LENGTH: "content-length",
    NDJSON: "ndjson",
    AUTO: "auto"
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


/*
|--------------------------------------------------------------------------
| Framing
|--------------------------------------------------------------------------
|
| Two framings exist in the wild. The specification says one JSON object
| per line; the language server tradition, which the semantic engine
| sidecar follows, says a Content-Length header. A decoder that only
| understood one of them would work with half the servers, so it
| understands both and decides per message.
|--------------------------------------------------------------------------
*/

const HEADER_SEPARATOR = "\r\n\r\n";

const CONTENT_LENGTH_PATTERN = /Content-Length:\s*(\d+)/i;


function encode(message, framing) {

    const body =
        JSON.stringify(message);

    if (framing === FRAMING.NDJSON) {
        return `${body}\n`;
    }

    return `Content-Length: ${
        Buffer.byteLength(body, "utf8")
    }${HEADER_SEPARATOR}${body}`;
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

        const probe =
            this.buffer
                .slice(0, 15)
                .toString("utf8")
                .toLowerCase();

        if ("content-length:".startsWith(probe)) {
            return probe === "content-length:" ? true : "pending";
        }

        return false;
    }


    takeFramed() {

        const separator =
            this.buffer.indexOf(HEADER_SEPARATOR);

        if (separator === -1) {
            return false;
        }

        const header =
            this.buffer.slice(0, separator).toString("utf8");

        const match =
            CONTENT_LENGTH_PATTERN.exec(header);

        if (!match) {

            this.onDiagnostic(
                `message header without Content-Length: ${header.slice(0, 120)}`
            );

            this.buffer =
                this.buffer.slice(separator + HEADER_SEPARATOR.length);

            return true;
        }

        const length =
            parseInt(match[1], 10);

        const end =
            separator + HEADER_SEPARATOR.length + length;

        if (this.buffer.length < end) {
            return false;
        }

        const body =
            this.buffer
                .slice(separator + HEADER_SEPARATOR.length, end)
                .toString("utf8");

        this.buffer = this.buffer.slice(end);

        this.lastFraming = FRAMING.CONTENT_LENGTH;

        this.deliver(body);

        return true;
    }


    takeLine() {

        const newline =
            this.buffer.indexOf(0x0a);

        if (newline === -1) {

            /*
            | A server that never sends a newline would otherwise grow
            | this buffer without bound. The ceiling is read here rather
            | than captured, so it can be retuned while a run is going.
            */

            const ceiling =
                require("../lib/storage").get("MCP_MAX_MESSAGE_BYTES");

            if (this.buffer.length > ceiling) {

                this.onDiagnostic(
                    `discarding an unterminated message larger than ${ceiling} bytes`
                );

                this.reset();
            }

            return false;
        }

        const line =
            this.buffer.slice(0, newline).toString("utf8").trim();

        this.buffer = this.buffer.slice(newline + 1);

        if (line !== "") {

            this.lastFraming = FRAMING.NDJSON;

            this.deliver(line);
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
    JSONRPC_VERSION,
    PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    CLIENT_INFO,
    FRAMING,
    nextId,
    request,
    notification,
    isResponse,
    isNotification,
    toError,
    unpackToolResult,
    encode,
    MessageDecoder,
    EventStreamDecoder
};
