const fs = require("fs");
const path = require("path");

const hooks = require("../lib/hooks");

const {
    WORKSPACE_ROOT,
    toWorkspaceRelative
} = require("../lib/workspace");


/*
|--------------------------------------------------------------------------
| Plan and Progress
|--------------------------------------------------------------------------
|
| A large objective does not fit in one run, and a model with no memory
| of what it already finished either restarts, refuses, or stops after a
| slice. The plan is therefore state on disk, owned by the agent and
| readable by the next run:
|
|   define phases -> define the steps of a phase -> do a step
|                 -> record the evidence -> next step
|
| The file lives in the workspace, so it survives restarts and a human
| can read it, edit it, or delete it.
|--------------------------------------------------------------------------
*/

const PLAN_DIRECTORY =
    path.join(WORKSPACE_ROOT, ".agent");

const PLAN_PATH =
    path.join(PLAN_DIRECTORY, "plan.json");

const STATUSES = [
    "pending",
    "in_progress",
    "done",
    "blocked",
    "skipped"
];

const OPEN_STATUSES = [
    "pending",
    "in_progress"
];


function emptyPlan() {

    return {
        objective: null,
        created_at: null,
        updated_at: null,
        phases: []
    };
}


function loadPlan() {

    if (!fs.existsSync(PLAN_PATH)) {
        return emptyPlan();
    }

    try {

        const parsed =
            JSON.parse(
                fs.readFileSync(PLAN_PATH, "utf8")
            );

        return {
            ...emptyPlan(),
            ...parsed,

            phases:
                Array.isArray(parsed.phases)
                    ? parsed.phases.map(
                        (phase, phaseIndex) => ({
                            ...phase,
                            steps:
                                (Array.isArray(phase.steps) ? phase.steps : [])
                                    .map(
                                        (step, stepIndex) =>
                                            normaliseStep(
                                                step,
                                                stepIndex,
                                                phase.id || `phase_${phaseIndex + 1}`
                                            )
                                    )
                        })
                    )
                    : []
        };

    } catch (error) {

        throw new Error(
            `The plan file is not valid JSON: ${
                toWorkspaceRelative(PLAN_PATH)
            } (${error.message})`
        );
    }
}


function savePlan(plan) {

    fs.mkdirSync(PLAN_DIRECTORY, { recursive: true });

    plan.updated_at =
        new Date().toISOString();

    fs.writeFileSync(
        PLAN_PATH,
        `${JSON.stringify(plan, null, 2)}\n`,
        "utf8"
    );

    return plan;
}


function allSteps(plan) {

    return plan.phases.flatMap(
        phase =>
            (phase.steps || []).map(
                step => ({
                    ...step,
                    phase_id: phase.id,
                    phase_title: phase.title
                })
            )
    );
}


/*
| The next thing to do, so an agent never has to guess where it stopped.
*/

function nextActionable(plan) {

    const steps = allSteps(plan);

    return (
        steps.find(
            step => step.status === "in_progress"
        ) ||
        steps.find(
            step => step.status === "pending"
        ) ||
        null
    );
}


function summarise(plan) {

    const steps = allSteps(plan);

    const count = status =>
        steps.filter(
            step => step.status === status
        ).length;

    const phasesOpen =
        plan.phases.filter(
            phase =>
                OPEN_STATUSES.includes(phase.status) ||
                (phase.steps || []).some(
                    step => OPEN_STATUSES.includes(step.status)
                )
        ).length;

    const assignedOpenSteps =
        steps
            .filter(
                step =>
                    OPEN_STATUSES.includes(step.status) &&
                    typeof step.agent === "string" &&
                    step.agent !== ""
            )
            .map(
                step => ({
                    id: step.id,
                    title: step.title,
                    agent: step.agent,
                    status: step.status,
                    phase_id: step.phase_id
                })
            )
            .slice(0, 12);

    return {
        exists:
            plan.phases.length > 0,

        objective:
            plan.objective,

        phases:
            plan.phases.length,

        phases_open:
            phasesOpen,

        steps:
            steps.length,

        done:
            count("done"),

        in_progress:
            count("in_progress"),

        pending:
            count("pending"),

        blocked:
            count("blocked"),

        skipped:
            count("skipped"),

        complete:
            steps.length > 0 &&
            steps.every(
                step => !OPEN_STATUSES.includes(step.status)
            ),

        next_step:
            nextActionable(plan),

        assigned_open_steps:
            assignedOpenSteps,

        routine:
            hooks.routine()
    };
}


function assertStatus(status, where) {

    if (
        status !== undefined &&
        !STATUSES.includes(status)
    ) {

        throw new Error(
            `Unknown status "${status}" in ${where}. Use one of: ${
                STATUSES.join(", ")
            }`
        );
    }
}


function normalisePhase(phase, index) {

    if (
        !phase ||
        typeof phase !== "object"
    ) {

        throw new Error(
            `phases[${index}] must be an object.`
        );
    }

    if (
        typeof phase.title !== "string" ||
        phase.title.trim() === ""
    ) {

        throw new Error(
            `phases[${index}] needs a title.`
        );
    }

    assertStatus(phase.status, `phases[${index}]`);

    return {
        id:
            phase.id || `phase_${index + 1}`,

        title:
            phase.title,

        goal:
            phase.goal || null,

        status:
            phase.status || "pending",

        steps:
            (Array.isArray(phase.steps) ? phase.steps : []).map(
                (step, stepIndex) =>
                    normaliseStep(
                        step,
                        stepIndex,
                        phase.id || `phase_${index + 1}`
                    )
            )
    };
}


function normaliseAgent(value, where) {

    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${where}.agent must be a non-empty agent profile name or null.`);
    }

    return value.trim();
}


function normaliseStep(step, index, phaseId) {

    if (
        typeof step === "string"
    ) {

        return {
            id: `${phaseId}.${index + 1}`,
            title: step,
            agent: null,
            status: "pending",
            evidence: null,
            updated_at: null
        };
    }

    if (
        !step ||
        typeof step.title !== "string" ||
        step.title.trim() === ""
    ) {

        throw new Error(
            `A step of ${phaseId} needs a title.`
        );
    }

    assertStatus(step.status, `${phaseId} step ${index + 1}`);

    return {
        id:
            step.id || `${phaseId}.${index + 1}`,

        title:
            step.title,

        agent:
            normaliseAgent(step.agent, `${phaseId} step ${index + 1}`),

        status:
            step.status || "pending",

        evidence:
            step.evidence || null,

        updated_at:
            step.updated_at || null
    };
}


function assertUniqueIds(plan) {

    const seen = new Set();

    for (const phase of plan.phases) {

        if (seen.has(phase.id)) {

            throw new Error(
                `Duplicate phase id: ${phase.id}`
            );
        }

        seen.add(phase.id);

        for (const step of phase.steps) {

            if (seen.has(step.id)) {

                throw new Error(
                    `Duplicate step id: ${step.id}`
                );
            }

            seen.add(step.id);
        }
    }
}


/*
|--------------------------------------------------------------------------
| plan_get
|--------------------------------------------------------------------------
*/

async function planGet(args) {

    const plan = loadPlan();

    const summary = summarise(plan);

    if (args && args.summary_only === true) {

        return {
            path: toWorkspaceRelative(PLAN_PATH),
            summary
        };
    }

    return {
        path:
            toWorkspaceRelative(PLAN_PATH),

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

async function planSet(args) {

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

    const existing = loadPlan();

    const plan = {
        objective:
            args.objective,

        created_at:
            existing.created_at ||
            new Date().toISOString(),

        updated_at: null,

        phases:
            args.phases.map(normalisePhase)
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
                allSteps(existing).map(
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

    assertUniqueIds(plan);

    savePlan(plan);

    return {
        path:
            toWorkspaceRelative(PLAN_PATH),

        summary:
            summarise(plan)
    };
}


/*
|--------------------------------------------------------------------------
| plan_update
|--------------------------------------------------------------------------
*/

/*
| A model that has one step to record writes the update flat:
|
|   { "id": "P2.2.1", "status": "done", "evidence": "..." }
|
| rather than wrapping it in updates. The intent is unambiguous, and
| refusing it costs a whole iteration to learn a shape, so the flat form
| is accepted and normalised here. A single object instead of an array
| is accepted for the same reason.
*/

function asArray(value) {

    if (Array.isArray(value)) {
        return value;
    }

    return value && typeof value === "object"
        ? [value]
        : [];
}


function normaliseUpdateArguments(args) {

    const updates =
        asArray(args.updates);

    const additions =
        asArray(args.add_steps);

    if (
        updates.length === 0 &&
        typeof args.id === "string" &&
        (
            args.status !== undefined ||
            args.evidence !== undefined ||
            args.title !== undefined ||
            args.agent !== undefined
        )
    ) {

        updates.push({
            id: args.id,
            status: args.status,
            evidence: args.evidence,
            title: args.title,
            agent: args.agent
        });
    }

    if (
        additions.length === 0 &&
        typeof args.phase_id === "string" &&
        args.steps !== undefined
    ) {

        additions.push({
            phase_id: args.phase_id,
            steps: asArray(args.steps)
        });
    }

    return { updates, additions };
}


async function planUpdate(args) {

    const plan = loadPlan();

    if (plan.phases.length === 0) {

        throw new Error(
            "There is no plan yet. Create one with plan_set."
        );
    }

    const { updates, additions } =
        normaliseUpdateArguments(args);

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

        assertStatus(update.status, `update of ${update.id}`);

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
                normaliseAgent(update.agent, `update of ${update.id}`);
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
                normaliseStep(
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
                step => OPEN_STATUSES.includes(step.status)
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

    assertUniqueIds(plan);

    savePlan(plan);

    return {
        path:
            toWorkspaceRelative(PLAN_PATH),

        updated:
            applied,

        summary:
            summarise(plan)
    };
}


module.exports = {
    plan_get: planGet,
    plan_set: planSet,
    plan_update: planUpdate,

    _loadPlan: loadPlan,
    _normaliseUpdateArguments: normaliseUpdateArguments,
    _summarise: summarise,
    _planPath: PLAN_PATH
};
