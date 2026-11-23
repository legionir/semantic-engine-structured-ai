"use strict";

/*
|--------------------------------------------------------------------------
| LLMProvider - the provider interface (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Every adapter extends this class and implements four hooks:
|
|   defaultBaseUrl(spec)          the vendor endpoint when none is set
|   buildHttp(request, stream)    -> { url, headers, body }
|   parseResponse(json, request)  -> chat.completion answer
|   readStream(response, request, onDelta) -> chat.completion answer
|
| complete(request, { signal, onDelta, timeoutMs }) runs one request: it
| never retries (the ProviderRouter does), it turns every failure into a
| ProviderError, and with request.stream it reports deltas
| ({ type: "text", text } | { type: "tool_call", index, id, name,
| arguments }) while it assembles the same final answer a non-streamed
| call returns.
|
| A spec is plain data: { provider, baseUrl, apiKey, model, temperature,
| headers, promptCaching, timeoutMs, ...adapter options }. It comes from
| settings (ProviderConfig), never from the environment directly.
|--------------------------------------------------------------------------
*/

const { ProviderError } = require("./ProviderError");
const { httpTransport } = require("./HttpTransport");
const { estimateRequestTokens } = require("./TokenCounter");


function trimSlash(value) {
    return String(value || "").replace(/\/+$/, "");
}


class LLMProvider {

    constructor(spec = {}, deps = {}) {

        this.spec = { ...spec };

        this.name = spec.provider || this.constructor.providerName || "unknown";

        this.baseUrl = trimSlash(spec.baseUrl || this.defaultBaseUrl(spec));

        this.apiKey = spec.apiKey || "";

        this.model = spec.model || "";

        this.temperature = spec.temperature;

        this.headers =
            spec.headers && typeof spec.headers === "object"
                ? { ...spec.headers }
                : {};

        this.promptCaching = spec.promptCaching !== false;

        this.timeoutMs = Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : 0;

        this.transport = deps.transport || httpTransport;
    }


    defaultBaseUrl() {
        return "";
    }


    capabilities() {

        return {
            streaming: true,
            tools: true,
            vision: true,
            promptCaching: "none",
            tokenCount: "estimate",
            responseFormat: false
        };
    }


    describe() {

        return {
            provider: this.name,
            model: this.model,
            baseUrl: this.baseUrl,
            capabilities: this.capabilities()
        };
    }


    prepare(request) {

        if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {

            throw new ProviderError(
                "a provider request needs at least one message",
                { provider: this.name, code: "invalid_request", retryable: false }
            );
        }

        const temperature =
            request.temperature !== undefined && request.temperature !== null
                ? request.temperature
                : this.temperature;

        return {
            ...request,
            model: request.model || this.model,
            temperature:
                Number.isFinite(temperature) && temperature >= 0
                    ? temperature
                    : undefined,
            maxTokens: Number(request.maxTokens) > 0 ? Number(request.maxTokens) : 0
        };
    }


    requireBaseUrl() {

        if (!this.baseUrl) {

            throw new ProviderError(
                `${this.name} needs a base URL (set AGENT_BASE_URL or the baseUrl of the route)`,
                { provider: this.name, code: "missing_base_url", retryable: false }
            );
        }

        return this.baseUrl;
    }


    async complete(request, options = {}) {

        const prepared = this.prepare(request);

        const stream = prepared.stream === true;

        const http = this.buildHttp(prepared, stream);

        const response = await this.send(http, options);

        if (stream) {

            try {

                return await this.readStream(response, prepared, options.onDelta || (() => {}));

            } catch (error) {

                if (error instanceof ProviderError) {
                    throw error;
                }

                throw new ProviderError(
                    `${this.name} stream failed: ${error && error.message}`,
                    { provider: this.name, code: "stream_failed", retryable: true, cause: error }
                );
            }
        }

        const text = await response.text();

        let body;

        try {

            body = text ? JSON.parse(text) : {};

        } catch {

            throw new ProviderError(
                `${this.name} answered with a body that is not JSON`,
                { provider: this.name, status: response.status, code: "invalid_json", retryable: true }
            );
        }

        return this.parseResponse(body, prepared);
    }


    async send(http, options = {}) {

        let response;

        try {

            response = await this.transport.request({
                method: http.method || "POST",
                url: http.url,
                headers: http.headers,
                body: http.body,
                signal: options.signal,
                timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : this.timeoutMs
            });

        } catch (error) {

            if (error instanceof ProviderError) {
                throw error;
            }

            const aborted = Boolean(options.signal && options.signal.aborted);

            const timedOut = Boolean(error && error.name === "TimeoutError");

            throw new ProviderError(
                `${this.name} request failed: ${error && error.message}`,
                {
                    provider: this.name,
                    code: aborted ? "aborted" : timedOut ? "timeout" : "network",
                    retryable: !aborted,
                    cause: error
                }
            );
        }

        if (response.status < 200 || response.status >= 300) {

            const text = await response.text().catch(() => "");

            throw ProviderError.fromHttp(this.name, response.status, response.header, text);
        }

        return response;
    }


    /* Estimated by default; adapters with a count endpoint override it. */
    async countTokens(request) {

        return {
            tokens: estimateRequestTokens(request),
            method: "estimate"
        };
    }


    jsonHeaders(stream) {

        return {
            "content-type": "application/json",
            accept: stream ? "text/event-stream" : "application/json"
        };
    }
}


module.exports = {
    LLMProvider,
    trimSlash
};
