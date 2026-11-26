/*
|--------------------------------------------------------------------------
| Discussion
|--------------------------------------------------------------------------
|
| The composer's discussion mode: the persona options row, its status line,
| starting a discussion and the live Discussion modal. While it runs, the
| event stream paints the rounds into the modal as they happen.
*/

import { state, touch } from "./store.js";
import { bind, mount, mountInModal } from "./dom.js";
import { Discussion, DiscussionOptions } from "./discussion-view.js";
import { el } from "./console-core.js";
import { clearComposer, taskWithAttachments, uploadFor } from "./composer-controller.js";


/* the spec's example panel, so a first run already shows a disagreement
   instead of a monologue */
const PRESELECT =
    new Set(["security", "backend", "frontend", "architect", "performance"]);


const optionActions = {

    toggle(id, checked) {
        const selection = new Set(state.discussionSelection || []);
        if (checked) selection.add(id);
        else selection.delete(id);
        state.discussionSelection = [...selection];
        touch("composer");
    },

    selectAll(checked) {
        state.discussionSelection = checked ? state.discussionPersonas.map(persona => persona.id) : [];
        touch("composer");
    },

    /* the field is drawn from this value, so a redraw keeps what was typed */
    rounds(value) {
        state.discussionRounds = value;
    },

    view: () => openDiscussion()
};


/*
| The options row under the task box and the Discussion button's state are
| drawn from the store: the row while discussion mode is on, the button's
| highlight whenever the mode flips.
*/
export function mountDiscussionComposer() {

    const options = el("discussionOptions");

    mount(options, DiscussionOptions, ["discussion", "composer"], { state, actions: optionActions });

    bind(["discussion", "composer"], () => {
        if (options) options.hidden = !state.discussionMode;
        el("discussionButton")?.classList.toggle("active", state.discussionMode);
    });
}


function selectedDiscussionPersonas() {

    const selection = new Set(state.discussionSelection || []);

    return state.discussionPersonas
        .filter(persona => selection.has(persona.id))
        .map(persona => persona.id);
}


function showDiscussionError(message) {

    state.discussionError = message;
    touch("composer");
}


async function loadPersonas() {

    try {
        const response = await fetch("/api/discussion/personas");
        const payload = await response.json();
        state.discussionPersonas = response.ok ? payload.personas || [] : [];
    } catch {
        state.discussionPersonas = [];
    }

    /* the first list that arrives gets the default panel; a failed load
       leaves the selection open for the next attempt */
    if (state.discussionSelection === null && state.discussionPersonas.length > 0) {
        state.discussionSelection =
            state.discussionPersonas.filter(persona => PRESELECT.has(persona.id)).map(persona => persona.id);
    }
}


export async function toggleDiscussionMode() {

    /* while a discussion is going, the button opens the live view
       instead of flipping the form */

    if (state.discussion?.status === "running") {
        openDiscussion();
        return;
    }

    state.discussionMode = !state.discussionMode;

    if (state.discussionMode && state.discussionPersonas.length === 0) {
        await loadPersonas();
    }

    touch("composer");
}


function openDiscussion() {

    if (state.discussionModal && state.discussionModal.isOpen()) {
        return state.discussionModal;
    }

    let dispose = () => {};

    const handle =
        Modal.open({
            title: "Discussion",
            subtitle: "specialist personas deliberate in rounds; an observer decides when to finish",
            size: "large",
            footer: Modal.row(Modal.button("Close", "", () => handle.close("footer"))),
            onClose: () => {
                dispose();
                state.discussionModal = null;
            }
        });

    dispose = mountInModal(handle, Discussion, ["discussion"], { state }, "discussion");

    state.discussionModal = handle;

    return handle;
}

/*
| Execution and Events live in a hidden row and open as header modals.
| A modal draws its own copy of the view from the store (class names
| only, so every id stays unique on the page); nothing is moved between
| the page and the dialog, so closing one can never strand a node.
*/


/*
| Discussion mode sends the same task box to the panel instead of the
| delegation tree: the personas and the round limit come from the options
| row, and the live view opens as it runs.
*/
export async function submitDiscussion(task, reasoningEffort) {

    state.discussionError = null;
    touch("composer");

    const personas = selectedDiscussionPersonas();

    if (personas.length === 0) {
        showDiscussionError("select at least one persona");
        return;
    }

    const maxRounds =
        Math.max(1, Math.min(10, Number(state.discussionRounds) || 5));

    const files = new Map();

    if (!(await uploadFor([state.currentProjectId], files))) {
        return;
    }

    const discussionTask =
        state.attachments.length > 0
            ? taskWithAttachments(task, files.get(state.currentProjectId || "__default__"))
            : task;

    const url =
        state.currentProjectId
            ? `/api/projects/${encodeURIComponent(state.currentProjectId)}/discussions`
            : "/api/discussion";

    state.submitting = true;
    touch("composer");

    try {

        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                task: discussionTask,
                personas,
                max_rounds: maxRounds,
                ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
            })
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            showDiscussionError(payload.error || `request failed (${response.status})`);
            return;
        }

        const payload = await response.json().catch(() => ({}));

        clearComposer();

        /* the stream confirms with discussion:start; this keeps the
           composer honest in the meantime */
        state.discussion = {
            id: payload.id || null,
            status: "running",
            task: discussionTask,
            personas,
            max_rounds: maxRounds,
            rounds: [],
            observer_decisions: [],
            final_report: null
        };

        touch("discussion", "composer");
        openDiscussion();

    } catch (error) {
        showDiscussionError(`the discussion could not be started (${error.message || "network error"})`);
    } finally {
        state.submitting = false;
        touch("composer");
    }
}
