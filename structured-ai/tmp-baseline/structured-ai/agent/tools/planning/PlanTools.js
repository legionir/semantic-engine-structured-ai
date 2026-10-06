"use strict";

const ToolContext = require("../ToolContext");

const PlanModel = require("./PlanModel");
const PlanRepository = require("./PlanRepository");


/*
|--------------------------------------------------------------------------
| plan_get
|--------------------------------------------------------------------------
*/

async function planGet(args, context) {

    const ctx = ToolContext.from(context);

    const plan = PlanRepository.loadPlan(ctx);

    const summary = PlanModel.summarise(plan);

    if (args && args.summary_only === true) {

        return {
            path: PlanRepository.displayPath(PlanRepository.planPath(ctx)),
            summary
        };
    }

    return {
        path:
            PlanRepository.displayPath(PlanRepository.planPath(ctx)),

        objective:
            plan.objective,

        created_at:
            plan.created_at,

        updated_at:
            plan.updated_at,

        summary,

        phases:
            plan.phases
    };
}


/*
|--------------------------------------------------------------------------
| plan_set
|--------------------------------------------------------------------------
*/

async function planSet(args, context) {

    const ctx = ToolContext.from(context);

    if (
        typeof args.objective !== "string" ||
        args.objective.trim() === ""
    ) {

        throw new Error(
            "objective is required."
        );
    }

    if (
        !Array.isArray(args.phases) ||
        args.phases.length === 0
    ) {

        throw new Error(
            "phases must contain at least one phase."
        );
    }

    const existing = PlanRepository.loadPlan(ctx);

    const plan = {
        objective:
            args.objective,

        created_at:
            existing.created_at ||
            new Date().toISOString(),

        updated_at: null,

        phases:
            args.phases.map(PlanModel.normalisePhase)
    };

    /*
    | Replacing a plan must not silently erase what is already done.
    */

    if (
        args.preserve_progress !== false &&
        existing.phases.length > 0
    ) {

        const previous =
            new Map(
                PlanModel.allSteps(existing).map(
                    step => [step.id, step]
                )
            );

        for (const phase of plan.phases) {

            for (const step of phase.steps) {

                const before =
                    previous.get(step.id);

                if (
                    before &&
                    before.status !== "pending"
                ) {

                    step.status = before.status;
                    step.evidence = before.evidence;
                    step.updated_at = before.updated_at;
                }
            }
        }
    }

    PlanModel.assertUniqueIds(plan);

    PlanRepository.savePlan(plan, ctx);

    return {
        path:
            PlanRepository.displayPath(PlanRepository.planPath(ctx)),

        summary:
            PlanModel.summarise(plan)
    };
}


/*
|--------------------------------------------------------------------------
| plan_update
|--------------------------------------------------------------------------
*/

async function planUpdate(args, context) {

    const ctx = ToolContext.from(context);

    const plan = PlanRepository.loadPlan(ctx);

    if (plan.phases.length === 0) {

        throw new Error(
            "There is no plan yet. Create one with plan_set."
        );
    }

    const { updates, additions } =
        PlanModel.normaliseUpdateArguments(args);

    if (
        updates.length === 0 &&
        additions.length === 0
    ) {

        throw new Error(
            "Provide updates, add_steps, or both. One update may also be written flat, as { \"id\": \"P1.1\", \"status\": \"done\", \"evidence\": \"...\" }."
        );
    }

    const applied = [];

    for (const update of updates) {

        PlanModel.assertStatus(update.status, `update of ${update.id}`);

        let target = null;

        for (const phase of plan.phases) {

            if (phase.id === update.id) {

                target = phase;

                break;
            }

            const step =
                phase.steps.find(
                    item => item.id === update.id
                );

            if (step) {

                target = step;

                break;
            }
        }

        if (!target) {

            throw new Error(
                `Unknown plan id: ${update.id}`
            );
        }

        if (
            update.status === "done" &&
            !update.evidence &&
            !target.evidence
        ) {

            /*
            | A step is only done when something proves it.
            */

            throw new Error(
                `Step "${update.id}" cannot be marked done without evidence. Pass the command output, the test result, or the files that changed.`
            );
        }

        if (update.status) {
            target.status = update.status;
        }

        if (update.evidence) {
            target.evidence = update.evidence;
        }

        if (update.title) {
            target.title = update.title;
        }

        if (update.agent !== undefined) {

            if (Array.isArray(target.steps)) {
                throw new Error(`Only plan steps may have an agent assignment: ${update.id}`);
            }

            target.agent =
                PlanModel.normaliseAgent(update.agent, `update of ${update.id}`);
        }

        target.updated_at =
            new Date().toISOString();

        applied.push(target.id);
    }

    for (const addition of additions) {

        const phase =
            plan.phases.find(
                item => item.id === addition.phase_id
            );

        if (!phase) {

            throw new Error(
                `Unknown phase id: ${addition.phase_id}`
            );
        }

        const steps =
            Array.isArray(addition.steps)
                ? addition.steps
                : [];

        for (const step of steps) {

            phase.steps.push(
                PlanModel.normaliseStep(
                    step,
                    phase.steps.length,
                    phase.id
                )
            );

            applied.push(
                phase.steps[phase.steps.length - 1].id
            );
        }
    }

    /*
    | A phase follows its steps, so the agent does not have to keep the
    | two in sync by hand.
    */

    for (const phase of plan.phases) {

        if (phase.steps.length === 0) {
            continue;
        }

        const open =
            phase.steps.filter(
                step => PlanModel.OPEN_STATUSES.includes(step.status)
            ).length;

        const started =
            phase.steps.some(
                step => step.status !== "pending"
            );

        phase.status =
            open === 0
                ? "done"
                : started
                    ? "in_progress"
                    : "pending";
    }

    PlanModel.assertUniqueIds(plan);

    PlanRepository.savePlan(plan, ctx);

    return {
        path:
            PlanRepository.displayPath(PlanRepository.planPath(ctx)),

        updated:
            applied,

        summary:
            PlanModel.summarise(plan)
    };
}


module.exports = {
    plan_get: planGet,
    plan_set: planSet,
    plan_update: planUpdate
};
