"use strict";

/*
|--------------------------------------------------------------------------
| Web console conversation (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The conversation is a file, not a browser tab: the messages, the events
| exactly as they were streamed, and the record of every call are written to
| the session store so the same three cards can be redrawn later.
|
| `sessionsEnabled` lives in the settings service now — it is one setting
| with four readers, and the readers should not each re-read the key.
|
| `activateSession` keeps its event backfill from the store: a session's own
| event list is capped, so a reopened conversation replays the complete run
| rather than the tail. That is the reason it reaches for `runtime.eventstore`
| instead of trusting the file.
|--------------------------------------------------------------------------
*/

function createSessionService(ctx) {

    const { runtime, state, calls, sessions } = ctx;

    /*
    | The conversation is a file, not a browser tab. Everything the
    | console draws, the messages, the events exactly as they were
    | streamed, and the full record of every call, is written to
    | .agent/sessions so the same three cards can be redrawn later.
    */

    function saveSession() {

        if (!ctx.settings.sessionsEnabled()) {
            return state.session;
        }

        state.session.status = state.status;

        state.session.history = state.history;

        state.session.calls = [...calls.values()];

        try {

            return sessions.saveSession(state.session);

        } catch {

            /* a workspace that cannot be written is not fatal */
            return state.session;
        }
    }

    function addMessage(entry) {

        const message = {
            at: Date.now(),
            ...entry
        };

        state.session.messages.push(message);

        runtime.events.emit("session:message", {
            session: state.session.id,
            message
        });

        saveSession();

        return message;
    }

    /*
    | One model response can have a reasoning entry, a raw provider response,
    | and a group of tool events. They all use the same key so the browser
    | can render the tools beside the exact AI message that caused them,
    | rather than attaching every tool from a turn to one large accordion.
    */
    function executionMessageKey(event) {

        if (event.message_id || event.ai_message_id) {
            return event.message_id || event.ai_message_id;
        }

        return [
            event.turn_id || event.run_id || "run",
            event.scope || event.agent || "main_agent",
            event.iteration ?? "unknown"
        ].join("|");
    }

    function activateSession(id) {

        const loaded =
            sessions.loadSession(id);

        if (!loaded) {
            return null;
        }

        state.session = loaded;

        state.history =
            Array.isArray(loaded.history)
                ? loaded.history
                : [];

        state.events = [...loaded.events];

        /* A session's events are capped, so the event store is the source
           of truth: backfill anything the session dropped so a reopened
           conversation replays the complete run, not just the tail. */
        if (
            runtime.eventstore &&
            typeof runtime.eventstore.query === "function"
        ) {

            const run_ids =
                new Set(
                    loaded.events
                        .filter(event => event.run_id)
                        .map(event => event.run_id)
                );

            const stored =
                runtime.eventstore.query();

            const have =
                new Set(
                    state.events.map(event => `${event.run_id || ""}|${event.seq}`)
                );

            for (const event of stored) {

                if (
                    run_ids.size === 0 ||
                    (event.run_id && run_ids.has(event.run_id))
                ) {

                    const key = `${event.run_id || ""}|${event.seq}`;

                    if (!have.has(key)) {

                        state.events.push(event);
                        have.add(key);
                    }
                }
            }

            state.events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        }

        state.answer = null;
        state.error = null;
        state.status = "idle";
        state.cycles = 0;
        state.lastPlanSignature = null;

        calls.clear();

        for (const call of loaded.calls) {
            calls.set(call.key, call);
        }

        runtime.events.emit("session:switched", {
            session: sessions.summarise(loaded)
        });

        return loaded;
    }

    return {
        saveSession,
        addMessage,
        executionMessageKey,
        activateSession
    };
}

module.exports = {
    createSessionService
};
