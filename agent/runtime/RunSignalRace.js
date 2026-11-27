"use strict";

/*
|--------------------------------------------------------------------------
| Run Signal Race
|--------------------------------------------------------------------------
|
| Stop must end a run even when the work it is waiting on ignores the
| run's AbortSignal (an MCP call, a slow search, a third-party tool).
| Once the signal fires, the work gets `waitMs` to settle on its own — a
| tool that honours the signal (terminal_exec kills its process group)
| reports what it was doing — and after that the caller stops waiting and
| fails with `stopError()`. The abandoned promise is left to settle
| quietly; its rejection is never unhandled.
|--------------------------------------------------------------------------
*/

function raceRunSignal(promise, signal, { waitMs = 0, stopError } = {}) {

    if (!signal || typeof signal.addEventListener !== "function") {
        return promise;
    }

    const work = Promise.resolve(promise);

    let onAbort = null;
    let waitTimer = null;

    const stopped = new Promise((resolve, reject) => {

        onAbort = () => {

            waitTimer = setTimeout(() => {

                const error = typeof stopError === "function" ? stopError() : null;

                reject(error instanceof Error ? error : new Error("Run cancelled"));

            }, Math.max(0, Number(waitMs) || 0));
        };

        if (signal.aborted) {
            onAbort();
        } else {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    });

    /* neither losing side may surface as an unhandled rejection */
    stopped.catch(() => {});
    work.catch(() => {});

    return Promise.race([work, stopped]).finally(() => {

        clearTimeout(waitTimer);
        signal.removeEventListener("abort", onAbort);
    });
}


module.exports = {
    raceRunSignal
};
