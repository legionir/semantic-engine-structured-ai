/*
|--------------------------------------------------------------------------
| Agent Run Context
|--------------------------------------------------------------------------
|
| Everything one run owns, nothing another run may see: the identities
| the run correlates by (run/project/parent/turn), the conversation it
| builds, and its three lifelines (wall-clock budget, sub-agent spawn
| budget, cancellation).
|
| The class deliberately also exposes the legacy RUN field surface
| (id, started_at, controller, cancelled_reason, ...) as views over
| those members. The engine's execution path reads and writes through
| that surface via currentRun(), which returns this object in modular
| mode and the untouched global RUN object in legacy mode — so the one
| code path serves both, and legacy behavior stays byte-identical.
|--------------------------------------------------------------------------
*/

const RunCancellation = require("./RunCancellation");
const { RunBudget, AgentSpawnBudget, RunCost } = require("./RunBudget");


class AgentRunContext {

    constructor({
        runId = null,
        project = null,
        task = "",
        parentRunId = null,
        turnId = null,
        messages = [],
        reasoningEffort = null,
        planMode = false,
        goal = null,
        maxCostUsd = null
    } = {}) {

        this.runId = runId;

        /* The ProjectContext this run is scoped to (Phase 2); null when
           a project could not be resolved or the phase-2 mode is legacy. */
        this.project = project;

        this.task = task;

        this.reasoningEffort = reasoningEffort;

        /* P3-03: until the operator approves the plan, nothing may change */
        this.planMode = planMode === true;

        /* P3-05: the end condition checked when the agent says it is done,
           and what the run has cost against its dollar cap */
        this.goal = typeof goal === "string" && goal.trim() !== "" ? goal.trim() : null;

        this.goalStatus = null;

        this.cost = new RunCost({ maxUsd: maxCostUsd });

        this.parentRunId = parentRunId;

        /* The turn currently being executed; a conversational session
           advances it once per user task inside the same run. */
        this.turnId = turnId;

        /* The conversation this run is building (the caller-owned
           history array in a multi-turn session). */
        this.messages = messages;

        this.budget = new RunBudget();

        this.agentBudget = new AgentSpawnBudget();

        this.cancellation = new RunCancellation();

        /* Session-facing per-run state that is not a budget or a signal:
           hook outcomes, whether the after hooks already ran, the loaded
           main-agent definition, the turn counter, and the tool-runtime
           baggage carried across runs (background processes). */
        this.hookResults = {};

        /* The run-scoped on_failure: stop verdict (reason + the hook that
           produced it). Reset per run here, and by startRun() in the
           legacy path, so a stop never silences a later run's hooks. */
        this.hooksStopped = null;

        this.hooksStoppedBy = null;

        this.afterHooksRan = false;

        this.mainAgentDefinition = null;

        this.turnCounter = 0;

        this.carried = null;

        /* Lifecycle bookkeeping filled in by the RunManager. */
        this.status = "created";

        this.finishedAt = 0;

    }


    get projectId() {

        /* Accepts a Phase-2 ProjectContext (projectId) or a bare
           registry record (id). */
        if (!this.project) {
            return null;
        }

        return (
            this.project.projectId ??
            this.project.id ??
            null
        );

    }


    /*----------------------------------------------------------------
    | Legacy RUN field surface — views over the members above, so the
    | shared execution path addressing currentRun().started_at etc.
    | works identically on this class and on the plain legacy object.
    |----------------------------------------------------------------*/

    get id() {

        return this.runId;

    }

    set id(value) {

        this.runId = value;

    }


    get started_at() {

        return this.budget.startedAt;

    }

    set started_at(value) {

        this.budget.startedAt = value;

    }


    get controller() {

        return this.cancellation.controller;

    }

    set controller(value) {

        this.cancellation.controller = value;

    }


    get cancelled_reason() {

        return this.cancellation.reason;

    }

    set cancelled_reason(value) {

        this.cancellation.reason = value;

    }


    get inHook() {

        return this.budget.inHook;

    }

    set inHook(value) {

        this.budget.inHook = value;

    }


    get hook_phase() {

        return this.budget.hookPhase;

    }

    set hook_phase(value) {

        this.budget.hookPhase = value;

    }


    get hook_started_at() {

        return this.budget.hookStartedAt;

    }

    set hook_started_at(value) {

        this.budget.hookStartedAt = value;

    }


    get hook_deadline_at() {

        return this.budget.hookDeadlineAt;

    }

    set hook_deadline_at(value) {

        this.budget.hookDeadlineAt = value;

    }


    get hook_results() {

        return this.hookResults;

    }

    set hook_results(value) {

        this.hookResults = value;

    }


    get after_hooks_ran() {

        return this.afterHooksRan;

    }

    set after_hooks_ran(value) {

        this.afterHooksRan = value;

    }


    get main_agent_definition() {

        return this.mainAgentDefinition;

    }

    set main_agent_definition(value) {

        this.mainAgentDefinition = value;

    }


    get hooks_stopped() {

        return this.hooksStopped;

    }

    set hooks_stopped(value) {

        this.hooksStopped = value;

    }


    get hooks_stopped_by() {

        return this.hooksStoppedBy;

    }

    set hooks_stopped_by(value) {

        this.hooksStoppedBy = value;

    }

}


module.exports = AgentRunContext;
