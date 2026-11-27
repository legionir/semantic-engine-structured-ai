/*
| Requests of the operator tools (Logs, Terminal, Files). Every call
| resolves — never throws — to { ok, status, payload, error }, so a view
| can always show what went wrong instead of failing silently.
*/

import { apiFetch } from "./auth-transport.js";

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
        response = await apiFetch(url, init);
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


export function confirmDialog(message, { title = "Confirm", confirmLabel = "Confirm", cancelLabel = "Cancel", confirmClass = "" } = {}) {

    if (typeof Modal === "undefined" || typeof document === "undefined") {
        return Promise.resolve(true);
    }

    return new Promise(resolve => {

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const body = document.createElement("p");
        body.textContent = String(message || "");

        const handle = Modal.open({
            title,
            size: "small",
            className: "confirm-modal",
            body,
            footer: Modal.row(
                Modal.button(cancelLabel, "ghost", () => {
                    finish(false);
                    handle.close("cancel");
                }),
                Modal.button(confirmLabel, confirmClass, () => {
                    finish(true);
                    handle.close("confirm");
                })
            ),
            onClose: () => finish(false)
        });
    });
}


export function promptDialog(message, initial = "", { title = "Input", confirmLabel = "OK", cancelLabel = "Cancel" } = {}) {

    if (typeof Modal === "undefined" || typeof document === "undefined") {
        return Promise.resolve(null);
    }

    return new Promise(resolve => {

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const form = document.createElement("form");
        form.className = "modal-prompt-form";

        const label = document.createElement("label");
        label.className = "modal-prompt-label";
        label.textContent = String(message || "");

        const input = document.createElement("input");
        input.type = "text";
        input.className = "modal-prompt-input";
        input.value = String(initial ?? "");

        form.append(label, input);

        const submit = () => {
            const value = input.value;
            finish(value);
            handle.close("submit");
        };

        form.addEventListener("submit", event => {
            event.preventDefault();
            submit();
        });

        const handle = Modal.open({
            title,
            size: "small",
            className: "prompt-modal",
            body: form,
            footer: Modal.row(
                Modal.button(cancelLabel, "ghost", () => {
                    finish(null);
                    handle.close("cancel");
                }),
                Modal.button(confirmLabel, "", submit)
            ),
            onClose: () => finish(null)
        });

        input.focus();
    });
}


export function noticeDialog(message, { title = "Notice", closeLabel = "Close" } = {}) {

    if (typeof Modal === "undefined" || typeof document === "undefined") {
        return Promise.resolve();
    }

    return new Promise(resolve => {

        const body = document.createElement("p");
        body.textContent = String(message || "");

        const handle = Modal.open({
            title,
            size: "small",
            className: "notice-modal",
            body,
            footer: Modal.row(
                Modal.button(closeLabel, "", () => handle.close("ok"))
            ),
            onClose: () => resolve()
        });
    });
}

