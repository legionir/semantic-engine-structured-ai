"use strict";

/*
|--------------------------------------------------------------------------
| WEB_SERVER_MODE (EXECUTION_PLAN Phase 23 گام ۲, decision 42)
|--------------------------------------------------------------------------
| Rule 8 of the plan puts `WEB_SERVER_MODE=legacy|modular` on the single
| list of flags this migration runs behind, and phase 30 removes them.
|
| Both values compose the same modules. This split is a move, not a rewrite,
| and a second implementation to compare against is the one thing that could
| let the two halves diverge — the failure the flag exists to prevent. So
| the flag has one reader and one behaviour, and what is *tested* is the
| equality: test/web/layer.test.js boots the console under both values and
| answers the same routes under each.
|
| A misspelled value is legacy, like every other *_MODE in the schema: a typo
| must not silently change how a control plane routes its own requests.
|--------------------------------------------------------------------------
*/

function webServerMode(runtime) {

    const settings =
        runtime &&
        runtime.settings &&
        typeof runtime.settings.get === "function"
            ? runtime.settings
            : null;

    return settings && settings.get("WEB_SERVER_MODE") === "modular"
        ? "modular"
        : "legacy";
}

module.exports = {
    webServerMode
};
