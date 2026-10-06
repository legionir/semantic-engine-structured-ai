"use strict";


/*
|--------------------------------------------------------------------------
| Safe identifiers (EXECUTION_PLAN Phase 18)
|--------------------------------------------------------------------------
|
| An id becomes a file name, so it may never contain a path. The
| replacement alphabet is the historical session/journal one:
| letters, digits, underscore, dot and dash.
|--------------------------------------------------------------------------
*/


function safeId(id) {

    return String(id).replace(/[^A-Za-z0-9_.-]/g, "_");
}


function safeName(value) {

    const safe =
        String(value || "unknown_agent")
            .replace(/[^A-Za-z0-9_.-]/g, "_");

    return safe || "unknown_agent";
}


module.exports = {
    safeId,
    safeName
};
