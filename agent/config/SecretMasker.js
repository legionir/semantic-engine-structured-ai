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


/*
| A proxy URL is shown in full except its password: `http://user:****@host:port`.
| Saving it back with the mask in place keeps the stored password
| (restoreUrlPassword), so the rest of the URL can be edited in a plain field.
*/

const URL_PASSWORD_MASK = "****";


function maskUrlPassword(value) {

    const text = value === null || value === undefined ? "" : String(value);

    let parsed;

    try {
        parsed = new URL(text);
    } catch {
        return text;
    }

    if (!parsed.password) return text;

    const at = text.lastIndexOf("@");
    const scheme = text.indexOf("//");
    const colon = text.indexOf(":", scheme + 2);

    if (scheme === -1 || at === -1 || colon === -1 || colon > at) return text;

    return `${text.slice(0, colon + 1)}${URL_PASSWORD_MASK}${text.slice(at)}`;
}


function restoreUrlPassword(next, previous) {

    const text = String(next ?? "");
    const masked = maskUrlPassword(previous);

    if (!text.includes(`:${URL_PASSWORD_MASK}@`) || masked === String(previous ?? "")) return text;

    let incoming;
    let stored;

    try {
        incoming = new URL(text);
        stored = new URL(String(previous));
    } catch {
        return text;
    }

    if (incoming.password !== URL_PASSWORD_MASK) return text;

    const at = text.lastIndexOf("@");
    const colon = text.indexOf(":", text.indexOf("//") + 2);

    return `${text.slice(0, colon + 1)}${stored.password}${text.slice(at)}`;
}


module.exports = {
    maskSecret,
    maskUrlPassword,
    restoreUrlPassword,
    URL_PASSWORD_MASK
};
