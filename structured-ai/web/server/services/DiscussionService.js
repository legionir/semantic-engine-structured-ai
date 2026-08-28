"use strict";

/*
|--------------------------------------------------------------------------
| Web console discussion run (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| A discussion is its own run: it does not go through the delegation
| tree, so it keeps a separate status in state while the conversation
| still records what was asked and what the observer concluded. Rounds
| stream to the browser through the same event bus the delegation tree
| uses, which is what makes the live panel possible.
|
| The panel shares the runtime's parallel-agent budget rather than
| keeping one of its own, and each persona message is clipped to 8000
| characters on the way out — the same reason the event stream previews
| tool results.
|
| Unknown personas are refused here with status 400 *and* validated by
| the route before it starts the run. Both checks stayed: the route's is
| what a caller sees, this one is what keeps the service honest if a
| second caller appears. The module handle is exported for the personas
| route so there is one require of agent/discussion, not two caches.
|--------------------------------------------------------------------------
*/

const path = require("path");

/*
| A discussion is its own run: it does not go through the
| delegation tree, so it keeps a separate status in state while
| the conversation still records what was asked and what the
| observer concluded. Rounds stream to the browser through the
| same event bus the delegation tree uses, which is what makes
| the live panel possible.
*/

const DISCUSSION_MODULE =
    require(
        path.join(
            path.resolve(__dirname, "..", "..", ".."),
            "agent",
            "discussion"
        )
    );

function createDiscussionService(ctx) {

    const { runtime, state } = ctx;

    async function startDiscussion({ task, personas, maxRounds }) {

        const {
            DiscussionEngine,
            createLlmCaller,
            PERSONAS
        } = DISCUSSION_MODULE;

        const available = PERSONAS.map(persona => persona.id);

        const unknown = personas.filter(id => !available.includes(id));

        if (unknown.length > 0) {
            throw Object.assign(
                new Error(
                    `unknown persona: ${unknown[0]}; available: ${available.join(", ")}`
                ),
                { status: 400 }
            );
        }

        const caller =
            typeof runtime.callAI === "function"
                ? createLlmCaller({ callAI: runtime.callAI })
                : createLlmCaller({ endpointFor: runtime.endpointFor });

        const discussion = {
            id:
                `discussion-${Date.now().toString(36)}`,
            status: "running",
            task,
            personas,
            max_rounds: maxRounds,
            started_at: Date.now(),
            finished_at: null,
            rounds: [],
            observer_decisions: [],
            final_report: null,
            total_rounds: 0,
            hit_max_rounds: false,
            stopped_reason: null,
            error: null
        };

        state.discussion = discussion;

        ctx.addMessage({
            role: "user",
            kind: "discussion-request",
            content: task,
            personas
        });

        runtime.events.emit("discussion:start", {
            id: discussion.id,
            task,
            personas,
            max_rounds: maxRounds
        });

        const engine =
            new DiscussionEngine({
                task,
                personas,
                maxRounds,
                /* the panel shares the runtime's parallel-agent budget */
                maxParallel: runtime.settings.get("MAX_PARALLEL_AGENTS"),
                llmCaller: caller,
                workspaceContext:
                    `Workspace root: ${runtime.createRuntimeContext().runtime.workspace_root}`,
                onMessage: message => {

                    runtime.events.emit("discussion:message", {
                        id: discussion.id,
                        round: message.round,
                        persona: message.persona,
                        persona_name: message.persona_name,
                        content: message.content.slice(0, 8000)
                    });
                },
                onRound: round => {

                    discussion.rounds.push({
                        round: round.round,
                        messages: round.messages.map(message => ({
                            persona: message.persona,
                            persona_name: message.persona_name,
                            content: message.content.slice(0, 8000)
                        }))
                    });

                    runtime.events.emit("discussion:round", {
                        id: discussion.id,
                        round: round.round,
                        messages: round.messages.length
                    });
                },
                onObserver: (observerDecision, round) => {

                    discussion.observer_decisions.push({
                        round,
                        decision: observerDecision.decision,
                        agreements: observerDecision.agreements || [],
                        open_points: observerDecision.open_points || [],
                        unaddressed: observerDecision.unaddressed || [],
                        instructions: observerDecision.instructions || {}
                    });

                    runtime.events.emit("discussion:observer", {
                        id: discussion.id,
                        round,
                        decision: observerDecision.decision,
                        agreements: observerDecision.agreements || [],
                        open_points: observerDecision.open_points || [],
                        unaddressed: observerDecision.unaddressed || [],
                        instructions: observerDecision.instructions || {}
                    });
                }
            });

        try {

            const result =
                await engine.run();

            discussion.status = "done";
            discussion.final_report = result.final_report;
            discussion.total_rounds = result.total_rounds;
            discussion.hit_max_rounds = result.hit_max_rounds;
            discussion.stopped_reason = result.stopped_reason || null;
            discussion.finished_at = Date.now();

            try {
                if (typeof DISCUSSION_MODULE.saveDiscussion === "function") {
                    DISCUSSION_MODULE.saveDiscussion(
                        discussion,
                        typeof runtime.currentProject === "function" ? runtime.currentProject() : undefined
                    );
                }
            } catch {
                /* non-fatal */
            }

            runtime.events.emit("discussion:finish", {
                id: discussion.id,
                total_rounds: result.total_rounds,
                hit_max_rounds: result.hit_max_rounds,
                stopped_reason: result.stopped_reason || null,
                final_report: result.final_report
            });

            if (result.final_report?.summary) {
                ctx.addMessage({
                    role: "assistant",
                    kind: "discussion-report",
                    content: result.final_report.summary
                });
            }

        } catch (error) {

            discussion.status = "failed";
            discussion.error = error.message;
            discussion.finished_at = Date.now();

            runtime.events.emit("discussion:error", {
                id: discussion.id,
                error: error.message
            });

            ctx.addMessage({
                role: "assistant",
                kind: "error",
                content: `discussion failed: ${error.message}`
            });
        }
    }

    return {
        startDiscussion
    };
}

module.exports = {
    createDiscussionService,
    DISCUSSION_MODULE
};
