/*
|--------------------------------------------------------------------------
| Run Cancellation
|--------------------------------------------------------------------------
|
| One run's cancellation state: the AbortController whose signal every
| in-flight request and tool of that run observes, and the reason the
| run was stopped.
|
| This is the same lifecycle the legacy global RUN object carries on its
| controller/cancelled_reason fields; isolating it per run is what makes
| "cancel run A without touching run B" possible. The hook executor swaps
| the controller while a hook runs and restores it afterwards, exactly as
| the legacy RUN fields do, so both swaps are plain property writes here.
|--------------------------------------------------------------------------
*/

class RunCancellation {

    constructor() {

        this.controller = null;

        this.reason = null;

    }


    /* A run starts uncancellable until startRun attaches a controller. */
    get signal() {

        return (
            this.controller
                ? this.controller.signal
                : null
        );

    }


    get isCancelled() {

        return Boolean(
            this.controller &&
            this.controller.signal.aborted
        );

    }


    /* Idempotent: an already-stopped run keeps its first reason. */
    abort() {

        if (
            !this.controller ||
            this.controller.signal.aborted
        ) {
            return false;
        }

        this.controller.abort();

        return true;

    }

}


module.exports = RunCancellation;
