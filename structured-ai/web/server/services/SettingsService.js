"use strict";

/*
|--------------------------------------------------------------------------
| Web console settings (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The console reads six knobs of the runtime settings and writes through
| one route. Before this move each reader called
| `runtime.settings.get("SOME_KEY")` for itself and the MCP management
| gate was written three times, so a seventh reader — or a renamed key —
| was a thing nothing would have caught.
|
| The names here are the *meaning*, not the key: `autoContinue()` is the
| console's --until-done switch, `maxConsoleEvents()` is the replay cap,
| `resultChars()` is the preview ceiling the event stream is cut to, and
| `allowMcpRuntimeAdd()` is the gate every MCP mutation asks before it
| even looks at a payload.
|
| `apply(body)` moved verbatim out of POST /api/settings, including the
| order the pieces happen in — write, then describe, then emit — because
| the settings:changed payload is read by the browser that made the
| change. The route keeps the response and the error answer; a rejected
| key still reaches its 400 the same way.
|--------------------------------------------------------------------------
*/

function createSettingsService(ctx) {
    const { runtime } = ctx;

/* one reader for a knob four places in the console asked for */

    function sessionsEnabled() {

        return runtime.settings.get("SESSIONS_ENABLED") === true;
    }

    function all() {

        return runtime.settings.all();
    }

    function resultChars() {

        return runtime.settings.get("CONSOLE_RESULT_CHARS");
    }

    function callHistoryLimit() {

        return runtime.settings.get("CONSOLE_CALL_HISTORY");
    }

    function maxConsoleEvents() {

        return runtime.settings.get("MAX_CONSOLE_EVENTS");
    }

    function autoContinue() {

        return runtime.settings.get("AUTO_CONTINUE") === true;
    }

    function maxAutoCycles() {

        return runtime.settings.get("MAX_AUTO_CYCLES");
    }

    function allowMcpRuntimeAdd() {

        return runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") !== false;
    }

    function apply(body) {
        const value =
            body.reset === true
                ? runtime.settings.reset(body.key)
                : runtime.settings.set(body.key, body.value);

        const definition =
            runtime.settings.describe(
                runtime.settings.definitionOf(body.key)
            );

        runtime.events.emit("settings:changed", {
            key: body.key,
            value: definition.value,
            source: definition.source
        });

        void value;

        return definition;
    }

    return {
        sessionsEnabled,
        all,
        resultChars,
        callHistoryLimit,
        maxConsoleEvents,
        autoContinue,
        maxAutoCycles,
        allowMcpRuntimeAdd,
        apply
    };
}

module.exports = {
    createSettingsService
};
