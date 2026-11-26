const http = require("http");
const https = require("https");

const protocol = require("../protocol");


/*
|--------------------------------------------------------------------------
| Streamable HTTP Transport
|--------------------------------------------------------------------------
|
| One POST carries one message. The server may answer with a JSON body,
| or with an event stream when it wants to send progress notifications
| before the result. Both are handled here, because which one arrives is
| the server's choice and not something a call site should care about.
|
| A session id handed out by the server on initialize is echoed on every
| later request, which is what lets a stateful server keep the session.
|--------------------------------------------------------------------------
*/

const DEFAULT_PATHS = [
    "/mcp",
    "/"
];


function agentFor(url) {

    return url.protocol === "https:" ? https : http;
}


function normalizeEndpoint(rawUrl) {

    const url = new URL(rawUrl);

    /*
    | A base URL without a path is pointed at /mcp, the conventional
    | mount point, so a configuration only has to name the host.
    */

    if (url.pathname === "" || url.pathname === "/") {
        url.pathname = DEFAULT_PATHS[0];
    }

    return url;
}


class HttpTransport {

    static get kind() {

        return "http";
    }


    constructor(config = {}) {

        this.config = config;

        this.name = config.name || "http";

        this.endpoint =
            normalizeEndpoint(
                config.url ||
                (() => {
                    throw new Error(
                        `MCP server "${this.name}" has no url.`
                    );
                })()
            );

        this.sessionId = null;

        this.negotiatedVersion = null;

        this.connected = false;

        this.notificationHandler = () => {};

        this.requestHandler = null;

        this.diagnosticHandler = () => {};

        this.closeHandler = () => {};

        /*
        | P4-08: a server declared with oauth signs in once from the
        | console; its access token is attached here and refreshed when
        | it expires or a 401 says it no longer works.
        */
        this.auth =
            config.oauth
                ? require("../McpOAuth").providerFor(config)
                : null;
    }


    /*
    | P4-10: a server may send its own requests (elicitation, sampling)
    | inside a streamed answer; the result goes back in a new POST.
    */
    onRequest(handler) {

        this.requestHandler = handler || null;
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

        return this.connected;
    }


    describe() {

        return {
            kind: HttpTransport.kind,

            url: this.endpoint.toString(),

            connected: this.connected,

            session_id: this.sessionId
        };
    }


    async connect() {

        this.connected = true;

        return this;
    }


    headers(extra = {}) {

        const headers = {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            ...(this.config.headers || {}),
            ...extra
        };

        if (this.config.token) {
            headers.authorization = `Bearer ${this.config.token}`;
        }

        if (this.accessToken) {
            headers.authorization = `Bearer ${this.accessToken}`;
        }

        if (this.sessionId) {
            headers["mcp-session-id"] = this.sessionId;
        }

        if (this.negotiatedVersion) {
            headers["mcp-protocol-version"] = this.negotiatedVersion;
        }

        return headers;
    }


    /*
    | The transport is told the negotiated protocol version by the
    | client after initialize, because the header is required on every
    | later request by servers that implement the current revision.
    */

    setProtocolVersion(version) {

        this.negotiatedVersion = version;
    }


    async post(message, options = {}) {

        if (!this.auth) {
            return this.postOnce(message, options);
        }

        /* P4-08: a valid token first; one refresh and retry on a 401 */
        this.accessToken = await this.auth.accessToken();

        try {

            return await this.postOnce(message, options);

        } catch (error) {

            if (!error.unauthorized) {
                throw error;
            }

            this.accessToken = await this.auth.afterUnauthorized(error.wwwAuthenticate);

            return this.postOnce(message, options);
        }
    }


    postOnce(message, options = {}) {

        const timeoutMs =
            options.timeoutMs || 30000;

        const body =
            JSON.stringify(message);

        return new Promise((resolve, reject) => {

            const request =
                agentFor(this.endpoint).request(
                    this.endpoint,
                    {
                        method: "POST",

                        headers: this.headers({
                            "content-length": Buffer.byteLength(body)
                        }),

                        timeout: timeoutMs
                    },
                    response => {

                        if (response.statusCode === 401) {

                            response.resume();

                            const error =
                                new Error(
                                    `MCP server "${this.name}" answered 401: ${
                                        this.auth || this.config.oauth
                                            ? "the sign-in is missing or expired; sign in again from the console"
                                            : "it needs credentials (a token, or oauth: true to sign in from the console)"
                                    }`
                                );

                            error.unauthorized = true;
                            error.code = "MCP_UNAUTHORIZED";
                            error.wwwAuthenticate = response.headers["www-authenticate"] || null;

                            reject(error);

                            return;
                        }

                        const sessionId =
                            response.headers["mcp-session-id"];

                        if (sessionId) {
                            this.sessionId = sessionId;
                        }

                        const type =
                            String(response.headers["content-type"] || "");

                        if (type.includes("text/event-stream")) {

                            this.readEventStream(
                                response,
                                message,
                                resolve,
                                reject
                            );

                            return;
                        }

                        this.readJson(
                            response,
                            message,
                            resolve,
                            reject
                        );
                    }
                );

            request.on("timeout", () => {

                request.destroy();

                reject(
                    new Error(
                        `MCP request "${message.method}" to "${this.name}" timed out after ${timeoutMs}ms.`
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


    readJson(response, message, resolve, reject) {

        const chunks = [];

        response.on("data", chunk => chunks.push(chunk));

        response.on("end", () => {

            const text =
                Buffer.concat(chunks).toString("utf8");

            /*
            | 202 with no body is the correct answer to a notification,
            | and there is nothing to parse.
            */

            if (response.statusCode === 202 || text.trim() === "") {

                resolve(undefined);

                return;
            }

            if (response.statusCode >= 400) {

                reject(
                    new Error(
                        `MCP server "${this.name}" answered ${response.statusCode}: ${text.slice(0, 300)}`
                    )
                );

                return;
            }

            let payload;

            try {

                payload = JSON.parse(text);

            } catch {

                reject(
                    new Error(
                        `MCP server "${this.name}" answered with a body that is not JSON: ${text.slice(0, 300)}`
                    )
                );

                return;
            }

            this.settle(payload, message, resolve, reject);
        });
    }


    /*
    | A streamed answer may carry notifications before the response that
    | belongs to this request. Notifications are forwarded, and the
    | first matching response ends the stream.
    */

    readEventStream(response, message, resolve, reject) {

        let settled = false;

        const decoder =
            new protocol.EventStreamDecoder(
                event => {

                    if (settled) {
                        return;
                    }

                    let payload;

                    try {

                        payload = JSON.parse(event.data);

                    } catch {

                        this.diagnose(
                            `event stream carried a non JSON payload: ${event.data.slice(0, 200)}`
                        );

                        return;
                    }

                    if (
                        protocol.isResponse(payload) &&
                        payload.id === message.id
                    ) {

                        settled = true;

                        response.destroy();

                        this.settle(payload, message, resolve, reject);

                        return;
                    }

                    if (protocol.isNotification(payload)) {
                        this.notificationHandler(payload);
                        return;
                    }

                    if (
                        payload &&
                        typeof payload.method === "string" &&
                        payload.id !== undefined &&
                        payload.id !== null
                    ) {
                        this.answerServerRequest(payload);
                    }
                },
                text => this.diagnose(text)
            );

        response.on("data", chunk => decoder.push(chunk));

        response.on("end", () => {

            if (settled) {
                return;
            }

            /*
            | A stream that ends without answering is only correct for
            | a notification, which has no id to wait for.
            */

            if (message.id === undefined) {

                resolve(undefined);

                return;
            }

            reject(
                new Error(
                    `MCP server "${this.name}" closed the stream without answering "${message.method}".`
                )
            );
        });
    }


    settle(payload, message, resolve, reject) {

        const envelope =
            Array.isArray(payload)
                ? payload.find(
                    item =>
                        protocol.isResponse(item) &&
                        item.id === message.id
                )
                : payload;

        if (!envelope) {

            resolve(undefined);

            return;
        }

        if (envelope.error) {

            reject(
                protocol.toError(
                    envelope.error,
                    `${this.name}/${message.method}`
                )
            );

            return;
        }

        resolve(envelope.result);
    }


    answerServerRequest(message) {

        const handler =
            this.requestHandler ||
            (request => {
                if (request.method === "ping") return {};
                throw Object.assign(new Error(`method "${request.method}" is not supported by this client`), { code: -32601 });
            });

        Promise.resolve()
            .then(() => handler(message))
            .then(
                result => protocol.response(message.id, result),
                error => protocol.errorResponse(
                    message.id,
                    error && Number.isInteger(error.code) ? error.code : -32603,
                    (error && error.message) || "internal error"
                )
            )
            .then(answer => this.post(answer, { timeoutMs: 30000 }))
            .catch(error => this.diagnose(`could not answer "${message.method}": ${error.message}`));
    }


    async request(message, options = {}) {

        return this.post(message, options);
    }


    async send(message, options = {}) {

        await this.post(message, options);
    }


    async close() {

        /*
        | A stateful server keeps resources for a session, and the
        | specification says the client should say when it is done.
        */

        if (this.sessionId) {

            await new Promise(resolve => {

                const request =
                    agentFor(this.endpoint).request(
                        this.endpoint,
                        {
                            method: "DELETE",
                            headers: this.headers(),
                            timeout: 2000
                        },
                        response => {

                            response.resume();

                            response.on("end", resolve);
                        }
                    );

                request.on("error", () => resolve());

                request.on("timeout", () => {

                    request.destroy();

                    resolve();
                });

                request.end();

            }).catch(() => {});
        }

        this.sessionId = null;

        this.connected = false;

        this.closeHandler({ code: 0, signal: null });
    }
}


module.exports = {
    HttpTransport,
    normalizeEndpoint
};
