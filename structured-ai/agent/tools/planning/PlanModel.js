"use strict";

const hooks = require("../../lib/hooks");


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


module.exports = {
    STATUSES,
    OPEN_STATUSES,
    emptyPlan,
    allSteps,
    nextActionable,
    summarise,
    assertStatus,
    normalisePhase,
    normaliseAgent,
    normaliseStep,
    assertUniqueIds,
    asArray,
    normaliseUpdateArguments
};
