/*
| Requests of the operator tools (Logs, Terminal, Files). Every call
| resolves — never throws — to { ok, status, payload, error }, so a view
| can always show what went wrong instead of failing silently.
*/

export async function apiRequest(url, options = {}) {

    const init = { credentials: "same-origin", ...options };

    if (options.json !== undefined) {
        init.method = options.method || "POST";
        init.headers = { "content-type": "application/json", ...(options.headers || {}) };
        init.body = JSON.stringify(options.json);
        delete init.json;
    }

    let response;

    try {
        response = await fetch(url, init);
    } catch (error) {
        return { ok: false, status: 0, payload: null, error: error.message || "network error" };
    }

    const payload = await response.json().catch(() => null);

    return response.ok
        ? { ok: true, status: response.status, payload, error: null }
        : {
            ok: false,
            status: response.status,
            payload,
            error: (payload && payload.error) || `request failed (${response.status})`
        };
}


export function query(params) {

    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }

    const text = search.toString();

    return text ? `?${text}` : "";
}


export function formatBytes(bytes) {

    if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return "";

    const value = Number(bytes);

    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;

    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}


export function formatStamp(at) {

    const date = new Date(at);

    if (Number.isNaN(date.getTime())) return String(at ?? "");

    const pad = value => String(value).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
