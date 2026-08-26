"use strict";

const { DiscussionService } = require("../discussion/DiscussionService");
const { resolveDiscussionContext } = require("../discussion/DiscussionContext");

/**
 * discussion_start tool
 * ---------------------
 * The main agent can open a multi-agent discussion when the user asks
 * for a multi-perspective analysis. The engine runs the rounds itself,
 * outside the delegation tree: personas are peers that see each other
 * from round 2 on, and the observer decides when the group may stop.
 *
 * The model calls go through the runtime's callAI, so the same
 * role-based endpoints (L1/L2/MAIN) that serve the delegation tree
 * serve the discussion. Nothing here touches the workspace: personas
 * reason, they do not act, which is why the tool needs no approval.
 */

let engineModule = null;

function getEngine() {

    if (!engineModule) {
        engineModule = require("../discussion");
    }

    return engineModule;
}

function agentRuntime() {

    try {
        return require("../agent");
    } catch {
        return null;
    }
}

/**
 * Build the model caller for one discussion.
 *
 * The mock is only available on explicit opt-in (the hidden mock
 * argument), because a silent fallback would make the tool report
 * canned opinions as if the specialists had spoken.
 */
function createCaller(task, { mock = false, runtime = agentRuntime() } = {}) {

    const { createLlmCaller } = getEngine();

    /*
    | An explicit mock wins over the real endpoint: it is how tests
    | drive the tool hermetically, and it must not be shadowed by a
    | runtime that happens to be loadable.
    */

    if (mock) {
        return mockCaller(task);
    }

    if (typeof runtime?.callAI === "function") {
        return createLlmCaller({ callAI: runtime.callAI });
    }

    if (typeof runtime?.endpointFor === "function") {
        return createLlmCaller({ endpointFor: runtime.endpointFor });
    }

    throw new Error(
        "discussion_start needs an OpenAI-compatible endpoint (AGENT_BASE_URL / AGENT_API_KEY)"
    );
}

function mockCaller(task) {

    return async (messages, personaDef) => {

        if (personaDef.id === "observer") {
            /* the user message carries the transcript, "=== Round N ===" */
            const user = messages[1]?.content || "";
            const rounds = (user.match(/=== Round/g) || []).length;
            return {
                content: JSON.stringify(
                    rounds >= 2
                        ? {
                            decision: "FINISH",
                            agreements: ["(mock) all positions recorded"],
                            open_points: [],
                            unaddressed: [],
                            instructions: {},
                            final_report: {
                                summary:
                                    `(mock) No real model is configured, so this report is a placeholder for "${task.slice(0, 120)}". Configure AGENT_BASE_URL/AGENT_API_KEY for a real discussion.`,
                                agreed_points: [],
                                unresolved: [],
                                next_steps: [
                                    {
                                        order: 1,
                                        layer: "user",
                                        action: "Configure an endpoint and re-run the discussion"
                                    }
                                ]
                            }
                        }
                        : {
                            decision: "CONTINUE",
                            agreements: [],
                            open_points: [],
                            unaddressed: [],
                            instructions: {},
                            final_report: null
                        }
                )
            };
        }

        return {
            content:
                `[MOCK ${personaDef.id}] ${personaDef.name} assessment of "${task.slice(0, 120)}" — placeholder because no model endpoint is configured.`
        };
    };
}

/*
| Tools receive a single object: their declared arguments plus _agent,
| the name of the caller, which no schema uses. The mock flag rides in
| the same object for test use; the model never sees it because the
| schema has additionalProperties: false.
*/

async function discussion_start(args) {

    const task = args.task;
    const personas = args.personas;
    const max_rounds =
        Number.isInteger(args.max_rounds)
            ? args.max_rounds
            : 5;

    if (!task || typeof task !== "string" || task.trim() === "") {
        throw new Error("task is required and must be non-empty string");
    }

    if (!Array.isArray(personas) || personas.length === 0) {
        throw new Error("personas must be non-empty array of persona ids");
    }

    const { PERSONAS } = getEngine();
    const available = PERSONAS.map(persona => persona.id);

    for (const persona of personas) {
        if (!available.includes(persona)) {
            throw new Error(
                `Unknown persona "${persona}". Available: ${available.join(", ")}`
            );
        }
    }

    if (max_rounds < 1 || max_rounds > 10) {
        throw new Error("max_rounds must be between 1 and 10");
    }

    const runtime = agentRuntime();
    const context = resolveDiscussionContext(runtime);
    const caller = createCaller(task, {
        mock: args.mock === true,
        runtime
    });

    const result = await new DiscussionService({ runtime }).run({
        task: task.trim(),
        personas,
        maxRounds: max_rounds,
        projectId: context.projectId,
        projectContext: context.project,
        llmCaller: caller,
        persist: true
    });

    return {
        ok: true,
        id: result.id,
        project_id: result.project_id || null,
        transcript_id: result.transcript_id || result.id,
        task: task.trim(),
        personas,
        total_rounds: result.total_rounds,
        hit_max_rounds: result.hit_max_rounds,
        stopped_reason: result.stopped_reason || null,
        final_report: result.final_report,
        rounds: result.rounds.map(round => ({
            round: round.round,
            messages: round.messages.map(message => ({
                persona: message.persona,
                persona_name: message.persona_name,
                content: String(message.content || "").slice(0, 2000)
            }))
        })),
        observer_decisions: result.observer_decisions.map(decision => ({
            decision: decision.decision,
            agreements: decision.agreements,
            open_points: decision.open_points,
            unaddressed: decision.unaddressed,
            instructions: decision.instructions
        }))
    };
}

module.exports = {
    discussion_start,

    /*
    | For registry: the declaration the runtime validates against
    | registry/tools.json at startup.
    */
    tools: {
        discussion_start: {
            description:
                "Start a multi-agent discussion with selected specialist personas. Each persona reasons from different priorities (security vs speed, etc.). Observer decides when to finish and produces final synthesis.",
            parameters: {
                type: "object",
                properties: {
                    task: {
                        type: "string",
                        description:
                            "The task description to discuss, e.g. 'Design user session storage for Next.js app with JWT'"
                    },
                    personas: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "List of persona ids to include. Available: security, backend, database, frontend, architect, performance, qa, devops, cost, accessibility, data, compliance, mobile, ml, legacy"
                    },
                    max_rounds: {
                        type: "integer",
                        description:
                            "Maximum discussion rounds (1-10), default 5",
                        minimum: 1,
                        maximum: 10
                    }
                },
                required: ["task", "personas"],
                additionalProperties: false
            },
            execute: discussion_start
        }
    }
};
