"use strict";

const { DiscussionEngine } = require("./engine");
const { PERSONAS } = require("./personas");
const { transcriptRepository } = require("./TranscriptRepository");
const {
    resolveDiscussionContext,
    withProjectId
} = require("./DiscussionContext");


/*
|--------------------------------------------------------------------------
| Discussion service — EXECUTION_PLAN Phase 28
|--------------------------------------------------------------------------
|
| This is the application boundary for a discussion. The engine remains a
| deterministic round orchestrator; this service supplies trusted project
| context, the runtime LLM caller, event attribution and durable transcript
| callbacks. It has no dependency on agent.js, so CLI, Web and tools may
| inject their own runtime facade.
|--------------------------------------------------------------------------
*/

function discussionId() {
    return `discussion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


function availablePersonas() {
    return PERSONAS.map(persona => persona.id);
}


function validateRequest({ task, personas, maxRounds }) {

    if (typeof task !== "string" || task.trim() === "") {
        throw Object.assign(new Error("task is required"), { status: 400 });
    }

    if (!Array.isArray(personas) || personas.length === 0) {
        throw Object.assign(
            new Error("personas is required: a non-empty array of persona ids"),
            { status: 400 }
        );
    }

    const unknown = personas.filter(id => !availablePersonas().includes(id));

    if (unknown.length > 0) {
        throw Object.assign(
            new Error(
                `unknown persona: ${unknown[0]}; available: ${availablePersonas().join(", ")}`
            ),
            { status: 400 }
        );
    }

    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) {
        throw Object.assign(
            new Error("max_rounds must be between 1 and 10"),
            { status: 400 }
        );
    }
}


class DiscussionService {

    constructor({
        runtime,
        repository = transcriptRepository,
        engineClass = DiscussionEngine,
        now = () => Date.now()
    } = {}) {
        this.runtime = runtime;
        this.repository = repository;
        this.engineClass = engineClass;
        this.now = now;
    }


    contextFor(options = {}) {
        return resolveDiscussionContext(this.runtime, options);
    }


    createSession(options = {}) {

        const maxRounds =
            Number.isInteger(options.maxRounds)
                ? options.maxRounds
                : 5;

        validateRequest({
            task: options.task,
            personas: options.personas,
            maxRounds
        });

        const context =
            this.contextFor({
                projectContext: options.projectContext,
                projectId: options.projectId
            });

        const id = options.id || discussionId();
        const startedAt = this.now();

        return {
            id,
            context,
            record: {
                id,
                project_id: context.projectId,
                status: "running",
                task: options.task.trim(),
                personas: [...options.personas],
                max_rounds: maxRounds,
                started_at: startedAt,
                finished_at: null,
                rounds: [],
                observer_decisions: [],
                final_report: null,
                total_rounds: 0,
                hit_max_rounds: false,
                stopped_reason: null,
                error: null
            }
        };
    }


    emit(context, type, payload) {

        if (this.runtime?.events?.emit) {
            this.runtime.events.emit(
                type,
                withProjectId(payload, context.projectId)
            );
        }
    }


    async execute(session, options = {}) {

        const { record, context } = session;
        const caller = options.llmCaller;

        if (typeof caller !== "function") {
            throw new Error("discussion service requires an injected llmCaller");
        }

        this.emit(context, "discussion:start", {
            id: record.id,
            task: record.task,
            personas: record.personas,
            max_rounds: record.max_rounds
        });

        const engine = new this.engineClass({
            task: record.task,
            personas: record.personas,
            maxRounds: record.max_rounds,
            maxParallel:
                options.maxParallel ||
                this.runtime?.settings?.get?.("MAX_PARALLEL_AGENTS") ||
                4,
            llmCaller: caller,
            workspaceContext:
                options.workspaceContext || context.workspaceContext,
            projectId: context.projectId,
            projectContext: context.project,
            dataRoot: context.dataRoot,
            discussionId: record.id,
            transcriptRepository: this.repository,
            persistTranscript: options.persist !== false,
            onMessage: message => {
                const event = {
                    id: record.id,
                    round: message.round,
                    persona: message.persona,
                    persona_name: message.persona_name,
                    content: String(message.content || "").slice(0, 8000),
                    tools_used: message.tools_used || []
                };
                this.emit(context, "discussion:message", event);
                options.onMessage?.(message, record);
            },
            onRound: round => {
                record.rounds.push({
                    round: round.round,
                    messages: round.messages.map(message => ({
                        persona: message.persona,
                        persona_name: message.persona_name,
                        content: String(message.content || "").slice(0, 8000)
                    }))
                });
                this.emit(context, "discussion:round", {
                    id: record.id,
                    round: round.round,
                    messages: round.messages.length
                });
                options.onRound?.(round, record);
            },
            onObserver: (decision, round) => {
                const item = {
                    round,
                    decision: decision.decision,
                    agreements: decision.agreements || [],
                    open_points: decision.open_points || [],
                    unaddressed: decision.unaddressed || [],
                    instructions: decision.instructions || {}
                };
                record.observer_decisions.push(item);
                this.emit(context, "discussion:observer", {
                    id: record.id,
                    ...item
                });
                options.onObserver?.(decision, round, record);
            }
        });

        try {
            const result = await engine.run();

            record.status = "done";
            record.final_report = result.final_report;
            record.total_rounds = result.total_rounds;
            record.hit_max_rounds = result.hit_max_rounds;
            record.stopped_reason = result.stopped_reason || null;
            record.finished_at = this.now();

            this.emit(context, "discussion:finish", {
                id: record.id,
                total_rounds: result.total_rounds,
                hit_max_rounds: result.hit_max_rounds,
                stopped_reason: result.stopped_reason || null,
                final_report: result.final_report
            });

            options.onFinish?.(result, record);

            return {
                ok: true,
                id: record.id,
                project_id: context.projectId,
                transcript_id: record.id,
                ...result
            };
        } catch (error) {
            record.status = "failed";
            record.error = error.message;
            record.finished_at = this.now();
            this.emit(context, "discussion:error", {
                id: record.id,
                error: error.message
            });
            options.onError?.(error, record);
            throw error;
        }
    }


    start(options = {}) {
        const session = this.createSession(options);
        const promise = options.defer
            ? Promise.resolve().then(() => this.execute(session, options))
            : this.execute(session, options);
        return {
            id: session.id,
            projectId: session.context.projectId,
            record: session.record,
            context: session.context,
            promise
        };
    }


    async run(options = {}) {
        return (await this.start(options).promise);
    }


    list(options = {}) {
        const context = this.contextFor(options);
        return this.repository.list(context.dataRoot)
            .filter(item =>
                !context.projectId || item.project_id === context.projectId
            );
    }


    load(id, options = {}) {
        const context = this.contextFor(options);
        const document = this.repository.load(id, context.dataRoot);

        if (
            document &&
            context.projectId &&
            document.project_id &&
            document.project_id !== context.projectId
        ) {
            return null;
        }

        return document;
    }
}


module.exports = {
    DiscussionService,
    validateRequest,
    availablePersonas,
    discussionId
};
