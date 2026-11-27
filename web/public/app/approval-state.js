/*
|--------------------------------------------------------------------------
| Approvals
|--------------------------------------------------------------------------
|
| Pending approvals arrive as approval:request and leave as
| approval:resolved (reduced in runtime-state.js). This module owns the one
| modal that shows them, with a counter and "approve all".
|
| - The modal opens by itself when a request arrives. If the operator
|   closes it, it stays closed until a request it has not seen arrives;
|   the header button reopens it at any time.
| - An answer is optimistic: the request leaves the queue at once. If the
|   answer cannot be delivered (network failure, 401/403, 5xx), the request
|   comes back and the modal says why, so a decision is never silently
|   lost. A 404 means it is no longer pending, which is final.
|--------------------------------------------------------------------------
*/

import { html, mount, effect } from "./dom.js";
import { watch } from "./store.js";
import { shorten } from "./formatters.js";
import { apiFetch } from "./auth-transport.js";


export function pendingApprovals(state) {
    return [...state.approvals.values()];
}


export function pendingCount(state) {
    return state.approvals.size;
}


function Definition({ label, value }) {

    if (value === undefined || value === null || value === "") {
        return null;
    }

    return html`<dt>${label}</dt><dd>${String(value)}</dd>`;
}


function ApprovalBody({ state, error }) {

    const pending = pendingApprovals(state);
    const current = pending[0];

    if (!current) {
        return null;
    }

    return html`
        <dl class="detail-grid">
            <${Definition} label="tool" value=${current.tool} />
            <${Definition} label="agent" value=${current.agent} />
            <${Definition} label="reason" value=${current.reason} />
            <${Definition} label="groups" value=${(current.groups || []).join(", ")} />
        </dl>
        <div class="detail-block">
            <h3>Arguments</h3>
            <pre>${JSON.stringify(current.arguments ?? {}, null, 2)}</pre>
        </div>
        ${pending.length > 1 && html`<div class="detail-block">
            <h3>Also waiting</h3>
            <ul class="queue">
                ${pending.slice(1).map(item => html`<li key=${item.id}>${
                    `${item.tool} · ${item.agent} · ${shorten(JSON.stringify(item.arguments ?? {}), 60)}`
                }</li>`)}
            </ul>
        </div>`}
        ${error() ? html`<p class="bad approval-error">${error()}</p>` : null}
    `;
}


function ApprovalFooter({ state, answer, approveAll }) {

    const pending = pendingApprovals(state);
    const current = pending[0];

    if (!current) {
        return null;
    }

    return html`
        <button type="button" class="refuse" onClick=${() => answer(current.id, false)}>Deny</button>
        <button type="button" class="allow" onClick=${() => answer(current.id, true)}>Approve</button>
        ${pending.length > 1
            ? html`<button type="button" class="ghost" onClick=${() => approveAll()}>${`Approve all (${pending.length})`}</button>`
            : null}
    `;
}


export function createApprovals({ Modal, state, touch }) {

    let handle = null;
    let disposers = [];
    let lastError = null;

    /* ids present when the operator dismissed the modal */
    let dismissedWith = null;

    const error = () => lastError;

    function close(reason) {

        if (!handle) return;

        const closing = handle;

        handle = null;
        closing.close(reason);
    }

    function open() {

        if (handle) return handle;

        dismissedWith = null;

        const opened = Modal.open({
            title: "Approval required",
            size: "medium",
            dismissible: true,
            onClose: reason => {
                disposers.forEach(dispose => dispose());
                disposers = [];
                if (handle === opened) {
                    handle = null;
                }
                if (reason !== "resolved") {
                    dismissedWith = new Set(state.approvals.keys());
                }
            }
        });

        handle = opened;

        const body = document.createElement("div");
        body.className = "detail";
        const foot = document.createElement("div");
        foot.className = "modal-row";

        opened.setBody(body);
        opened.setFooter(foot);

        disposers = [
            mount(body, ApprovalBody, ["approvals"], { state, error }),
            mount(foot, ApprovalFooter, ["approvals"], { state, answer, approveAll }),
            effect(() => {
                watch("approvals");
                const pending = pendingApprovals(state);
                if (pending[0]) {
                    opened.setTitle(`Approval required — ${pending[0].tool}`);
                    opened.setSubtitle(`1/${pending.length} pending · requested by ${pending[0].agent}`);
                }
            })
        ];

        return opened;
    }

    /* keeps the header counter and the modal in step with the queue */
    function sync() {

        const count = state.approvals.size;
        const button = document.getElementById("approvalsButton");
        const counter = document.getElementById("approvalsCount");

        if (button) button.hidden = count === 0;
        if (counter) counter.textContent = String(count);

        if (count === 0) {
            dismissedWith = null;
            lastError = null;
            close("resolved");
            return;
        }

        if (handle) return;

        const unseen =
            !dismissedWith ||
            [...state.approvals.keys()].some(id => !dismissedWith.has(id));

        if (unseen) open();
    }

    async function post(id, approved) {

        try {
            const response = await apiFetch(`/api/approvals/${encodeURIComponent(id)}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ approved })
            });
            /* 404: the request is no longer pending (answered elsewhere or
               the run ended), so there is nothing to put back */
            if (response.ok || response.status === 404) return null;
            return `the server refused the answer (${response.status})`;
        } catch (failure) {
            return `the answer could not be sent (${failure && failure.message ? failure.message : "network error"})`;
        }
    }

    function restore(entries, message) {

        for (const [id, request] of entries) {
            state.approvals.set(id, request);
        }

        lastError = message;
        dismissedWith = null;
        touch("approvals");
    }

    async function answer(id, approved) {

        const request = state.approvals.get(id);

        if (!request) return;

        lastError = null;
        state.approvals.delete(id);
        touch("approvals");

        const failure = await post(id, approved);

        if (failure) {
            restore([[id, request]], failure);
        }
    }

    async function approveAll() {

        const entries = [...state.approvals.entries()];

        lastError = null;
        state.approvals.clear();
        touch("approvals");

        const failed = [];
        let message = null;

        for (const [id, request] of entries) {
            const failure = await post(id, true);
            if (failure) {
                failed.push([id, request]);
                message = failure;
            }
        }

        if (failed.length > 0) {
            restore(failed, message);
        }
    }

    return { sync, open, answer, approveAll, isOpen: () => Boolean(handle) };
}
