const http = require("http");
const https = require("https");

const protocol = require("../protocol");
const { normalizeEndpoint } = require("./HttpTransport");


/*
|--------------------------------------------------------------------------
| HTTP + SSE Transport
|--------------------------------------------------------------------------
|
| The transport that came before Streamable HTTP, and the one a good
| number of deployed servers still speak. It uses two channels:
|
|   GET  /sse       a stream that stays open and delivers every message
|                   the server sends, starting with an "endpoint" event
|                   naming where the client must post
|   POST <endpoint> one request per message, answered with 202
|
| The answer to a request therefore does not arrive on the POST, it
| arrives later on the stream, which is why this transport keeps its own
| table of calls that are still waiting.
|--------------------------------------------------------------------------
*/

function agentFor(url) {

    return url.protocol === "https:" ? https : http;
}


class SseTransport {

    static get kind() {

        return "sse";
    }


    constructor(config = {}) {

        this.config = config;

        this.name = config.name || "sse";

        if (!config.url) {

            throw new Error(
                `MCP server "${this.name}" has no url.`
            );
        }

        this.streamUrl =
            new URL(config.url);

        /*
        | A base URL with no path means the conventional /sse mount.
        */

        if (this.streamUrl.pathname === "" || this.streamUrl.pathname === "/") {
            this.streamUrl.pathname = "/sse";
        }

        this.postUrl = null;

        this.stream = null;

        this.streamRequest = null;

        this.openPromise = null;

        this.pending = new Map();

        this.negotiatedVersion = null;

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

        return Boolean(this.stream && this.postUrl);
    }


    describe() {

        return {
            kind: SseTransport.kind,

            url: this.streamUrl.toString(),

            post_url:
                this.postUrl ? this.postUrl.toString() : null,

            connected: this.isConnected()
        };
    }


    setProtocolVersion(version) {

        this.negotiatedVersion = version;
    }


    headers(extra = {}) {

        const headers = {
            ...(this.config.headers || {}),
            ...extra
        };

        if (this.config.token) {
            headers.authorization = `Bearer ${this.config.token}`;
        }

        if (this.negotiatedVersion) {
            headers["mcp-protocol-version"] = this.negotiatedVersion;
        }

        return headers;
    }


    /*
    | The stream has to be open, and the endpoint event has to have
    | arrived, before anything can be sent. Both are one promise.
    */

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

                const timeoutMs =
                    this.config.connectTimeoutMs || 15000;

                const timer =
                    setTimeout(() => {

                        reject(
                            new Error(
                                `MCP server "${this.name}" did not send an endpoint event within ${timeoutMs}ms.`
                            )
                        );

                        this.destroyStream();
                    }, timeoutMs);

                if (typeof timer.unref === "function") {
                    timer.unref();
                }

                const decoder =
                    new protocol.EventStreamDecoder(
                        event => {

                            if (event.event === "endpoint") {

                                try {

                                    this.postUrl =
                                        new URL(event.data, this.streamUrl);

                                    clearTimeout(timer);

                                    resolve(this);

                                } catch (error) {

                                    clearTimeout(timer);

                                    reject(
                                        new Error(
                                            `MCP server "${this.name}" sent an unusable endpoint "${event.data}": ${error.message}`
                                        )
                                    );
                                }

                                return;
                            }

                            this.receiveEvent(event);
                        },
                        text => this.diagnose(text)
                    );

                const request =
                    agentFor(this.streamUrl).request(
                        this.streamUrl,
                        {
                            method: "GET",

                            headers: this.headers({
                                accept: "text/event-stream",
                                "cache-control": "no-cache"
                            })
                        },
                        response => {

                            if (response.statusCode !== 200) {

                                clearTimeout(timer);

                                response.resume();

                                reject(
                                    new Error(
                                        `MCP server "${this.name}" answered ${response.statusCode} on the event stream.`
                                    )
                                );

                                return;
                            }

                            this.stream = response;

                            response.on("data", chunk => decoder.push(chunk));

                            response.on("end", () => {

                                this.handleStreamEnd();
                            });

                            response.on("error", error => {

                                this.diagnose(
                                    `event stream error: ${error.message}`
                                );

                                this.handleStreamEnd();
                            });
                        }
                    );

                request.on("error", error => {

                    clearTimeout(timer);

                    this.openPromise = null;

                    reject(
                        new Error(
                            `MCP server "${this.name}" is unreachable: ${error.message}`
                        )
                    );
                });

                request.end();

                this.streamRequest = request;
            });

        this.openPromise =
            this.openPromise.catch(error => {

                this.openPromise = null;

                throw error;
            });

        return this.openPromise;
    }


    receiveEvent(event) {

        let payload;

        try {

            payload = JSON.parse(event.data);

        } catch {

            this.diagnose(
                `event stream carried a non JSON payload: ${event.data.slice(0, 200)}`
            );

            return;
        }

        if (protocol.isResponse(payload)) {

            const waiting =
                this.pending.get(payload.id);

            if (!waiting) {
                return;
            }

            this.pending.delete(payload.id);

            clearTimeout(waiting.timer);

            if (payload.error) {

                waiting.reject(
                    protocol.toError(payload.error, waiting.context)
                );

                return;
            }

            waiting.resolve(payload.result);

            return;
        }

        if (protocol.isNotification(payload)) {
            this.notificationHandler(payload);
        }
    }


    handleStreamEnd() {

        const wasOpen = Boolean(this.stream);

        this.stream = null;

        this.postUrl = null;

        this.openPromise = null;

        this.rejectAll(
            new Error(
                `MCP server "${this.name}" closed the event stream.`
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


    postMessage(message, timeoutMs) {

        const body =
            JSON.stringify(message);

        return new Promise((resolve, reject) => {

            const request =
                agentFor(this.postUrl).request(
                    this.postUrl,
                    {
                        method: "POST",

                        headers: this.headers({
                            "content-type": "application/json",
                            "content-length": Buffer.byteLength(body)
                        }),

                        timeout: timeoutMs
                    },
                    response => {

                        const chunks = [];

                        response.on("data", chunk => chunks.push(chunk));

                        response.on("end", () => {

                            if (response.statusCode >= 400) {

                                reject(
                                    new Error(
                                        `MCP server "${this.name}" answered ${
                                            response.statusCode
                                        } to a posted message: ${
                                            Buffer.concat(chunks).toString("utf8").slice(0, 300)
                                        }`
                                    )
                                );

                                return;
                            }

                            resolve();
                        });
                    }
                );

            request.on("timeout", () => {

                request.destroy();

                reject(
                    new Error(
                        `MCP server "${this.name}" did not accept "${message.method}" within ${timeoutMs}ms.`
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

            request.write(body);

            request.end();
        });
    }


    async request(message, options = {}) {

        await this.connect();

        const timeoutMs =
            options.timeoutMs || 30000;

        const answer =
            new Promise((resolve, reject) => {

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
            });

        try {

            await this.postMessage(message, timeoutMs);

        } catch (error) {

            const waiting =
                this.pending.get(message.id);

            if (waiting) {

                clearTimeout(waiting.timer);

                this.pending.delete(message.id);
            }

            throw error;
        }

        return answer;
    }


    async send(message, options = {}) {

        await this.connect();

        await this.postMessage(
            message,
            options.timeoutMs || 10000
        );
    }


    destroyStream() {

        try {

            if (this.stream) {
                this.stream.destroy();
            }

        } catch {
            /* already gone */
        }

        try {

            if (this.streamRequest) {
                this.streamRequest.destroy();
            }

        } catch {
            /* already gone */
        }

        this.stream = null;

        this.streamRequest = null;

        this.postUrl = null;

        this.openPromise = null;
    }


    async close() {

        this.closed = true;

        this.rejectAll(
            new Error(
                `MCP server "${this.name}" was shut down.`
            )
        );

        this.destroyStream();
    }
}


module.exports = {
    SseTransport
};
