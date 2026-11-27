"use strict";

/*
|--------------------------------------------------------------------------
| Retry Controller (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Transient endpoint retries (status/backoff) and the malformed-answer
| budget the iteration loop uses to hand a bad response back to the model.
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");
const { logs } = require("./LogStore");


function isRetryableStatus(status) {

    return (
        status === 408 ||
        status === 409 ||
        status === 425 ||
        status === 429 ||
        status >= 500
    );
}


function retryDelayMs(attempt, retryAfterHeader) {

    if (retryAfterHeader) {

        const seconds =
            Number(retryAfterHeader);

        if (Number.isFinite(seconds)) {

            return Math.min(
                seconds * 1000,
                30000
            );
        }
    }

    const backoff =
        host().settings.get("RETRY_BASE_MS") * Math.pow(2, attempt - 1);

    return Math.min(
        backoff + Math.floor(Math.random() * host().settings.get("RETRY_BASE_MS")),
        30000
    );
}


function noteMalformed(progress, error) {

    if (progress.malformedCode !== error.code) {
        progress.malformed = 0;
        progress.malformedCode = error.code;
    }

    progress.malformed = (progress.malformed || 0) + 1;

    const limit =
        host().settings.get("MAX_MALFORMED_RESPONSES");

    const maximumAttempts =
        limit + 1;

    return {
        attempt: progress.malformed,
        limit,
        maximumAttempts,
        retriesLeft: Math.max(0, maximumAttempts - progress.malformed),
        stopped: progress.malformed > limit
    };
}


function clearMalformed(progress) {

    progress.malformed = 0;
    progress.malformedCode = null;
}


async function callAI(options) {

    const h = host();

    let lastError;

    for (
        let attempt = 1;
        attempt <= h.settings.get("MAX_REQUEST_RETRIES") + 1;
        attempt++
    ) {

        try {

            return await h.sendAgentRequest(options);

        } catch (error) {

            lastError = error;

            const retryable =
                error.retryable === true;

            if (
                !retryable ||
                attempt > h.settings.get("MAX_REQUEST_RETRIES")
            ) {
                if (retryable && attempt > 1) {
                    logs.error("ai", `AI request gave up after ${attempt} attempts: ${String(error.message).slice(0, 300)}`, {
                        scope: options.scope || "main_agent",
                        attempts: attempt,
                        status: error.status
                    });
                }
                throw error;
            }

            const delay =
                retryDelayMs(
                    attempt,
                    error.retryAfter
                );

            if (h.runRemainingMs() <= delay) {

                logs.error("ai", `AI request failed and the run budget leaves no time to retry: ${String(error.message).slice(0, 300)}`, {
                    scope: options.scope || "main_agent",
                    attempt,
                    status: error.status
                });

                throw new Error(
                    `${error.message} (no time left in the run budget to retry)`
                );
            }

            h.logLine(
                options.scope,
                `Request failed (${
                    error.message.slice(0, 120)
                }); retrying in ${delay} ms [attempt ${
                    attempt
                }/${h.settings.get("MAX_REQUEST_RETRIES")}]`
            );

            logs.warn("ai", `Retrying AI request in ${delay} ms (attempt ${attempt}/${h.settings.get("MAX_REQUEST_RETRIES")}): ${String(error.message).slice(0, 200)}`, {
                scope: options.scope || "main_agent",
                attempt,
                delay_ms: delay,
                status: error.status
            });

            await new Promise(
                resolve =>
                    setTimeout(resolve, delay)
            );
        }
    }

    throw lastError;
}


module.exports = {
    isRetryableStatus,
    retryDelayMs,
    noteMalformed,
    clearMalformed,
    callAI
};
