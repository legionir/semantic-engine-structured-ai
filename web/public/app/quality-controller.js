/*
|--------------------------------------------------------------------------
| Agent quality in the console (roadmap P3-03, P3-05, P3-08, P3-09)
|--------------------------------------------------------------------------
|
|   plan banner    a turn sent with "Plan first" ends with its plan; the
|                  banner above the chat approves it (the next turn runs
|                  without plan mode and executes the plan) or sends a
|                  revision (still in plan mode)
|   cost / goal    what the run on screen has cost (and its cap), and the
|                  goal verdict, next to the composer
|   Changes        what each task changed in the workspace (git snapshots
|                  under refs/structured-ai/runs) and a whole-task revert;
|                  a file changed again since is a conflict, overwritten
|                  only on request
|   Review         a structured review of the diff, the staged changes, a
|                  branch, a commit or a pull request; the selected
|                  findings become the next task
*/

import { state, touch } from "./store.js";
import { html, mount, mountInModal } from "./dom.js";
import { el } from "./console-core.js";
import { apiRequest } from "./operator-api.js";
import { formatCost } from "./run-extras.js";
import { submitTask } from "./composer-controller.js";
import { SkeletonCards, SkeletonLines, SkeletonRows } from "./skeleton-view.js";


const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function quality() {

    if (!state.qualityView) {
        state.qualityView = {
            planBusy: false,
            revision: "",
            snapshots: { runs: [], loading: false, diffLoading: false, error: null, selected: null, diff: null, conflicts: null, busy: false, notice: null },
            review: { target: "diff", ref: "", focus: "", loading: false, error: null, result: null, selected: new Set() }
        };
    }

    return state.qualityView;
}

const projectQuery = () =>
    state.currentProjectId ? `?projectId=${encodeURIComponent(state.currentProjectId)}` : "";

const projectBody = () =>
    state.currentProjectId ? { projectId: state.currentProjectId } : {};


/* ------------------------------------------------------------ plan banner */

function planVisible(view) {

    const ready = view.planReady;

    if (!ready) return false;

    return !ready.project_id || ready.project_id === (view.currentProjectId || null);
}


export function PlanApproval({ state: view, actions }) {

    if (!planVisible(view)) return null;

    const local = quality();

    return html`
        <div class="plan-approval" role="status" aria-live="polite">
            <strong>The plan is ready for your approval</strong>
            <span class="muted">Nothing in the project has changed yet. Open Plan to read it.</span>
            <div class="plan-approval-actions">
                <button type="button" disabled=${local.planBusy} onClick=${() => actions.approve()}>Approve and run</button>
                <input
                    type="text"
                    placeholder="What should change in the plan?"
                    value=${local.revision}
                    disabled=${local.planBusy}
                    onInput=${event => { local.revision = event.target.value; }}
                    onKeyDown=${event => { if (event.key === "Enter") actions.revise(); }}
                />
                <button type="button" class="ghost" disabled=${local.planBusy} onClick=${() => actions.revise()}>Revise</button>
                <button type="button" class="ghost" disabled=${local.planBusy} onClick=${() => actions.dismiss()}>Dismiss</button>
            </div>
        </div>
    `;
}


export const planActions = {

    async approve() {

        const local = quality();

        local.planBusy = true;
        touch("quality");

        /* no plan_mode: this turn may change the project */
        const ok = await submitTask("The plan is approved. Execute it now, step by step, and report what you changed.", null, {});

        local.planBusy = false;
        if (ok) {
            state.planReady = null;
        }
        touch("quality");
    },

    async revise() {

        const local = quality();
        const text = local.revision.trim();

        if (text === "") return;

        local.planBusy = true;
        touch("quality");

        const ok = await submitTask(`Revise the plan: ${text}`, null, { plan_mode: true });

        local.planBusy = false;
        if (ok) {
            local.revision = "";
            state.planReady = null;
        }
        touch("quality");
    },

    dismiss() {

        state.planReady = null;
        touch("quality");
    }
};


/* ------------------------------------------------------------ cost / goal */

export function RunCost({ state: view }) {

    const cost = formatCost(view.runCost);
    const goal = view.runGoal;

    if (!cost && !goal) return null;

    return html`
        <span class=${`cost-figure${view.runCost && view.runCost.capReached ? " cap-reached" : ""}`}
              title=${view.runCost ? `${view.runCost.requests || 0} model requests${(view.runCost.unpriced_models || []).length ? `; no price for ${view.runCost.unpriced_models.join(", ")} (MODEL_PRICES)` : ""}` : ""}>
            ${cost}${view.runCost && view.runCost.capReached ? " · cap reached" : ""}
        </span>
        ${goal ? html`
            <span class=${`run-goal ${goal.met ? "met" : "open"}`} title=${goal.reason || ""}>
                goal: ${goal.met ? "met" : goal.outcome === "stopped" ? "not met" : "not yet"}
            </span>` : null}
    `;
}


/* ---------------------------------------------------------------- Changes */

function ChangesBody({ actions }) {

    const view = quality().snapshots;

    if (view.loading && view.runs.length === 0) return html`<${SkeletonRows} count=${4} label="Loading task changes…" />`;
    if (view.error) return html`<p class="interrupted-error">${view.error}</p>`;
    if (view.runs.length === 0) {
        return html`<p class="muted">No task has been recorded yet. Each task in a git project gets a before and after snapshot (RUN_SNAPSHOTS).</p>`;
    }

    return html`
        <div class="snapshot-list">
            ${view.notice ? html`<p class="notice">${view.notice}</p>` : null}
            ${view.runs.map(run => html`
                <div class=${`snapshot-row${view.selected === run.run_id ? " selected" : ""}`} key=${run.run_id}>
                    <button type="button" class="ghost" onClick=${() => actions.select(run.run_id)}>${run.run_id}</button>
                    <span class="muted">${run.created_at ? new Date(run.created_at).toLocaleString() : ""}${run.after ? "" : " · running"}</span>
                </div>
            `)}
        </div>
        ${view.diffLoading && !view.diff ? html`<${SkeletonLines} rows=${6} label="Loading snapshot diff…" />` : null}
        ${view.diff ? html`
            <div class="snapshot-diff">
                <ul class="snapshot-files">
                    ${view.diff.files.length === 0 ? html`<li class="muted">This task changed no file.</li>` : null}
                    ${view.diff.files.map(file => html`<li key=${file.path}><code>${file.status}</code> ${file.path}</li>`)}
                </ul>
                ${view.conflicts ? html`
                    <p class="interrupted-error">
                        Changed again after the task: ${view.conflicts.join(", ")}. Reverting anyway overwrites those edits.
                    </p>` : null}
                <div class="snapshot-actions">
                    <button type="button" class="danger" disabled=${view.busy || view.diff.files.length === 0} onClick=${() => actions.revert(Boolean(view.conflicts))}>
                        ${view.conflicts ? "Revert anyway" : "Revert this task"}
                    </button>
                </div>
                <pre class="snapshot-patch">${view.diff.patch || ""}${view.diff.truncated ? "\n… (cut)" : ""}</pre>
            </div>` : null}
    `;
}


const changesActions = {

    async refresh() {

        const view = quality().snapshots;

        view.loading = true;
        view.error = null;
        touch("quality");

        const result = await apiRequest(`/api/snapshots${projectQuery()}`);

        view.loading = false;
        view.runs = result.ok ? result.payload.runs || [] : [];
        view.error = result.ok ? null : result.error;
        touch("quality");
    },

    async select(runId) {

        const view = quality().snapshots;

        view.selected = runId;
        view.diff = null;
        view.diffLoading = true;
        view.conflicts = null;
        view.notice = null;
        touch("quality");

        const result = await apiRequest(`/api/snapshots/${encodeURIComponent(runId)}${projectQuery()}`);

        view.diffLoading = false;
        view.diff = result.ok ? result.payload : null;
        view.error = result.ok ? null : result.error;
        touch("quality");
    },

    async revert(force) {

        const view = quality().snapshots;

        if (!view.selected) return;

        view.busy = true;
        touch("quality");

        const result = await apiRequest(`/api/snapshots/${encodeURIComponent(view.selected)}/revert`, { json: { ...projectBody(), force } });

        view.busy = false;

        if (result.ok) {
            view.notice = `Reverted ${view.selected}: ${result.payload.restored.length} restored, ${result.payload.removed.length} removed.`;
            view.conflicts = null;
            view.diff = null;
        } else if (result.status === 409 && result.payload && Array.isArray(result.payload.conflicts)) {
            view.conflicts = result.payload.conflicts;
        } else {
            view.error = result.error;
        }

        touch("quality");
    }
};


export function openTaskChanges() {

    let dispose = () => {};

    const handle = Modal.open({
        title: "Task changes",
        subtitle: "What each task changed; revert a whole task",
        size: "large",
        onClose: () => dispose()
    });

    const view = quality().snapshots;
    view.selected = null;
    view.diff = null;
    view.conflicts = null;
    view.notice = null;

    dispose = mountInModal(handle, () => ChangesBody({ actions: changesActions }), ["quality", "projects"], {}, "quality-modal");

    void changesActions.refresh();

    return handle;
}


/* ----------------------------------------------------------------- Review */

function fixTaskFor(findings, label) {

    return [
        `Fix these findings from ${label}. For each one, check it is real first; fix it with the smallest correct change, and say which ones you did not fix and why.`,
        "",
        ...findings.map((item, index) =>
            `${index + 1}. [${item.severity}] ${item.file}${item.line ? `:${item.line}` : ""} — ${item.title}${item.detail ? `\n   ${item.detail}` : ""}${item.suggestion ? `\n   Suggested fix: ${item.suggestion}` : ""}`)
    ].join("\n");
}


function ReviewBody({ actions }) {

    const view = quality().review;
    const needsRef = view.target === "commit" || view.target === "branch" || view.target === "pr";

    return html`
        <form class="review-form" onSubmit=${event => { event.preventDefault(); actions.run(); }}>
            <select value=${view.target} onChange=${event => { view.target = event.target.value; touch("review"); }}>
                <option value="diff">Uncommitted changes</option>
                <option value="staged">Staged changes</option>
                <option value="branch">Branch vs base</option>
                <option value="commit">One commit</option>
                <option value="pr">Pull request</option>
            </select>
            ${needsRef ? html`
                <input type="text" value=${view.ref}
                    placeholder=${view.target === "pr" ? "PR number" : view.target === "branch" ? "branch (default: current)" : "commit (default: HEAD)"}
                    onInput=${event => { view.ref = event.target.value; }} />` : null}
            <input type="text" value=${view.focus} placeholder="Focus (optional), e.g. security"
                onInput=${event => { view.focus = event.target.value; }} />
            <button type="submit" disabled=${view.loading}>${view.loading ? "Reviewing…" : "Review"}</button>
        </form>
        ${view.loading ? html`<${SkeletonCards} count=${3} label="Running review…" />` : null}
        ${view.error ? html`<p class="interrupted-error">${view.error}</p>` : null}
        ${view.result ? html`
            <div class="review-result">
                <p><strong>${view.result.label}</strong>${view.result.truncated ? " (diff cut at REVIEW_MAX_DIFF_CHARS)" : ""} — ${view.result.summary}</p>
                ${view.result.findings.length === 0 ? html`<p class="muted">No findings.</p>` : null}
                <ul class="review-findings">
                    ${view.result.findings.map((item, index) => html`
                        <li key=${index} class=${`finding severity-${item.severity}`}>
                            <label>
                                <input type="checkbox" checked=${view.selected.has(index)} onChange=${() => actions.toggle(index)} />
                                <span class="badge">${item.severity}</span>
                                <code>${item.file}${item.line ? `:${item.line}` : ""}</code>
                                ${item.outside_diff ? html`<span class="muted"> (outside the diff)</span>` : null}
                                <span> ${item.title}</span>
                            </label>
                            ${item.detail ? html`<div class="muted">${item.detail}</div>` : null}
                            ${item.suggestion ? html`<div>Fix: ${item.suggestion}</div>` : null}
                        </li>
                    `)}
                </ul>
                ${view.result.findings.length > 0 ? html`
                    <button type="button" disabled=${view.selected.size === 0} onClick=${() => actions.fix()}>
                        Fix selected (${view.selected.size})
                    </button>` : null}
            </div>` : null}
    `;
}


const reviewActions = {

    async run() {

        const view = quality().review;
        const ref = view.ref.trim();

        view.loading = true;
        view.error = null;
        view.result = null;
        touch("review");

        const result = await apiRequest("/api/review", {
            json: {
                ...projectBody(),
                target: view.target,
                ...(view.target === "pr" ? { number: Number(ref) } : ref ? { ref } : {}),
                ...(view.focus.trim() ? { focus: view.focus.trim() } : {})
            }
        });

        view.loading = false;

        if (result.ok) {
            const findings = [...(result.payload.findings || [])]
                .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
            view.result = { ...result.payload, findings };
            view.selected = new Set(findings.map((item, index) => index).filter(index => ["critical", "high"].includes(findings[index].severity)));
        } else {
            view.error = result.error;
        }

        touch("review");
    },

    toggle(index) {

        const view = quality().review;

        if (view.selected.has(index)) view.selected.delete(index);
        else view.selected.add(index);

        touch("review");
    },

    async fix() {

        const view = quality().review;
        const findings = view.result.findings.filter((item, index) => view.selected.has(index));

        if (findings.length === 0) return;

        const ok = await submitTask(fixTaskFor(findings, view.result.label), null, {});
        if (ok) {
            reviewHandle?.close?.();
        }
    }
};


let reviewHandle = null;

export function openReview() {

    let dispose = () => {};

    reviewHandle = Modal.open({
        title: "Review",
        subtitle: "A structured review by a separate reviewer prompt",
        size: "large",
        onClose: () => { dispose(); reviewHandle = null; }
    });

    dispose = mountInModal(reviewHandle, () => ReviewBody({ actions: reviewActions }), ["review", "projects"], {}, "quality-modal");

    return reviewHandle;
}


/* ------------------------------------------------------------------- init */

export function initQuality() {

    const banner = el("planApproval");
    const cost = el("runCost");

    if (banner) mount(banner, () => PlanApproval({ state, actions: planActions }), ["quality", "projects"]);
    if (cost) mount(cost, () => RunCost({ state }), ["quality"]);

    el("taskChangesButton")?.addEventListener("click", openTaskChanges);
    el("reviewButton")?.addEventListener("click", openReview);
}
