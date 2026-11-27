"use strict";

/*
|--------------------------------------------------------------------------
| Turn checkpoints (roadmap P1-06)
|--------------------------------------------------------------------------
|
| A turn used to be saved only when it ended, so a server killed in the
| middle of one lost the turn, and the session still said "idle" or the
| previous turn's status. Now the conversation is saved as soon as the
| turn starts (status "running", the user's message) and then at most
| every SESSION_CHECKPOINT_MS while it runs, whenever something changed:
| the history the run is extending in place carries the agent's tool calls
| and their results, which is the context a continued turn needs.
|
| A session still marked "running" when the console starts was therefore
| cut off by a restart (interrupted-runs.js).
*/

module.exports = function startCheckpoint(runtime, save, signature) {

    let last = null;

    const tick = () => {

        let now;

        try {
            now = signature();
        } catch {
            now = Date.now();
        }

        if (now === last) {
            return;
        }

        last = now;

        try {
            save();
        } catch {
            /* a checkpoint that cannot be written is not fatal */
        }
    };

    tick();

    const interval = runtime.settings.get("SESSION_CHECKPOINT_MS");

    if (!(interval > 0)) {
        return () => {};
    }

    const timer = setInterval(tick, interval);

    if (typeof timer.unref === "function") {
        timer.unref();
    }

    return () => clearInterval(timer);
};
