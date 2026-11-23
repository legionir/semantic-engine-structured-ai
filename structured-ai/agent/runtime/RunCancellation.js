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
|
| P0-7: a cancel that arrives before startRun attached a controller (the
| run is admitted but not started yet) is remembered, and the controller
| attached next is aborted on the spot, so the cancel is never lost.
|--------------------------------------------------------------------------
*/

class RunCancellation {

    constructor() {

        this.attached = null;

        this.reason = null;

        /* a cancel requested while no controller was attached */
        this.requested = false;

    }


    get controller() {

        return this.attached;

    }


    set controller(value) {

        this.attached = value || null;

        if (
            this.requested &&
            this.attached
        ) {

            this.requested = false;

            if (!this.attached.signal.aborted) {
                this.attached.abort();
            }
        }

    }


    /* A run starts uncancellable until startRun attaches a controller. */
    get signal() {

        return (
            this.attached
                ? this.attached.signal
                : null
        );

    }


    get isCancelled() {

        return Boolean(
            this.requested ||
            (
                this.attached &&
                this.attached.signal.aborted
            )
        );

    }


    /* Idempotent: an already-stopped run keeps its first reason. */
    abort() {

        if (!this.attached) {

            if (this.requested) {
                return false;
            }

            this.requested = true;

            return true;
        }

        if (this.attached.signal.aborted) {
            return false;
        }

        this.attached.abort();

        return true;

    }

}


module.exports = RunCancellation;
