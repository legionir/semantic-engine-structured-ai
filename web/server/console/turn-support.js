"use strict";

/*
|--------------------------------------------------------------------------
| Turn support
|--------------------------------------------------------------------------
|
| What a turn needs at its edges, shared by the foreground run (task-runner)
| and a project's background run (background-turns): the project frame for
| plan lookups, the project's workspace, the plan-driven auto-continue
| decision and the end-of-turn approval sweep.
|
| A "target" is the object holding the conversation's run state: the
| console's `state` for the foreground, a project conversation for a
| background turn. Both carry the same fields (status, cycles, history,
| lastPlanSignature, stopRequested).
*/


module.exports = function createTurnSupport(shared) {

    const {
        approvalStore,
        resolveApproval,
        runtime
    } = shared;


    /*
    | The plan lives in the run's PROJECT data root. Outside the run (before it
    | starts and in the finally block that decides on auto-continue) there is no
    | run context, so plan lookups must be made inside that project's frame;
    | otherwise a project run is judged by the default project's plan and never
    | continues (or continues on the wrong plan).
    */
    function inRunProject(runOptions, fn) {

        if (
            !runOptions.projectId ||
            typeof runtime.runWithProject !== "function" ||
            typeof runtime.resolveRunProjectContext !== "function"
        ) {
            return fn();
        }

        const context =
            runtime.resolveRunProjectContext({ projectId: runOptions.projectId });

        return runtime.runWithProject(context, fn);
    }


    /* the folder a project's git report reads; undefined = the active one */
    function projectWorkspace(projectId) {

        if (!projectId || typeof runtime.resolveRunProjectContext !== "function") {
            return undefined;
        }

        try {
            return runtime.resolveRunProjectContext({ projectId }).workspaceRoot || undefined;
        } catch {
            return undefined;
        }
    }


    /* events emitted outside the run's scope still name their project */
    function attribution(projectId) {

        return projectId ? { project_id: projectId } : {};
    }


    function planSignature(plan) {

        return plan.exists
            ? `${plan.steps}:${plan.done}:${plan.blocked}`
            : "none";
    }


    function rememberPlan(target, runOptions) {

        if (target.lastPlanSignature === null) {

            target.lastPlanSignature =
                planSignature(inRunProject(runOptions, () => runtime.currentPlanSummary()));
        }
    }


    /*
    | The console equivalent of --until-done: while the plan has open steps
    | and the operator has not stopped, the next cycle starts on its own.
    | Progress is any movement of the plan; a cycle that finished no step
    | would repeat for ever, so the loop stops and says why. Returns true
    | when the caller should start the next cycle.
    */
    function shouldAutoContinue(target, runOptions) {

        const projectId = runOptions.projectId || null;

        const plan =
            inRunProject(runOptions, () => runtime.currentPlanSummary());

        const signature = planSignature(plan);

        const madeProgress =
            target.lastPlanSignature === null ||
            signature !== target.lastPlanSignature;

        target.lastPlanSignature = signature;

        const wanted =
            runtime.settings.get("AUTO_CONTINUE") === true &&
            target.status === "done" &&
            plan.exists &&
            !plan.complete &&
            !target.stopRequested &&
            target.cycles < runtime.settings.get("MAX_AUTO_CYCLES");

        if (wanted && !madeProgress) {

            runtime.events.emit("run:loop", {
                agent: "main_agent",
                scope: "main_agent",
                outcome: "stalled",
                signature,
                repeats: target.cycles,
                reason: "a cycle finished without completing a step",
                ...attribution(projectId)
            });

            runtime.events.emit("run:auto_stopped", {
                reason: "no step was completed in the last cycle",
                done: plan.done,
                steps: plan.steps,
                ...attribution(projectId)
            });

            return false;
        }

        if (!wanted) {
            return false;
        }

        target.cycles++;

        /*
        | Each cycle is a fresh conversation. The plan on disk carries the
        | state, so the transcript never has to, which is what keeps a long
        | build inside the context budget.
        */
        target.history = [];

        runtime.events.emit("run:auto_continue", {
            cycle: target.cycles,
            open_steps: plan.pending + plan.in_progress,
            next_step: plan.next_step,
            ...attribution(projectId)
        });

        return true;
    }


    /*
    | Nothing may stay pending once a turn is over — but only the approvals
    | that turn created. Sweeping every pending approval would auto-deny one
    | another project's run (or a newer run) has just surfaced.
    */
    function sweepApprovals(turnId) {

        for (const id of approvalStore.pendingKeys()) {

            const owned = approvalStore.getPending(id);

            if (owned && owned.ownerTurnId === turnId) {
                resolveApproval(id, false);
            }
        }
    }


    function continuationTask() {

        return "Continue the plan: read it, take the next open step, verify it, and record the result.";
    }


    return {
        attribution,
        continuationTask,
        inRunProject,
        projectWorkspace,
        rememberPlan,
        shouldAutoContinue,
        sweepApprovals
    };
};
