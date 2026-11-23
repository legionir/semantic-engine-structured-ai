"use strict";

/*
|--------------------------------------------------------------------------
| Provider Error (roadmap P1-1)
|--------------------------------------------------------------------------
|
| One error type for every provider, so the router can decide on retry
| and fallback without knowing which API answered:
|
|   provider        the adapter name ("anthropic", "gemini", ...)
|   status          HTTP status, 0 when no response arrived
|   code            provider error type or a local code (network, timeout,
|                   aborted, invalid_response, missing_credentials, ...)
|   retryable       408, 425, 429 and 5xx, network failures and timeouts
|   retryAfterMs    from retry-after-ms / retry-after when the API sent it
|
| The message never contains request headers or the API key, only the
| provider's own error text (capped).
|--------------------------------------------------------------------------
*/

function isRetryableStatus(status) {

    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        status >= 500
    );
}


class ProviderError extends Error {

    constructor(message, details = {}) {

        super(message);

        this.name = "ProviderError";

        this.provider = details.provider || null;

        this.status = Number(details.status) || 0;

        this.code =
            details.code ||
            (this.status ? `http_${this.status}` : "provider_error");

        this.retryable =
            details.retryable === undefined
                ? isRetryableStatus(this.status)
                : Boolean(details.retryable);

        this.retryAfterMs =
            Number.isFinite(details.retryAfterMs)
                ? details.retryAfterMs
                : null;

        if (details.cause) {
            this.cause = details.cause;
        }
    }


    /*
    | Builds the error for a non-2xx answer. `header` is a function
    | name -> value (or null) so it works with fetch and fixtures alike.
    */
    static fromHttp(provider, status, header, bodyText) {

        const read = typeof header === "function" ? header : () => null;

        let body = null;

        try {
            body = bodyText ? JSON.parse(bodyText) : null;
        } catch {
            body = null;
        }

        const described = describeBody(body, bodyText);

        const type =
            described.type ||
            read("x-amzn-errortype") ||
            null;

        return new ProviderError(
            `${provider} answered HTTP ${status}${type ? ` (${type})` : ""}: ${described.message || "no error message"}`,
            {
                provider,
                status,
                code: type ? String(type).split(":")[0] : `http_${status}`,
                retryAfterMs: retryAfter(read)
            }
        );
    }


    /*
    | An error object that arrived inside a 200 answer or a stream.
    */
    static fromBody(provider, body, status = 0) {

        const described = describeBody(body, "");

        const type = described.type || "stream_error";

        const mapped =
            status ||
            statusOfType(type);

        return new ProviderError(
            `${provider} reported an error (${type}): ${described.message || "no error message"}`,
            {
                provider,
                status: mapped,
                code: type,
                retryable: mapped ? isRetryableStatus(mapped) : false
            }
        );
    }
}


function describeBody(body, text) {

    if (body && typeof body === "object") {

        const error =
            body.error !== undefined
                ? body.error
                : body;

        if (typeof error === "string") {
            return { message: cap(error), type: null };
        }

        if (error && typeof error === "object") {

            return {
                message: cap(
                    error.message ||
                    error.Message ||
                    body.message ||
                    body.Message ||
                    ""
                ),
                type:
                    (error.type && error.type !== "error" ? error.type : null) ||
                    error.status ||
                    error.code ||
                    body.__type ||
                    null
            };
        }
    }

    return { message: cap(String(text || "")), type: null };
}


function statusOfType(type) {

    const name = String(type || "").toLowerCase();

    if (/rate_limit|throttl|resource_exhausted|too_many/.test(name)) {
        return 429;
    }

    if (/overloaded/.test(name)) {
        return 529;
    }

    if (/unavailable|server_error|internal|api_error|timeout|modelstreamerror/.test(name)) {
        return 503;
    }

    if (/invalid|validation|not_found|permission|authentication|unauthenticated/.test(name)) {
        return 400;
    }

    return 0;
}


function retryAfter(read) {

    const milliseconds = Number(read("retry-after-ms"));

    if (Number.isFinite(milliseconds) && milliseconds >= 0 && read("retry-after-ms") !== null) {
        return milliseconds;
    }

    const value = read("retry-after");

    if (value === null || value === undefined || value === "") {
        return null;
    }

    const seconds = Number(value);

    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }

    const date = Date.parse(value);

    return Number.isFinite(date)
        ? Math.max(0, date - Date.now())
        : null;
}


function cap(text) {

    const value = String(text || "");

    return value.length > 500
        ? `${value.slice(0, 500)}...`
        : value;
}


function asProviderError(error, provider) {

    if (error instanceof ProviderError) {
        return error;
    }

    return new ProviderError(
        `${provider} failed: ${error && error.message ? error.message : String(error)}`,
        {
            provider,
            code: "provider_failure",
            retryable: false,
            cause: error
        }
    );
}


module.exports = {
    ProviderError,
    isRetryableStatus,
    asProviderError
};
