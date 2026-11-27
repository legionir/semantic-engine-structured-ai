/*
|--------------------------------------------------------------------------
| Discussion
|--------------------------------------------------------------------------
|
| The Discussion modal: configuring a multi-agent deliberation (topic,
| personas, round limit), starting it, and streaming the live rounds and
| observer synthesis inside the modal.
*/

import { state, touch } from "./store.js";
import { bind, mount, mountInModal } from "./dom.js";
import { Discussion, DiscussionFooter } from "./discussion-view.js";
import { el } from "./console-core.js";
import { selectedReasoningEffort, taskWithAttachments, uploadFor } from "./composer-controller.js";
import { apiFetch } from "./auth-transport.js";


/* the spec's example panel, so a first run already shows a disagreement
   instead of a monologue */
const PRESELECT =
    new Set(["security", "backend", "frontend", "architect", "performance"]);


const modalActions = {

    toggle(id, checked) {
        const selection = new Set(state.discussionSelection || []);
        if (checked) selection.add(id);
        else selection.delete(id);
        state.discussionSelection = [...selection];
        touch("discussion");
    },

    selectAll(checked) {
        state.discussionSelection = checked ? state.discussionPersonas.map(persona => persona.id) : [];
        touch("discussion");
    },

    /* the field is drawn from this value, so a redraw keeps what was typed */
    rounds(value) {
        state.discussionRounds = value;
    },

    draft(value) {
        state.discussionDraft = value;
    },

    setView(showSetup) {
        state.discussionShowSetup = Boolean(showSetup);
        state.discussionError = null;
        touch("discussion");
    },

    submit() {
        void submitDiscussion(state.discussionDraft, selectedReasoningEffort());
    }
};


/*
| Highlight the composer's Discussion button while a discussion is running
| or its modal is open.
*/
export function mountDiscussionComposer() {

    bind(["discussion", "composer"], () => {
        const active =
            state.discussion?.status === "running" ||
            Boolean(state.discussionModal && state.discussionModal.isOpen());
        el("discussionButton")?.classList.toggle("active", active);
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
    touch("discussion", "composer");
}


async function loadPersonas() {

    state.discussionPersonasLoading = true;
    touch("discussion");

    try {
        const response = await apiFetch("/api/discussion/personas");
        const payload = await response.json();
        state.discussionPersonas = response.ok ? payload.personas || [] : [];
    } catch {
        state.discussionPersonas = [];
    } finally {
        state.discussionPersonasLoading = false;
    }

    /* the first list that arrives gets the default panel; a failed load
       leaves the selection open for the next attempt */
    if (state.discussionSelection === null && state.discussionPersonas.length > 0) {
        state.discussionSelection =
            state.discussionPersonas.filter(persona => PRESELECT.has(persona.id)).map(persona => persona.id);
    }

    touch("discussion", "composer");
}


export function toggleDiscussionMode() {

    return openDiscussion();
}


export function openDiscussion() {

    if (state.discussionPersonas.length === 0 && !state.discussionPersonasLoading) {
        void loadPersonas();
    }

    if (state.discussionModal && state.discussionModal.isOpen()) {
        return state.discussionModal;
    }

    state.discussionModal = null;
    state.discussionError = null;

    if (!state.discussion) {
        state.discussionShowSetup = true;
        const composerDraft = el("task")?.value?.trim();
        if (!state.discussionDraft && composerDraft) {
            state.discussionDraft = composerDraft;
        }
    } else {
        state.discussionShowSetup = false;
    }

    let disposeBody = () => {};
    let disposeFooter = () => {};

    const footerHost = document.createElement("div");
    footerHost.className = "discussion-modal-footer";

    const handle =
        Modal.open({
            title: "Discussion",
            subtitle: "specialist personas deliberate in rounds; an observer decides when to finish",
            size: "large",
            footer: footerHost,
            onClose: () => {
                disposeBody();
                disposeFooter();
                state.discussionModal = null;
                touch("discussion");
            }
        });

    disposeBody = mountInModal(handle, Discussion, ["discussion", "composer"], { state, actions: modalActions }, "discussion");
    disposeFooter = mount(
        footerHost,
        DiscussionFooter,
        ["discussion", "composer"],
        { state, actions: modalActions, onClose: () => handle.close("footer") }
    );

    state.discussionModal = handle;
    touch("discussion");

    return handle;
}


/*
| Starts a discussion from the Discussion modal: validates the topic and
| personas, posts to the discussion endpoint, and switches the modal to the
| live transcript.
*/
export async function submitDiscussion(taskInput, reasoningEffort) {

    state.discussionError = null;
    touch("discussion");

    let task = String(taskInput ?? "").trim();

    if (task === "" && state.attachments.length === 0) {
        showDiscussionError("enter a topic or task");
        return;
    }

    if (task === "") {
        task = "Inspect the attached file(s) and determine the appropriate next step.";
    }

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
    touch("discussion", "composer");

    try {

        const response = await apiFetch(url, {
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

        state.discussionDraft = "";
        state.discussionShowSetup = false;
        state.attachments = [];
        state.attachmentError = null;

        /* the stream confirms with discussion:start; this keeps the
           modal honest in the meantime */
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

        touch("discussion", "composer", "attachments");
        openDiscussion();

    } catch (error) {
        showDiscussionError(`the discussion could not be started (${error.message || "network error"})`);
    } finally {
        state.submitting = false;
        touch("discussion", "composer");
    }
}
