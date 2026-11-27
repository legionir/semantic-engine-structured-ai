/*
|--------------------------------------------------------------------------
| Sign out
|--------------------------------------------------------------------------
|
| The Sign out button in the header menu (and the palette). After a
| confirmation it asks the server to revoke this browser's session and
| expire the console cookies (POST /auth/logout), forgets any credential
| auth-gate.js kept in memory, and reloads the page without its query, so
| the sign-in screen appears and a ?token= in the address cannot sign the
| browser straight back in. Tasks already running keep running on the
| server; signing out only ends this browser's access.
*/

import { apiFetch } from "./auth-transport.js";
import { notifyError } from "./console-core.js";
import { confirmDialog } from "./operator-api.js";


let signingOut = false;


function forgetMemoryCredentials() {
    try {
        delete window.__structuredAiConsoleToken;
        delete window.__structuredAiConsoleSession;
    } catch {
        window.__structuredAiConsoleToken = undefined;
        window.__structuredAiConsoleSession = undefined;
    }
}


/* globalThis.location is window.location in a browser; the reload is a
   parameter so a caller can observe it without leaving the page */
export async function signOut({ confirm = true, reload = target => globalThis.location.replace(target) } = {}) {

    if (signingOut) return false;

    if (confirm && !(await confirmDialog(
        "Sign out of the console on this browser? Tasks that are already running keep running on the server.",
        { title: "Sign out", confirmLabel: "Sign out", confirmClass: "danger" }
    ))) {
        return false;
    }

    signingOut = true;

    try {
        const response = await apiFetch("/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(`request failed (${response.status})`);
    } catch (error) {
        signingOut = false;
        notifyError(`Sign out failed: ${error.message || "network error"}. You are still signed in.`);
        return false;
    }

    forgetMemoryCredentials();
    reload(globalThis.location?.pathname || "/");

    return true;
}


export function initLogout(button = document.getElementById("logoutButton")) {
    button?.addEventListener("click", () => {
        signOut();
    });
}
