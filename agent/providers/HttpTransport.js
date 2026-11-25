"use strict";

/*
|--------------------------------------------------------------------------
| HTTP Transport
|--------------------------------------------------------------------------
|
| The only place the provider layer touches the network. It supports native
| fetch when no proxy is configured and Node HTTP agents for explicit HTTP or
| SOCKS5 proxies. Proxy settings are read for every request, so console changes
| affect the next provider call without rebuilding the router.
|
|   request({ method, url, headers, body, signal, timeoutMs })
|     -> { status, header(name), text(), body }
|--------------------------------------------------------------------------
*/

const http = require("http");
const https = require("https");
const settings = require("../config");


function timeoutError(timeoutMs) {

    const error = new Error(`the request timed out after ${timeoutMs} ms`);

    error.name = "TimeoutError";

    return error;
}


function proxyAgentFor(targetUrl, proxyUrl) {

    const proxyProtocol = new URL(proxyUrl).protocol;

    if (proxyProtocol === "socks5:" || proxyProtocol === "socks5h:") {
        const { SocksProxyAgent } = require("socks-proxy-agent");
        return new SocksProxyAgent(proxyUrl, { keepAlive: false });
    }

    if (targetUrl.protocol === "https:") {
        const { HttpsProxyAgent } = require("https-proxy-agent");
        return new HttpsProxyAgent(proxyUrl, { keepAlive: false });
    }

    const { HttpProxyAgent } = require("http-proxy-agent");
    return new HttpProxyAgent(proxyUrl, { keepAlive: false });
}


function sanitizeProxyError(error) {

    const message = error && error.message ? error.message : String(error);

    return message.replace(/(\/\/)[^/@\s]+@/g, "$1***@");
}


function requestThroughProxy({ method, url, headers, body, signal, timeoutMs }, proxyUrl) {

    const targetUrl = new URL(url);
    const protocol = targetUrl.protocol === "https:" ? https : http;
    const agent = proxyAgentFor(targetUrl, proxyUrl);
    const controller = new AbortController();
    let timer = null;
    let request = null;
    let cleaned = false;

    const onAbort = () => controller.abort(signal.reason);

    if (signal) {
        if (signal.aborted) {
            controller.abort(signal.reason);
        } else {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    }

    const cleanup = () => {

        if (cleaned) return;
        cleaned = true;

        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        agent.destroy();
    };

    if (timeoutMs > 0) {
        timer = setTimeout(() => {
            const error = timeoutError(timeoutMs);
            controller.abort(error);
            if (request) request.destroy(error);
        }, timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
    }

    return new Promise((resolve, reject) => {

        if (controller.signal.aborted) {
            cleanup();
            reject(controller.signal.reason || new Error("request aborted"));
            return;
        }

        request = protocol.request(targetUrl, {
            method,
            headers,
            agent,
            signal: controller.signal
        }, response => {

            response.on("error", cleanup);

            resolve({
                status: response.statusCode || 0,
                header: name => {
                    const value = response.headers[String(name).toLowerCase()];
                    return Array.isArray(value) ? value.join(", ") : value || null;
                },
                async text() {
                    const chunks = [];
                    try {
                        for await (const chunk of response) chunks.push(Buffer.from(chunk));
                        return Buffer.concat(chunks).toString("utf8");
                    } finally {
                        cleanup();
                    }
                },
                body: (async function* () {
                    try {
                        for await (const chunk of response) yield chunk;
                    } finally {
                        cleanup();
                    }
                })()
            });
        });

        request.once("error", error => {
            cleanup();
            const reason = controller.signal.reason;
            if (reason instanceof Error && reason.name === "TimeoutError") {
                reject(reason);
                return;
            }
            if (controller.signal.aborted) {
                const aborted = new Error("The request was aborted");
                aborted.name = "AbortError";
                if (reason instanceof Error) aborted.cause = reason;
                reject(aborted);
                return;
            }
            reject(new Error(sanitizeProxyError(error)));
        });

        request.end(
            body === undefined || body === null
                ? undefined
                : typeof body === "string" || Buffer.isBuffer(body)
                    ? body
                    : JSON.stringify(body)
        );
    });
}


const httpTransport = {

    async request({ method = "POST", url, headers = {}, body, signal, timeoutMs = 0 }) {

        const proxyUrl = settings.get("AGENT_PROXY_URL");

        if (proxyUrl) {
            return requestThroughProxy(
                { method, url, headers, body, signal, timeoutMs },
                proxyUrl
            );
        }

        if (typeof fetch !== "function") {
            throw new Error("this Node.js version has no fetch(); Node 18 or newer is required");
        }

        const controller = new AbortController();

        const onAbort = () => controller.abort(signal.reason);

        if (signal) {

            if (signal.aborted) {
                controller.abort(signal.reason);
            } else {
                signal.addEventListener("abort", onAbort, { once: true });
            }
        }

        let timer = null;

        if (timeoutMs > 0) {

            timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);

            if (typeof timer.unref === "function") {
                timer.unref();
            }
        }

        const cleanup = () => {

            if (timer) {
                clearTimeout(timer);
            }

            if (signal) {
                signal.removeEventListener("abort", onAbort);
            }
        };

        let response;

        try {

            response = await fetch(url, {
                method,
                headers,
                body:
                    body === undefined || body === null || typeof body === "string"
                        ? body
                        : JSON.stringify(body),
                signal: controller.signal
            });

        } catch (error) {

            cleanup();

            const reason = controller.signal.reason;

            if (reason instanceof Error && reason.name === "TimeoutError") {
                throw reason;
            }

            throw error;
        }

        return {
            status: response.status,

            header: name => response.headers.get(name),

            async text() {

                try {
                    return await response.text();
                } finally {
                    cleanup();
                }
            },

            body: (async function* () {

                try {

                    if (response.body) {

                        for await (const chunk of response.body) {
                            yield chunk;
                        }
                    }

                } finally {
                    cleanup();
                }
            })()
        };
    }
};


module.exports = {
    httpTransport,
    proxyAgentFor,
    sanitizeProxyError
};
