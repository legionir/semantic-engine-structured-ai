/*
|--------------------------------------------------------------------------
| Console modal-manager (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| Borrowing live nodes into a modal and giving them back.
|
| The comment that travelled with `borrow` is the reason this file exists: an
| earlier version handed the modal a shared container, Modal.close() detached the
| backdrop before running onClose, the scroller left with it, the restore could
| not find its home — after which #tree and #log were null for the rest of the
| session. Reversal is recorded per node, and only ever given nodes this function
| builds itself.
|--------------------------------------------------------------------------
*/

import { Modal, el, node } from "./dom.js";
import { applyLogFilter, log } from "./event-view.js";
import { eventState, executionState } from "./store.js";

/*
| Execution and Events live in a hidden row and are shown as header modals.
| Moving the actual node into the modal body (not a clone) keeps the live
| renderers working: el("tree")/el("log") still find the node wherever it
| is, and on close the node is returned to its hidden home.
*/

export const hiddenSection = () => el("rowTwo");

/*
| Borrowing has to be reversible exactly, so where each node came from
| is recorded before it moves, and the modal is only ever given nodes it
| may own: a wrapper this function builds, never a container other nodes
| also live in.
|
| An earlier version passed the shared .execution-scroll as the modal
| body. Modal.close() detaches the backdrop before it calls onClose, so
| the scroller left with it, the restore could no longer find it, and
| the next open adopted #rowTwo itself. Closing that took the whole
| section out of the document, and el("tree") and el("log") returned
| null for the rest of the session.
*/

export function borrow(nodes) {

    const homes =
        nodes
            .filter(Boolean)
            .map(element => ({
                element,
                parent: element.parentNode,
                next: element.nextSibling
            }));

    return () => {

        for (const home of homes) {

            if (!home.parent) {
                continue;
            }

            /*
            | The anchor is only usable if it is still a child of the
            | same parent; otherwise the node goes back on the end,
            | which is where it was if it had no sibling to begin with.
            */

            const anchor =
                home.next && home.next.parentNode === home.parent
                    ? home.next
                    : null;

            home.parent.insertBefore(home.element, anchor);
        }
    };
}

export function openExecutionModal() {

    if (executionState.executionModal && executionState.executionModal.isOpen()) {
        return executionState.executionModal;
    }

    /* A modal can be removed by browser/navigation cleanup without the
       component callback running. Do not let that stale handle block every
       future Execution click. */
    executionState.executionModal = null;

    const tree = el("tree");
    const archive = el("executionArchive");

    if (!tree && !archive) {
        return null;
    }

    const restore =
        borrow([archive, tree]);

    /*
    | A wrapper the modal owns, wearing the class the stylesheet already
    | targets, so the cards are shown without the page's own scroller
    | being taken away from it.
    */

    const body = node("div", "execution-scroll");

    if (archive) {
        body.appendChild(archive);
    }

    if (tree) {
        body.appendChild(tree);
    }

    const handle =
        Modal.open({
            title: "Execution",

            subtitle:
                () => {

                    const summary = el("execSummary");

                    return summary ? summary.textContent || null : null;
                },

            size: "large",

            body,

            className: "execution-modal",

            onClose: () => {

                try {
                    restore();
                } finally {
                    executionState.executionModal = null;
                }
            }
        });

    executionState.executionModal = handle;

    return handle;
}

export function openEventsModal() {

    if (eventState.eventsModal && eventState.eventsModal.isOpen()) {
        return eventState.eventsModal;
    }

    eventState.eventsModal = null;

    const log = el("log");
    const filter = el("logFilter");
    const type = el("logType");
    const clear = el("clearLog");
    const count = el("logCount");

    if (!log) {
        return null;
    }

    const restore =
        borrow([filter, type, clear, count, log]);

    const controls = node("div", "log-controls");

    for (const control of [filter, type, count, clear]) {

        if (control) {
            controls.appendChild(control);
        }
    }

    const body = node("div", "events-modal-body");

    body.appendChild(controls);
    body.appendChild(log);

    const handle =
        Modal.open({
            title: "Events",

            size: "large",

            body,

            className: "events-modal",

            onClose: () => {

                try {
                    restore();
                } finally {
                    eventState.eventsModal = null;
                }
            }
        });

    eventState.eventsModal = handle;

    /* the filter only makes sense next to the count of what it kept */

    applyLogFilter();

    return handle;
}
