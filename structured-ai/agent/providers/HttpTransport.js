"use strict";

/*
|--------------------------------------------------------------------------
| HTTP Transport (roadmap P1-1)
|--------------------------------------------------------------------------
|
| The only place the provider layer touches the network. A transport is
| an object with one method:
|
|   request({ method, url, headers, body, signal, timeoutMs })
|     -> { status, header(name), text(), body }
|
| `body` on the answer is an async iterable of byte chunks (used for
| streaming), text() reads the whole answer. Contract tests replace this
| object with a recorded-fixture transport, so no adapter calls fetch
| itself.
|--------------------------------------------------------------------------
*/

function timeoutError(timeoutMs) {

    const error = new Error(`the request timed out after ${timeoutMs} ms`);

    error.name = "TimeoutError";

    return error;
}


const httpTransport = {

    async request({ method = "POST", url, headers = {}, body, signal, timeoutMs = 0 }) {

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
    httpTransport
};
