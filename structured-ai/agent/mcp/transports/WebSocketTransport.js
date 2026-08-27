const crypto = require("crypto");
const http = require("http");
const https = require("https");

const settings = require("../../lib/storage");

const protocol = require("../protocol");


/*
|--------------------------------------------------------------------------
| WebSocket Transport
|--------------------------------------------------------------------------
|
| One socket, messages in both directions, one JSON-RPC object per text
| frame. This runtime has no dependencies and is not going to grow one
| for a framing format that fits on a page, so RFC 6455 is spoken
| directly: the HTTP upgrade handshake, masked client frames, server
| frames that arrive unmasked and possibly fragmented, and the control
| frames that keep the connection honest.
|
|   client ──► masked text frame  ──► server
|   client ◄── unmasked text frame ◄── server
|   ping ──► pong, automatically, or the peer hangs up on us
|--------------------------------------------------------------------------
*/

const OPCODE = {
    CONTINUATION: 0x0,
    TEXT: 0x1,
    BINARY: 0x2,
    CLOSE: 0x8,
    PING: 0x9,
    PONG: 0xa
};

const GUID = "258EAFA5-E914-47DA-95CA-5AB0DC85B11F";


/*
| Read per frame rather than captured, so lowering the ceiling from the
| console applies to the next frame and not to the next process.
*/

function maxMessageBytes() {

    return settings.get("MCP_MAX_MESSAGE_BYTES");
}


function acceptValue(key) {

    return crypto
        .createHash("sha1")
        .update(key + GUID)
        .digest("base64");
}


/*
| A client frame must be masked with a fresh random key, and the payload
| length is encoded in one of three widths depending on its size.
*/

function encodeFrame(opcode, payload) {

    const body =
        Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(String(payload || ""), "utf8");

    const length = body.length;

    const header =
        length < 126
            ? Buffer.alloc(2)
            : length < 65536
                ? Buffer.alloc(4)
                : Buffer.alloc(10);

    header[0] = 0x80 | opcode;

    if (length < 126) {

        header[1] = 0x80 | length;

    } else if (length < 65536) {

        header[1] = 0x80 | 126;

        header.writeUInt16BE(length, 2);

    } else {

        header[1] = 0x80 | 127;

        header.writeBigUInt64BE(BigInt(length), 2);
    }

    const mask =
        crypto.randomBytes(4);

    const masked =
        Buffer.allocUnsafe(length);

    for (let index = 0; index < length; index += 1) {
        masked[index] = body[index] ^ mask[index % 4];
    }

    return Buffer.concat([header, mask, masked]);
}


/*
| Returns the first complete frame in the buffer, or null when more
| bytes are needed. The caller keeps the remainder.
*/

function decodeFrame(buffer) {

    if (buffer.length < 2) {
        return null;
    }

    const fin = (buffer[0] & 0x80) !== 0;

    const opcode = buffer[0] & 0x0f;

    const masked = (buffer[1] & 0x80) !== 0;

    let length = buffer[1] & 0x7f;

    let offset = 2;

    if (length === 126) {

        if (buffer.length < offset + 2) {
            return null;
        }

        length = buffer.readUInt16BE(offset);

        offset += 2;

    } else if (length === 127) {

        if (buffer.length < offset + 8) {
            return null;
        }

        const big = buffer.readBigUInt64BE(offset);

        const ceiling = maxMessageBytes();

        if (big > BigInt(ceiling)) {

            throw new Error(
                `websocket frame of ${big} bytes exceeds the ${ceiling} byte limit`
            );
        }

        length = Number(big);

        offset += 8;
    }

    /*
    | A server must not mask, but a frame that is masked anyway is
    | still readable, and refusing it would help nobody.
    */

    let mask = null;

    if (masked) {

        if (buffer.length < offset + 4) {
            return null;
        }

        mask = buffer.slice(offset, offset + 4);

        offset += 4;
    }

    if (buffer.length < offset + length) {
        return null;
    }

    let payload =
        buffer.slice(offset, offset + length);

    if (mask) {

        const unmasked = Buffer.allocUnsafe(length);

        for (let index = 0; index < length; index += 1) {
            unmasked[index] = payload[index] ^ mask[index % 4];
        }

        payload = unmasked;
    }

    return {
        fin,
        opcode,
        payload,
        rest: buffer.slice(offset + length)
    };
}


class WebSocketTransport {

    static get kind() {

        return "websocket";
    }


    constructor(config = {}) {

        this.config = config;

        this.name = config.name || "websocket";

        if (!config.url) {

            throw new Error(
                `MCP server "${this.name}" has no url.`
            );
        }

        this.url = new URL(config.url);

        if (!["ws:", "wss:"].includes(this.url.protocol)) {

            throw new Error(
                `MCP server "${this.name}" needs a ws:// or wss:// url, received "${this.url.protocol}".`
            );
        }

        this.socket = null;

        this.openPromise = null;

        this.pending = new Map();

        this.buffer = Buffer.alloc(0);

        this.fragments = [];

        this.fragmentOpcode = null;

        this.closed = false;

        this.notificationHandler = () => {};

        this.diagnosticHandler = () => {};

        this.closeHandler = () => {};
    }


    onNotification(handler) {

        this.notificationHandler = handler || (() => {});
    }


    onDiagnostic(handler) {

        this.diagnosticHandler = handler || (() => {});
    }


    onClose(handler) {

        this.closeHandler = handler || (() => {});
    }


    diagnose(text) {

        this.diagnosticHandler(String(text));
    }


    isConnected() {

        return Boolean(
            this.socket &&
            !this.socket.destroyed
        );
    }


    describe() {

        return {
            kind: WebSocketTransport.kind,

            url: this.url.toString(),

            connected: this.isConnected()
        };
    }


    setProtocolVersion() {

        /* the version travels in the initialize result, not in a header */
    }


    connect() {

        if (this.isConnected()) {
            return Promise.resolve(this);
        }

        if (this.openPromise) {
            return this.openPromise;
        }

        this.closed = false;

        this.openPromise =
            new Promise((resolve, reject) => {

                const key =
                    crypto.randomBytes(16).toString("base64");

                const secure =
                    this.url.protocol === "wss:";

                const target =
                    new URL(this.url.toString());

                target.protocol = secure ? "https:" : "http:";

                const headers = {
                    connection: "Upgrade",
                    upgrade: "websocket",
                    "sec-websocket-key": key,
                    "sec-websocket-version": "13",
                    ...(this.config.headers || {})
                };

                if (this.config.token) {
                    headers.authorization = `Bearer ${this.config.token}`;
                }

                /*
                | Some servers only accept a socket that asks for the
                | mcp subprotocol, and one that does not care ignores it.
                */

                headers["sec-websocket-protocol"] = "mcp";

                const request =
                    (secure ? https : http).request(
                        target,
                        {
                            method: "GET",
                            headers,
                            timeout:
                                this.config.connectTimeoutMs || 15000
                        }
                    );

                request.on("upgrade", (response, socket, head) => {

                    const accept =
                        response.headers["sec-websocket-accept"];

                    if (accept !== acceptValue(key)) {

                        socket.destroy();

                        reject(
                            new Error(
                                `MCP server "${this.name}" completed the handshake with a wrong accept value.`
                            )
                        );

                        return;
                    }

                    socket.setNoDelay(true);

                    this.socket = socket;

                    if (head && head.length > 0) {
                        this.buffer = Buffer.from(head);
                    }

                    socket.on("data", chunk => this.receive(chunk));

                    socket.on("close", () => this.handleClose());

                    socket.on("error", error => {

                        this.diagnose(`socket error: ${error.message}`);

                        this.handleClose();
                    });

                    this.drainFrames();

                    resolve(this);
                });

                request.on("response", response => {

                    response.resume();

                    reject(
                        new Error(
                            `MCP server "${this.name}" refused the websocket upgrade with ${response.statusCode}.`
                        )
                    );
                });

                request.on("timeout", () => {

                    request.destroy();

                    reject(
                        new Error(
                            `MCP server "${this.name}" did not complete the websocket handshake in time.`
                        )
                    );
                });

                request.on("error", error => {

                    reject(
                        new Error(
                            `MCP server "${this.name}" is unreachable: ${error.message}`
                        )
                    );
                });

                request.end();
            });

        this.openPromise =
            this.openPromise.catch(error => {

                this.openPromise = null;

                throw error;
            });

        return this.openPromise;
    }


    receive(chunk) {

        this.buffer =
            Buffer.concat([this.buffer, chunk]);

        this.drainFrames();
    }


    drainFrames() {

        for (;;) {

            let frame;

            try {

                frame = decodeFrame(this.buffer);

            } catch (error) {

                this.diagnose(error.message);

                this.close();

                return;
            }

            if (!frame) {
                return;
            }

            this.buffer = frame.rest;

            this.handleFrame(frame);
        }
    }


    handleFrame(frame) {

        if (frame.opcode === OPCODE.PING) {

            this.writeFrame(OPCODE.PONG, frame.payload);

            return;
        }

        if (frame.opcode === OPCODE.PONG) {
            return;
        }

        if (frame.opcode === OPCODE.CLOSE) {

            this.writeFrame(OPCODE.CLOSE, Buffer.alloc(0));

            if (this.socket) {
                this.socket.end();
            }

            return;
        }

        if (frame.opcode === OPCODE.CONTINUATION) {

            this.fragments.push(frame.payload);

        } else {

            this.fragments = [frame.payload];

            this.fragmentOpcode = frame.opcode;
        }

        if (!frame.fin) {
            return;
        }

        const payload =
            Buffer.concat(this.fragments);

        this.fragments = [];

        if (this.fragmentOpcode === OPCODE.BINARY) {

            this.diagnose(
                "ignored a binary frame; MCP messages are text"
            );

            return;
        }

        this.deliver(payload.toString("utf8"));
    }


    deliver(text) {

        let message;

        try {

            message = JSON.parse(text);

        } catch (error) {

            this.diagnose(
                `frame is not valid JSON (${error.message}): ${text.slice(0, 200)}`
            );

            return;
        }

        if (protocol.isResponse(message)) {

            const waiting =
                this.pending.get(message.id);

            if (!waiting) {
                return;
            }

            this.pending.delete(message.id);

            clearTimeout(waiting.timer);

            if (message.error) {

                waiting.reject(
                    protocol.toError(message.error, waiting.context)
                );

                return;
            }

            waiting.resolve(message.result);

            return;
        }

        if (protocol.isNotification(message)) {
            this.notificationHandler(message);
        }
    }


    writeFrame(opcode, payload) {

        if (!this.socket || this.socket.destroyed) {

            throw new Error(
                `MCP server "${this.name}" is not connected.`
            );
        }

        this.socket.write(encodeFrame(opcode, payload));
    }


    handleClose() {

        const wasOpen = Boolean(this.socket);

        this.socket = null;

        this.openPromise = null;

        this.buffer = Buffer.alloc(0);

        this.fragments = [];

        this.rejectAll(
            new Error(
                `MCP server "${this.name}" closed the connection.`
            )
        );

        if (wasOpen && !this.closed) {
            this.closeHandler({ code: null, signal: null });
        }
    }


    rejectAll(error) {

        for (const [id, waiting] of this.pending.entries()) {

            clearTimeout(waiting.timer);

            waiting.reject(error);

            this.pending.delete(id);
        }
    }


    async request(message, options = {}) {

        await this.connect();

        const timeoutMs =
            options.timeoutMs || 30000;

        return new Promise((resolve, reject) => {

            const timer =
                setTimeout(() => {

                    if (!this.pending.has(message.id)) {
                        return;
                    }

                    this.pending.delete(message.id);

                    reject(
                        new Error(
                            `MCP request "${message.method}" to "${this.name}" timed out after ${timeoutMs}ms.`
                        )
                    );
                }, timeoutMs);

            if (typeof timer.unref === "function") {
                timer.unref();
            }

            this.pending.set(message.id, {
                resolve,
                reject,
                timer,
                context: `${this.name}/${message.method}`
            });

            try {

                this.writeFrame(
                    OPCODE.TEXT,
                    JSON.stringify(message)
                );

            } catch (error) {

                clearTimeout(timer);

                this.pending.delete(message.id);

                reject(error);
            }
        });
    }


    async send(message) {

        await this.connect();

        this.writeFrame(
            OPCODE.TEXT,
            JSON.stringify(message)
        );
    }


    async close() {

        this.closed = true;

        this.rejectAll(
            new Error(
                `MCP server "${this.name}" was shut down.`
            )
        );

        if (!this.socket || this.socket.destroyed) {

            this.socket = null;

            this.openPromise = null;

            return;
        }

        try {

            this.writeFrame(OPCODE.CLOSE, Buffer.alloc(0));

        } catch {
            /* the socket went away first */
        }

        const socket = this.socket;

        this.socket = null;

        this.openPromise = null;

        const timer =
            setTimeout(() => {

                try {

                    socket.destroy();

                } catch {
                    /* already destroyed */
                }
            }, 1000);

        if (typeof timer.unref === "function") {
            timer.unref();
        }

        socket.end();
    }
}


module.exports = {
    WebSocketTransport,
    encodeFrame,
    decodeFrame,
    acceptValue,
    OPCODE
};
