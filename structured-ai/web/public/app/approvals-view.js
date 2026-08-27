/*
|--------------------------------------------------------------------------
| Console approvals-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The approval modal: the pending list, the counter chip, approve-all, and
| answering one request through the same endpoint the server's policy waits on.
|
| The queue is the engine's own store (phase 21), so a second tab that resolves
| one first makes this one answer 404 — that is the contract, and the modal has to
| survive it without stranding the operator.
|--------------------------------------------------------------------------
*/

import { Modal, definition, el, node } from "./dom.js";
import { shorten } from "./formatters.js";
import { answerApproval, approveAll } from "./api.js";
import { approvalState } from "./store.js";

export function renderApprovals() {

    const pending =
        [...approvalState.approvals.values()];

    const button = el("approvalsButton");

    button.hidden = pending.length === 0;

    el("approvalsCount").textContent = String(pending.length);

    if (pending.length === 0) {

        if (approvalState.approvalModal) {

            const handle = approvalState.approvalModal;

            approvalState.approvalModal = null;

            handle.close("resolved");
        }

        return;
    }

    if (!approvalState.approvalModal) {
        openApprovalModal();

        return;
    }

    fillApprovalModal();
}

export function openApprovalModal() {

    approvalState.approvalModal =
        Modal.open({
            title: "Approval required",
            size: "medium",
            dismissible: true,

            onClose: () => {

                approvalState.approvalModal = null;
            }
        });

    fillApprovalModal();
}

export function fillApprovalModal() {

    const handle = approvalState.approvalModal;

    if (!handle) {
        return;
    }

    const pending =
        [...approvalState.approvals.values()];

    const current = pending[0];

    handle.setTitle(`Approval required — ${current.tool}`);

    handle.setSubtitle(
        `1/${pending.length} pending · requested by ${current.agent}`
    );

    const body = node("div", "detail");

    const list = node("dl", "detail-grid");

    definition(list, "tool", current.tool);
    definition(list, "agent", current.agent);
    definition(list, "reason", current.reason);

    definition(
        list,
        "groups",
        (current.groups || []).join(", ")
    );

    body.appendChild(list);

    const block = node("div", "detail-block");

    block.append(
        node("h3", null, "Arguments"),
        node(
            "pre",
            null,
            JSON.stringify(current.arguments ?? {}, null, 2)
        )
    );

    body.appendChild(block);

    if (pending.length > 1) {

        const queue = node("div", "detail-block");

        queue.appendChild(node("h3", null, "Also waiting"));

        const rest = node("ul", "queue");

        for (const item of pending.slice(1)) {

            rest.appendChild(
                node(
                    "li",
                    null,
                    `${item.tool} · ${item.agent} · ${shorten(
                        JSON.stringify(item.arguments ?? {}),
                        60
                    )}`
                )
            );
        }

        queue.appendChild(rest);

        body.appendChild(queue);
    }

    handle.setBody(body);

    handle.setFooter(
        Modal.row(
            Modal.button(
                "Deny",
                "refuse",
                () => answerApproval(current.id, false)
            ),
            Modal.button(
                "Approve",
                "allow",
                () => answerApproval(current.id, true)
            ),
            pending.length > 1
                ? Modal.button(
                    `Approve all (${pending.length})`,
                    "ghost",
                    () => approveAll()
                )
                : null
        )
    );
}
