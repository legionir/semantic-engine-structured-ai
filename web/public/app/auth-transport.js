/*
|--------------------------------------------------------------------------
| In-memory authentication transport
|--------------------------------------------------------------------------
|
| Normally the console relies on its HttpOnly cookie. When embedded inside
| a cross-origin frame where cookies are blocked, auth-gate.js stores the
| verified token in memory only (never localStorage or sessionStorage) and
| this module attaches it to same-origin /api/* fetches and EventSource URLs.
|
| Some browser/sandbox environments expose window.fetch or window.EventSource
| via non-writable getters, so global patching is best-effort and never
| throws; app modules call apiFetch / createEventSource directly as well.
*/

const TOKEN_PROP = "__structuredAiConsoleToken";
const SESSION_PROP = "__structuredAiConsoleSession";
const WRAPPED_PROP = "__structuredAiAuthWrapped";


export function getConsoleToken() {

    if (typeof window === "undefined") {
        return null;
    }

    const value = window[TOKEN_PROP];

    return typeof value === "string" && value ? value : null;
}


export function getConsoleSession() {

    if (typeof window === "undefined") {
        return null;
    }

    const value = window[SESSION_PROP];

    return typeof value === "string" && value ? value : null;
}


export function authenticatedUrl(url) {

    if (typeof url !== "string" || !url.startsWith("/api/")) {
        return url;
    }

    const token = getConsoleToken();

    if (token) {
        if (/[?&]token=/.test(url)) {
            return url;
        }
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}token=${encodeURIComponent(token)}`;
    }

    const session = getConsoleSession();

    if (session) {
        if (/[?&]session=/.test(url)) {
            return url;
        }
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}session=${encodeURIComponent(session)}`;
    }

    return url;
}


function withConsoleAuth(baseFetch, input, options) {

    const targetUrl = typeof input === "string" ? input : (input && input.url) || "";
    const activeToken = getConsoleToken();
    const activeSession = activeToken ? null : getConsoleSession();

    if ((!activeToken && !activeSession) || (!targetUrl.startsWith("/api/") && !targetUrl.startsWith("/auth/"))) {
        return options !== undefined
            ? baseFetch.call(globalThis, input, options)
            : baseFetch.call(globalThis, input);
    }

    const nextOptions = { credentials: "same-origin", ...(options || {}) };
    const headers = new Headers(nextOptions.headers || (typeof input !== "string" && input?.headers) || {});

    if (activeToken && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${activeToken}`);
    } else if (activeSession && !headers.has("x-console-session")) {
        headers.set("x-console-session", activeSession);
    }

    nextOptions.headers = headers;

    return baseFetch.call(globalThis, input, nextOptions);
}


export function apiFetch(input, options) {

    const currentFetch = globalThis.fetch;

    if (typeof currentFetch !== "function") {
        throw new TypeError("fetch is unavailable");
    }

    if (currentFetch[WRAPPED_PROP] || (!getConsoleToken() && !getConsoleSession())) {
        return options !== undefined
            ? currentFetch.call(globalThis, input, options)
            : currentFetch.call(globalThis, input);
    }

    return withConsoleAuth(currentFetch, input, options);
}


export function createEventSource(url, init) {

    const CurrentEventSource = globalThis.EventSource;

    if (typeof CurrentEventSource !== "function") {
        throw new TypeError("EventSource is unavailable");
    }

    if (CurrentEventSource[WRAPPED_PROP]) {
        return new CurrentEventSource(url, init);
    }

    return init !== undefined
        ? new CurrentEventSource(authenticatedUrl(String(url)), init)
        : new CurrentEventSource(authenticatedUrl(String(url)));
}


function patchGlobalProperty(name, value) {

    try {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
        if (!descriptor || descriptor.writable || typeof descriptor.set === "function") {
            globalThis[name] = value;
            return true;
        }
        if (descriptor.configurable) {
            Object.defineProperty(globalThis, name, {
                value,
                writable: true,
                configurable: true,
                enumerable: descriptor.enumerable !== false
            });
            return true;
        }
    } catch {
        /* Host exposes a read-only/non-configurable global property; apiFetch/createEventSource handle auth directly. */
    }

    return false;
}


export function installConsoleAuthTransport() {

    const token = getConsoleToken();
    const session = getConsoleSession();

    if ((!token && !session) || typeof globalThis === "undefined") {
        return false;
    }

    if (typeof globalThis.fetch === "function" && !globalThis.fetch[WRAPPED_PROP]) {

        const baseFetch = globalThis.fetch;

        const wrappedFetch = function authenticatedFetch(input, options = {}) {
            return withConsoleAuth(baseFetch, input, options);
        };

        wrappedFetch[WRAPPED_PROP] = true;
        patchGlobalProperty("fetch", wrappedFetch);
    }

    if (typeof globalThis.EventSource === "function" && !globalThis.EventSource[WRAPPED_PROP]) {

        const BaseEventSource = globalThis.EventSource;

        class AuthenticatedEventSource extends BaseEventSource {
            constructor(url, init) {
                super(authenticatedUrl(String(url)), init);
            }
        }

        AuthenticatedEventSource[WRAPPED_PROP] = true;
        patchGlobalProperty("EventSource", AuthenticatedEventSource);
    }

    return true;
}


installConsoleAuthTransport();
