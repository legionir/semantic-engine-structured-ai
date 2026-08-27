/*
|--------------------------------------------------------------------------
| Console discussion-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The multi-persona discussion panel: personas, rounds, the observer's decisions,
| the final report — and the composer switch that sends the task box here instead
| of to the delegation tree.
|
| Not in the refactor doc's module list: it is ~590 lines of app.js, and folding
| it into mcp-view because "both are panels" would have hidden the largest new
| surface in this phase. Recorded as an addition in EXECUTION_PLAN گام ۲.
|--------------------------------------------------------------------------
*/

import { Modal, el, node } from "./dom.js";
import { appendMarkdownParagraph } from "./markdown.js";
import { discussionState } from "./store.js";

/*
| Discussion
| ----------
| The form starts a discussion; while it runs, the same event stream
| the delegation tree uses paints the rounds into the modal as they
| happen. The final report is the only part the observer guarantees,
| so it gets its own section once discussion:finish lands.
*/

export function discussionStatusLine() {

    const discussion = discussionState.discussion;

    if (!discussion) {
        return "no discussion yet";
    }

    if (discussion.status === "running") {
        const round =
            discussion.rounds && discussion.rounds.length
                ? `round ${discussion.rounds.length} of ${discussion.max_rounds}`
                : "starting";

        return `${round} · ${discussion.personas.length} personas`;
    }

    if (discussion.status === "done") {
        return `done · ${discussion.total_rounds} round(s)${discussion.hit_max_rounds ? " · max rounds reached" : ""}`;
    }

    return `failed · ${discussion.error || "unknown error"}`;
}

export function discussionReportView(report) {

    const section = node("div", "discussion-report");

    section.appendChild(node("h3", null, "Final report"));

    if (report.summary) {
        const summary = node("p", "discussion-summary");
        appendMarkdownParagraph(summary, [report.summary]);
        section.appendChild(summary);
    }

    if (report.agreed_points?.length) {
        section.appendChild(node("h4", null, "Agreed"));

        const list = node("ul", "discussion-points");

        for (const point of report.agreed_points) {
            list.appendChild(node("li", null, point));
        }

        section.appendChild(list);
    }

    if (report.unresolved?.length) {
        section.appendChild(node("h4", null, "Unresolved"));

        for (const item of report.unresolved) {
            const entry = node("div", "discussion-unresolved");

            entry.appendChild(node("strong", null, item.topic || "(topic)"));

            for (const side of item.sides || []) {
                entry.appendChild(
                    node(
                        "p",
                        null,
                        `${side.persona}: ${side.reasoning}`
                    )
                );
            }

            section.appendChild(entry);
        }
    }

    if (report.next_steps?.length) {
        section.appendChild(node("h4", null, "Next steps"));

        const ordered =
            [...report.next_steps].sort((a, b) => a.order - b.order);

        for (const step of ordered) {
            section.appendChild(
                node(
                    "p",
                    "discussion-step",
                    `${step.order}. [${step.layer}] ${step.action}`
                )
            );
        }
    }

    return section;
}

export function discussionMessageView(message) {

    const details = node("details", "discussion-message");

    details.appendChild(
        node("summary", null, `${message.persona_name || message.persona} · round ${message.round}`)
    );

    const body = node("div", "discussion-message-body");
    appendMarkdownParagraph(body, [message.content || "(empty)"]);
    details.appendChild(body);

    return details;
}

export function discussionObserverView(decision) {

    const box =
        node("div", `discussion-observer ${decision.decision === "FINISH" ? "finish" : "continue"}`);

    box.appendChild(
        node(
            "strong",
            null,
            `observer · round ${decision.round} → ${decision.decision}`
        )
    );

    for (const point of decision.open_points || []) {
        box.appendChild(
            node(
                "p",
                null,
                `${point.topic}${point.disagreeing?.length ? ` — ${point.disagreeing.join("; ")}` : ""}`
            )
        );
    }

    for (const instruction of Object.values(decision.instructions || {})) {
        box.appendChild(node("p", "muted", instruction));
    }

    return box;
}

export function discussionHistoryView(container) {

    /* Rebuilds the modal body from state, used when the modal opens
       and when a snapshot arrives: the live stream only appends. */

    container.innerHTML = "";

    const discussion = discussionState.discussion;

    const status = node("div", "discussion-status", discussionStatusLine());
    status.id = "discussionStatus";
    container.appendChild(status);

    if (!discussion) {
        return null;
    }

    container.appendChild(
        node("p", "discussion-task", discussion.task)
    );

    for (const round of discussion.rounds || []) {

        container.appendChild(
            node("h4", "discussion-round-head", `Round ${round.round}`)
        );

        for (const message of round.messages || []) {
            container.appendChild(discussionMessageView(message));
        }
    }

    for (const decision of discussion.observer_decisions || []) {
        container.appendChild(discussionObserverView(decision));
    }

    if (discussion.status === "failed" && discussion.error) {
        container.appendChild(node("p", "bad", discussion.error));
    }

    if (discussion.final_report) {
        container.appendChild(discussionReportView(discussion.final_report));
    }

    return container;
}

/*
| The composer's discussion options: persona checkboxes, the round
| limit and a live status line. The row sits under the task textarea
| and only exists while Discussion mode is on, so the default task
| flow stays untouched.
*/

export function discussionOptionsRow() {

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

    for (const persona of discussionState.discussionPersonas) {

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

export function selectedDiscussionPersonas() {

    const boxes =
        el("discussionOptions")?.querySelectorAll(
            ".persona-box"
        );

    return [
        ...(boxes || [])
    ].filter(box => box.checked).map(box => box.value);
}

export function refreshDiscussionComposerStatus() {

    const button = el("discussionButton");
    const run = el("runButton");
    const line = el("discussionStatusLine");

    const discussion = discussionState.discussion;

    if (button) {
        button.classList.toggle("active", discussionState.discussionMode);
    }

    if (!run) {
        return;
    }

    if (discussion?.status === "running") {

        run.disabled = true;
        run.dataset.discussionBusy = "1";
        run.textContent = "Discussion running…";

    } else if (run.dataset.discussionBusy) {

        /* a task and a discussion never run at once (the server
           refuses one while the other is going), so finishing a
           discussion always gives the button straight back */

        delete run.dataset.discussionBusy;
        run.disabled = false;

        run.textContent =
            discussionState.discussionMode
                ? "Start discussion"
                : "Run task";
    }

    if (!line) {
        return;
    }

    line.innerHTML = "";

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
        line.appendChild(
            Modal.button("view", "link", () => openDiscussion())
        );
    }
}

export async function toggleDiscussionMode() {

    /* while a discussion is going, the button opens the live view
       instead of flipping the form */

    if (discussionState.discussion?.status === "running") {
        openDiscussion();
        return;
    }

    discussionState.discussionMode =
        !discussionState.discussionMode;

    if (
        discussionState.discussionMode &&
        discussionState.discussionPersonas.length === 0
    ) {

        try {
            const response =
                await fetch("/api/discussion/personas");

            const payload =
                await response.json();

            discussionState.discussionPersonas =
                payload.personas || [];
        } catch {
            discussionState.discussionPersonas = [];
        }
    }

    const options =
        el("discussionOptions");

    if (options) {
        options.hidden = !discussionState.discussionMode;
    }

    if (discussionState.discussionMode) {
        discussionOptionsRow();
    }

    const run =
        el("runButton");

    /* the label mirrors the mode in both directions, and only while
       no discussion owns the button */

    if (run && !run.dataset.discussionBusy) {
        run.textContent =
            discussionState.discussionMode
                ? "Start discussion"
                : "Run task";
    }

    refreshDiscussionComposerStatus();
}

export async function openDiscussion() {

    if (discussionState.discussionModal && discussionState.discussionModal.isOpen()) {
        return discussionState.discussionModal;
    }

    const container = node("div", "discussion");

    if (discussionState.discussion) {
        discussionHistoryView(container);
    } else {
        container.appendChild(
            node(
                "p",
                "muted",
                "No discussion yet. Enable Discussion under the task box, pick your personas, and send the task."
            )
        );
    }

    discussionState.discussionEl = container;

    const handle =
        Modal.open({
            title: "Discussion",
            subtitle: "specialist personas deliberate in rounds; an observer decides when to finish",
            size: "large",
            body: container,
            footer: Modal.row(Modal.button("Close", "", () => handle.close("footer"))),
            onClose: () => {
                discussionState.discussionModal = null;
                discussionState.discussionEl = null;
            }
        });

    discussionState.discussionModal = handle;

    return handle;
}

export function pushDiscussionEvent(event) {

    const discussion = discussionState.discussion;

    /* A discussion may also be started from the CLI; the first start
       event adopts it, a second one is dropped. */

    if (event.type === "discussion:start") {

        if (
            !discussion ||
            discussion.status !== "running"
        ) {
            discussionState.discussion = {
                id: event.id,
                status: "running",
                task: event.task,
                personas: event.personas,
                max_rounds: event.max_rounds,
                rounds: [],
                observer_decisions: [],
                final_report: null
            };
        } else if (discussion.id && event.id && discussion.id !== event.id) {
            return;
        }

    } else if (!discussion) {
        return;
    }

    const target = discussionState.discussion;

    switch (event.type) {

        case "discussion:start": {
            const status = el("discussionStatus");
            if (status) {
                status.textContent = discussionStatusLine();
            }

            if (discussionState.discussionEl) {
                /* swap the placeholder for the live view */
                discussionHistoryView(discussionState.discussionEl);
            }

            refreshDiscussionComposerStatus();

            break;
        }

        case "discussion:message": {
            let round =
                target.rounds.find(item => item.round === event.round);

            if (!round) {
                round = { round: event.round, messages: [] };
                target.rounds.push(round);
                target.rounds.sort((a, b) => a.round - b.round);
            }

            round.messages.push({
                persona: event.persona,
                persona_name: event.persona_name,
                content: event.content,
                round: event.round
            });

            if (discussionState.discussionEl) {
                discussionState.discussionEl.appendChild(discussionMessageView({ ...event, round: event.round }));
            }

            break;
        }

        case "discussion:observer": {
            target.observer_decisions.push(event);

            if (discussionState.discussionEl) {
                discussionState.discussionEl.appendChild(discussionObserverView(event));
            }
            break;
        }

        case "discussion:round": {
            /* keeps the composer's "round N of M" label current */
            refreshDiscussionComposerStatus();
            break;
        }

        case "discussion:finish": {
            target.status = "done";
            target.total_rounds = event.total_rounds;
            target.hit_max_rounds = event.hit_max_rounds;
            target.stopped_reason = event.stopped_reason || null;
            target.final_report = event.final_report;

            const status = el("discussionStatus");
            if (status) {
                status.textContent = discussionStatusLine();
            }

            if (discussionState.discussionEl && event.final_report) {
                discussionState.discussionEl.appendChild(
                    discussionReportView(event.final_report)
                );
            }

            refreshDiscussionComposerStatus();

            break;
        }

        case "discussion:error": {
            target.status = "failed";
            target.error = event.error;

            const status = el("discussionStatus");
            if (status) {
                status.textContent = discussionStatusLine();
            }

            if (discussionState.discussionEl) {
                discussionState.discussionEl.appendChild(
                    node("p", "bad", event.error)
                );
            }

            refreshDiscussionComposerStatus();

            break;
        }
    }
}
