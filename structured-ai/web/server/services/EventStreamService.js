"use strict";

/*
|--------------------------------------------------------------------------
| Web console event stream (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The part of the console that turns runtime events into something a
| browser can carry: a full record of every tool call kept on the
| server, a preview of it on the wire, and the conversation entries the
| model's own output becomes.
|
| A tool result can be tens of thousands of characters and the console
| needs all of it only when an operator opens one call, so the record
| stays here — keyed by agent, graph and call id — while the stream
| carries a preview and a key. That split is the whole reason `calls`
| exists, and `forStream` is what enforces it.
|
| Model output reaches the browser even when session persistence is off:
| persistence is an optional storage feature and must never turn the live
| conversation into a single final-answer bubble. `executionMessageKey`
| is what lets the browser hang tools beside the exact AI message that
| caused them instead of gluing every tool of a turn to one accordion.
|--------------------------------------------------------------------------
*/

function createEventStreamService(ctx) {

    const { runtime, calls } = ctx;

    /*
    | A tool result can be tens of thousands of characters, and the
    | console needs all of it only when an operator opens one call. The
    | full record therefore stays here, keyed by agent, graph and call
    | id, while the stream carries a preview.
    */

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
            ctx.settings.resultChars();

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
            ctx.settings.callHistoryLimit()
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

    function installConsoleListeners() {

        /*
        | The browser must receive model output even when session persistence is
        | disabled. Persistence is an optional storage feature; it must never
        | turn the live conversation into a single final-answer bubble.
        */
        runtime.events.bus.on("agent:response", event => {

            ctx.addMessage({
                role: "assistant",
                kind: "model",
                agent: event.scope || event.agent,
                iteration: event.iteration,
                turn_id: event.turn_id,
                execution_key: ctx.executionMessageKey(event),
                finish_reason: event.finish_reason,
                truncated: event.truncated,
                content: event.content
            });
        });

        /*
        | Reasoning is part of the conversation for a reader, so it is kept
        | as its own entry rather than folded into the answer. This handles both
        | the live stream and the stored conversation through addMessage.
        */
        runtime.events.bus.on("agent:thinking", event => {

            ctx.addMessage({
                role: "assistant",
                kind: "thinking",
                agent: event.scope || event.agent,
                iteration: event.iteration,
                turn_id: event.turn_id,
                execution_key: ctx.executionMessageKey(event),
                content: event.content
            });
        });

        runtime.events.bus.on("event", ctx.broadcast);
    }

    return {
        callKey,
        preview,
        recordCall,
        forStream,
        installConsoleListeners
    };
}

module.exports = {
    createEventStreamService
};
