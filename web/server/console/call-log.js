"use strict";

/*
|--------------------------------------------------------------------------
| Call log
|--------------------------------------------------------------------------
|
| Every tool call of the current conversation, keyed by call id, with a
| bounded preview for the stream and the full record for the session file.
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/


module.exports = function createCallLog(shared) {

    const {
        runtime
    } = shared;

    /*
    | A tool result can be tens of thousands of characters, and the
    | console needs all of it only when an operator opens one call. The
    | full record therefore stays here, keyed by agent, graph and call
    | id, while the stream carries a preview.
    */

    const calls = new Map();


    function callKey(event) {

        return [
            event.agent || "main_agent",
            event.graph_id || "graph",
            event.id
        ].join("|");
    }


    function preview(value) {

        if (value === undefined || value === null) {
            return { text: null, chars: 0, truncated: false };
        }

        const text =
            typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2) ?? "";

        const limit =
            runtime.settings.get("CONSOLE_RESULT_CHARS");

        return {
            text:
                text.length > limit
                    ? `${text.slice(0, limit)}…`
                    : text,

            chars:
                text.length,

            truncated:
                text.length > limit
        };
    }


    function recordCall(event) {

        const key = callKey(event);

        const existing =
            calls.get(key) || {
                key,
                agent: event.agent || "main_agent",
                id: event.id,
                graph_id: event.graph_id || null,
                shape: event.shape || null,
                wave: event.wave ?? null,
                depends_on: event.depends_on || [],
                iteration: event.iteration ?? null
            };

        if (event.type === "tool:start") {

            existing.name = event.name;
            existing.arguments = event.arguments;
            existing.started_at = event.at || Date.now();
            existing.status = "running";

        } else {

            existing.name = event.name || existing.name;

            if (event.arguments !== undefined) {
                existing.arguments = event.arguments;
            }

            existing.wave = event.wave ?? existing.wave;
            existing.iteration = event.iteration ?? existing.iteration;

            /* the executor knows when it actually started; the envelope only
               says when the event was written, which is later for a call that
               waited in the queue. `wave` stays the planned grouping. */
            existing.started_at =
                event.started_at ?? existing.started_at;

            existing.finished_at = event.at || Date.now();
            existing.duration_ms = event.duration_ms;
            existing.success = event.success;
            existing.result = event.result ?? null;
            existing.error = event.error ?? null;

            existing.status =
                event.success
                    ? "done"
                    : "failed";
        }

        calls.set(key, existing);

        while (
            calls.size >
            runtime.settings.get("CONSOLE_CALL_HISTORY")
        ) {

            calls.delete(calls.keys().next().value);
        }

        return key;
    }


    /*
    | What reaches the browser is the same event with the heavy fields
    | replaced by a preview and a key to fetch the rest.
    */

    function forStream(event) {

        if (
            event.type !== "tool:start" &&
            event.type !== "tool:end"
        ) {
            return event;
        }

        const key = recordCall(event);

        const streamed = {
            ...event,
            call_key: key
        };

        if (streamed.arguments !== undefined) {

            const shown = preview(streamed.arguments);

            streamed.arguments_preview = shown.text;
            streamed.arguments_chars = shown.chars;
            streamed.arguments_truncated = shown.truncated;

            delete streamed.arguments;
        }

        if (streamed.result !== undefined) {

            const shown = preview(streamed.result);

            streamed.result_preview = shown.text;
            streamed.result_chars = shown.chars;
            streamed.result_truncated = shown.truncated;

            delete streamed.result;
        }

        return streamed;
    }

    return {
        calls,
        forStream
    };
};
