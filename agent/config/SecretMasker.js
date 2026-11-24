"use strict";

/*
|--------------------------------------------------------------------------
| Secret Masker — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Secrets never travel in full through the console, logs or a snapshot.
| The runtime itself still reads the real value via SettingsStore.get().
|--------------------------------------------------------------------------
*/

function maskSecret(value) {

    const text =
        value === null || value === undefined
            ? ""
            : String(value);

    if (text.length <= 4) {
        return text === "" ? "" : "****";
    }

    return `${text.slice(0, 2)}…${text.slice(-2)}`;

}


module.exports = {
    maskSecret
};
