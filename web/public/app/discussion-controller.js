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
import { mountInModal } from "./dom.js";
import { Discussion } from "./discussion-view.js";
import { el, node } from "./console-core.js";
import { clearComposer, taskWithAttachments, uploadFor } from "./composer-controller.js";


function discussionOptionsRow() {

    const container =
        el("discussionOptions");

    if (!container || container.dataset.built === "1") {
        return container;
    }

    container.dataset.built = "1";

    const grid = node("div", "discussion-personas");

    const setAll = checked => {

        for (const box of grid.querySelectorAll("input[type=checkbox]")) {
            box.checked = checked;
        }
    };

    /* the spec's example panel, so a first run already shows a
       disagreement instead of a monologue */
    const preselect =
        new Set(["security", "backend", "frontend", "architect", "performance"]);

    for (const persona of state.discussionPersonas) {

        const label = node("label", "discussion-persona");
        label.title = persona.description;

        const checkbox = node("input", "persona-box");
        checkbox.type = "checkbox";
        checkbox.value = persona.id;
        checkbox.checked = preselect.has(persona.id);

        label.append(checkbox, node("span", null, persona.id));

        grid.appendChild(label);
    }

    const head = node("div", "discussion-persona-head");
    head.appendChild(node("span", null, "personas"));

    head.append(
        Modal.button("all", "link", () => setAll(true)),
        Modal.button("none", "link", () => setAll(false))
    );

    const bottom = node("div", "discussion-meta");

    const rounds = node("input", "filter");
    rounds.id = "discussionRounds";
    rounds.type = "number";
    rounds.min = "1";
    rounds.max = "10";
    rounds.value = "5";
    rounds.title = "maximum rounds (1-10)";

    const status = node("span", "muted discussion-status-line");
    status.id = "discussionStatusLine";

    bottom.append(
        node("span", null, "max rounds"),
        rounds,
        status
    );

    container.append(head, grid, bottom);

    return container;
}


function selectedDiscussionPersonas() {

    const boxes =
        el("discussionOptions")?.querySelectorAll(
            ".persona-box"
        );

    return [
        ...(boxes || [])
    ].filter(box => box.checked).map(box => box.value);
}


/*
| The composer's discussion status line and the Discussion button. The run
| button is not touched here: its label and state are derived from the
| store in bindRunControls().
*/
export function refreshDiscussionComposerStatus() {

    const button = el("discussionButton");
    const line = el("discussionStatusLine");
    const discussion = state.discussion;

    if (button) {
        button.classList.toggle("active", state.discussionMode);
    }

    if (!line || line.dataset.error === "1") {
        return;
    }

    line.className = "muted discussion-status-line";
    line.replaceChildren();

    if (!discussion) {
        return;
    }

    let text;

    if (discussion.status === "running") {
        const round =
            discussion.rounds?.length
                ? `${discussion.rounds.length} of ${discussion.max_rounds}`
                : "starting";
        text = `round ${round} ·`;
    } else if (discussion.status === "done") {
        text = `done in ${discussion.total_rounds} round(s) ·`;
    } else {
        text = `failed · ${discussion.error || "unknown error"}`;
    }

    line.appendChild(node("span", null, text));

    if (discussion.status !== "failed") {
        line.appendChild(Modal.button("view", "link", () => openDiscussion()));
    }
}


/* an error on the composer line stays until the operator acts again */
function showDiscussionError(message) {

    const line = el("discussionStatusLine");

    if (!line) {
        return;
    }

    line.dataset.error = "1";
    line.className = "bad";
    line.textContent = message;
}


function clearDiscussionError() {

    const line = el("discussionStatusLine");

    if (line) {
        delete line.dataset.error;
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

        try {
            const response = await fetch("/api/discussion/personas");
            const payload = await response.json();
            state.discussionPersonas = response.ok ? payload.personas || [] : [];
        } catch {
            state.discussionPersonas = [];
        }
    }

    const options = el("discussionOptions");

    if (options) {
        options.hidden = !state.discussionMode;
    }

    if (state.discussionMode) {
        discussionOptionsRow();
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

    clearDiscussionError();

    const personas = selectedDiscussionPersonas();

    if (personas.length === 0) {
        showDiscussionError("select at least one persona");
        return;
    }

    const maxRounds =
        Math.max(1, Math.min(10, Number(el("discussionRounds")?.value) || 5));

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
