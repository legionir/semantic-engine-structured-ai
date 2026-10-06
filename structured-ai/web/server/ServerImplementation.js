"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");


/*
|--------------------------------------------------------------------------
| Web Console
|--------------------------------------------------------------------------
|
| A thin layer over the same runtime the CLI uses. It streams runtime
| events to the browser and turns approval requests into buttons, which
| is exactly the seam setApprovalHandler was designed for.
|
|   runtime events ──► /api/events (SSE) ──► live delegation tree
|   Approve / Deny ──► /api/approvals/:id ──► setApprovalHandler
|--------------------------------------------------------------------------
*/

const WEB_ROOT =
    path.resolve(__dirname, "..");

const PUBLIC_DIR =
    path.join(WEB_ROOT, "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

const {
    CONSOLE_COOKIE,
    newConsoleToken,
    requestToken,
    sameOrigin,
    RateLimiter
} = require("./Middleware");
const { readBody } = require("./RequestBody");
const {
    sendJson,
    setConsoleCookie
} = require("./Response");
const { SseHub } = require("./SseHub");

const consoleAuth = require("../../agent/config/ConsoleAuth");
const { ApprovalStore } = require("../../agent/policy");
const { DiscussionService } = require("../../agent/discussion/DiscussionService");


function createServer(runtime, options = {}) {

    /*
    | The console is a control plane, not a public static site. A token is
    | generated even when the caller did not configure one, so forgetting
    | AGENT_CONSOLE_TOKEN can never silently disable authentication.
    */
    const configuredToken =
        runtime.settings &&
        typeof runtime.settings.get === "function"
            ? runtime.settings.get("AGENT_CONSOLE_TOKEN")
            : "";

    const consoleToken =
        String(options.token || configuredToken || newConsoleToken());

    const toolRuntime =
        require(
            path.join(
                path.resolve(__dirname, "..", ".."),
                "agent",
                "tools"
            )
        );

    const state = {
        status: "idle",

        cycles: 0,

        lastPlanSignature: null,

        stopRequested: false,

        task: null,

        history: [],

        events: [],

        turnCounter: 0,

        currentTurnId: null,

        approvals: new Map(),

        answer: null,

        error: null,

        startedAt: null,

        finishedAt: null,

        discussion: null,

        projectId: null
    };

    /* ApprovalStore owns pending approval lifecycle; state.approvals remains
       the historical Map exposed by the test/launcher state surface. */
    const approvalStore =
        new ApprovalStore({ pending: state.approvals });

    const clients = new Set();
    const sseHub = new SseHub({ clients });
    const apiRateLimiter =
        new RateLimiter({ limit: 120, windowMs: 60_000 });

    function allowApiRequest(req) {
        return apiRateLimiter.allow(req);
    }

    /*
    | The conversation is a file, not a browser tab. Everything the
    | console draws, the messages, the events exactly as they were
    | streamed, and the full record of every call, is written to
    | .agent/sessions so the same three cards can be redrawn later.
    */

    const sessions = runtime.sessions;

    state.session =
        sessions.emptySession();


    function sessionsEnabled() {

        return runtime.settings.get("SESSIONS_ENABLED") === true;
    }


    function saveSession() {

        if (!sessionsEnabled()) {
            return state.session;
        }

        state.session.status = state.status;

        state.session.history = state.history;

        state.session.calls = [...calls.values()];

        try {

            return sessions.saveSession(state.session);

        } catch {

            /* a workspace that cannot be written is not fatal */
            return state.session;
        }
    }


    function addMessage(entry) {

        const message = {
            at: Date.now(),
            ...entry
        };

        state.session.messages.push(message);

        runtime.events.emit("session:message", {
            session: state.session.id,
            message
        });

        saveSession();

        return message;
    }


    /*
    | One model response can have a reasoning entry, a raw provider response,
    | and a group of tool events. They all use the same key so the browser
    | can render the tools beside the exact AI message that caused them,
    | rather than attaching every tool from a turn to one large accordion.
    */
    function executionMessageKey(event) {

        if (event.message_id || event.ai_message_id) {
            return event.message_id || event.ai_message_id;
        }

        return [
            event.turn_id || event.run_id || "run",
            event.scope || event.agent || "main_agent",
            event.iteration ?? "unknown"
        ].join("|");
    }


    /*
    | After each turn (user message → run) a short git report is captured and
    | recorded both in the event stream and in the conversation, so the user
    | can see what the run changed at a glance. The report counts modified,
    | new and deleted files from `git status --short`; a clean tree yields
    | "0 file changed, 0 new file, 0 file removed".
    */

    function gitReport(workspace) {

        return new Promise(resolve => {

            execFile(
                "git",
                ["status", "--short", "--branch"],
                {
                    cwd: workspace,
                    timeout: 8000,
                    maxBuffer: 4 * 1024 * 1024,
                    windowsHide: true
                },
                (error, stdout) => {

                    if (error) {

                        resolve({
                            ok: false,
                            branch: null,
                            changed: 0,
                            new_files: 0,
                            deleted: 0,
                            text: "not a git repository",
                            raw: null
                        });

                        return;
                    }

                    const lines =
                        stdout
                            .split("\n")
                            .map(line => line.trim())
                            .filter(Boolean);

                    const branchLine =
                        lines.find(line => line.startsWith("## ")) || "";

                    const branch =
                        branchLine
                            .replace(/^##\s+/, "")
                            .split("...")[0]
                            .trim() || null;

                    let changed = 0;
                    let new_files = 0;
                    let deleted = 0;

                    for (const line of lines) {

                        if (line.startsWith("##")) {
                            continue;
                        }

                        const code =
                            line.charAt(0) + (line.charAt(1) || " ");

                        if (/^\?\?/.test(code)) {
                            new_files++;
                        } else if (/^D/.test(code)) {
                            deleted++;
                        } else {
                            changed++;
                        }
                    }

                    const text =
                        `${changed} file${changed === 1 ? "" : "s"} changed, ` +
                        `${new_files} new file${new_files === 1 ? "" : "s"}, ` +
                        `${deleted} file${deleted === 1 ? "" : "s"} removed`;

                    resolve({
                        ok: true,
                        branch,
                        changed,
                        new_files,
                        deleted,
                        text,
                        raw: lines.filter(l => !l.startsWith("##"))
                    });
                }
            );
        });
    }


    async function recordGitReport() {

        const workspace =
            runtime.createRuntimeContext()
                .workspace_root;

        const report = await gitReport(workspace);

        /* Emit on the bus so the event store, the live console and any
           listener all receive it, then surface it in the conversation. */
        runtime.events.emit("git:report", {
            branch: report.branch,
            changed: report.changed,
            new_files: report.new_files,
            deleted: report.deleted,
            text: report.text,
            ok: report.ok,
            turn_id: state.currentTurnId || null
        });

        addMessage({
            role: "system",
            kind: "git-report",
            content: report.text,
            branch: report.branch
        });

        return report;
    }


    function activateSession(id) {

        const loaded =
            sessions.loadSession(id);

        if (!loaded) {
            return null;
        }

        state.session = loaded;

        state.history =
            Array.isArray(loaded.history)
                ? loaded.history
                : [];

        state.events = [...loaded.events];

        /* A session's events are capped, so the event store is the source
           of truth: backfill anything the session dropped so a reopened
           conversation replays the complete run, not just the tail. */
        if (
            runtime.eventstore &&
            typeof runtime.eventstore.query === "function"
        ) {

            const run_ids =
                new Set(
                    loaded.events
                        .filter(event => event.run_id)
                        .map(event => event.run_id)
                );

            const stored =
                runtime.eventstore.query();

            const have =
                new Set(
                    state.events.map(event => `${event.run_id || ""}|${event.seq}`)
                );

            for (const event of stored) {

                if (
                    run_ids.size === 0 ||
                    (event.run_id && run_ids.has(event.run_id))
                ) {

                    const key = `${event.run_id || ""}|${event.seq}`;

                    if (!have.has(key)) {

                        state.events.push(event);
                        have.add(key);
                    }
                }
            }

            state.events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        }

        state.answer = null;
        state.error = null;
        state.status = "idle";
        state.cycles = 0;
        state.lastPlanSignature = null;

        calls.clear();

        for (const call of loaded.calls) {
            calls.set(call.key, call);
        }

        runtime.events.emit("session:switched", {
            session: sessions.summarise(loaded)
        });

        return loaded;
    }

    /*
    | A tool result can be tens of thousands of characters, and the
    | console needs all of it only when an operator opens one call. The
    | full record therefore stays here, keyed by agent, graph and call
    | id, while the stream carries a preview.
    */

    const calls = new Map();


    function callKey(event) {

        return [
            event.agent || "main_agent",
            event.graph_id || "graph",
            event.id
        ].join("|");
    }


    function preview(value) {

        if (value === undefined || value === null) {
            return { text: null, chars: 0, truncated: false };
        }

        const text =
            typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2) ?? "";

        const limit =
            runtime.settings.get("CONSOLE_RESULT_CHARS");

        return {
            text:
                text.length > limit
                    ? `${text.slice(0, limit)}…`
                    : text,

            chars:
                text.length,

            truncated:
                text.length > limit
        };
    }


    function recordCall(event) {

        const key = callKey(event);

        const existing =
            calls.get(key) || {
                key,
                agent: event.agent || "main_agent",
                id: event.id,
                graph_id: event.graph_id || null,
                shape: event.shape || null,
                wave: event.wave ?? null,
                depends_on: event.depends_on || [],
                iteration: event.iteration ?? null
            };

        if (event.type === "tool:start") {

            existing.name = event.name;
            existing.arguments = event.arguments;
            existing.started_at = event.at || Date.now();
            existing.status = "running";

        } else {

            existing.name = event.name || existing.name;

            if (event.arguments !== undefined) {
                existing.arguments = event.arguments;
            }

            existing.wave = event.wave ?? existing.wave;
            existing.iteration = event.iteration ?? existing.iteration;

            /* the executor knows when it actually started; the envelope only
               says when the event was written, which is later for a call that
               waited in the queue. `wave` stays the planned grouping. */
            existing.started_at =
                event.started_at ?? existing.started_at;

            existing.finished_at = event.at || Date.now();
            existing.duration_ms = event.duration_ms;
            existing.success = event.success;
            existing.result = event.result ?? null;
            existing.error = event.error ?? null;

            existing.status =
                event.success
                    ? "done"
                    : "failed";
        }

        calls.set(key, existing);

        while (
            calls.size >
            runtime.settings.get("CONSOLE_CALL_HISTORY")
        ) {

            calls.delete(calls.keys().next().value);
        }

        return key;
    }


    /*
    | What reaches the browser is the same event with the heavy fields
    | replaced by a preview and a key to fetch the rest.
    */

    function forStream(event) {

        if (
            event.type !== "tool:start" &&
            event.type !== "tool:end"
        ) {
            return event;
        }

        const key = recordCall(event);

        const streamed = {
            ...event,
            call_key: key
        };

        if (streamed.arguments !== undefined) {

            const shown = preview(streamed.arguments);

            streamed.arguments_preview = shown.text;
            streamed.arguments_chars = shown.chars;
            streamed.arguments_truncated = shown.truncated;

            delete streamed.arguments;
        }

        if (streamed.result !== undefined) {

            const shown = preview(streamed.result);

            streamed.result_preview = shown.text;
            streamed.result_chars = shown.chars;
            streamed.result_truncated = shown.truncated;

            delete streamed.result;
        }

        return streamed;
    }


    function broadcast(rawEvent) {

        const carriesPlan =
            rawEvent.type === "run:start" ||
            rawEvent.type === "run:status" ||
            rawEvent.type === "run:continue" ||
            rawEvent.type === "plan:autoroute:end" ||
            (
                rawEvent.type === "tool:end" &&
                rawEvent.success === true &&
                ["plan_set", "plan_update"].includes(rawEvent.name)
            );

        const event =
            forStream(
                carriesPlan
                    ? {
                        ...rawEvent,
                        plan: runtime.currentPlanView()
                    }
                    : rawEvent
            );

        state.events.push(event);

        /*
        | Stored in the same shape the browser received, so replaying a
        | session redraws exactly what the live run drew.
        */

        if (
            sessionsEnabled() &&
            event.type !== "session:message" &&
            event.type !== "session:switched"
        ) {

            state.session.events.push(event);
        }

        while (state.events.length > runtime.settings.get("MAX_CONSOLE_EVENTS")) {
            state.events.shift();
        }

        sseHub.broadcast(
            event,
            (value, client) => eventForClient(value, client)
        );
    }


    /*
    | The browser must receive model output even when session persistence is
    | disabled. Persistence is an optional storage feature; it must never
    | turn the live conversation into a single final-answer bubble.
    */
    runtime.events.bus.on("agent:response", event => {

        addMessage({
            role: "assistant",
            kind: "model",
            agent: event.scope || event.agent,
            iteration: event.iteration,
            turn_id: event.turn_id,
            execution_key: executionMessageKey(event),
            finish_reason: event.finish_reason,
            truncated: event.truncated,
            content: event.content
        });
    });


    /*
    | Reasoning is part of the conversation for a reader, so it is kept
    | as its own entry rather than folded into the answer. This handles both
    | the live stream and the stored conversation through addMessage.
    */
    runtime.events.bus.on("agent:thinking", event => {

        addMessage({
            role: "assistant",
            kind: "thinking",
            agent: event.scope || event.agent,
            iteration: event.iteration,
            turn_id: event.turn_id,
            execution_key: executionMessageKey(event),
            content: event.content
        });
    });


    runtime.events.bus.on("event", broadcast);


    /*
    | An approval becomes a pending question the browser can answer. The
    | policy layer creates the pending record; this adapter only connects it
    | to the console's event stream and response endpoint.
    */

    runtime.setApprovalHandler(
        runtime.policyEngine.approvalManager.createPendingHandler({
            store: approvalStore,
            createId: (_evaluation, _args, store) =>
                `approval_${store.pendingSize() + 1}_${Date.now()}`,
            projectIdOf: evaluation =>
                evaluation.project_id ||
                (runtime.runManager && runtime.runManager.current
                    ? runtime.runManager.current()?.projectId
                    : null) ||
                state.projectId ||
                null,
            onRequest: (request, args) => {

                runtime.events.emit("approval:request", {
                    id: request.id,
                    agent: request.agent,
                    tool: request.tool,
                    reason: request.reason,
                    groups: request.groups,
                    arguments: args,
                    project_id: request.project_id
                });
            }
        })
    );


    function resolveApproval(id, approved) {

        const request =
            approvalStore.removePending(id);

        if (!request) {
            return false;
        }

        request.resolve(approved);

        runtime.events.emit("approval:resolved", {
            id,
            tool: request.tool,
            approved,
            project_id: request.project_id || null
        });

        return true;
    }


    function snapshot() {

        const context =
            runtime.createRuntimeContext();

        return {
            status:
                state.status,

            task:
                state.task,

            answer:
                state.answer,

            error:
                state.error,

            started_at:
                state.startedAt,

            finished_at:
                state.finishedAt,

            workspace:
                context.runtime.workspace_root,

            model:
                runtime.activeModel({}),

            approval_mode:
                runtime.getApprovalMode(),

            limits:
                context.runtime,

            settings:
                runtime.settings.all(),

            auto_continue:
                runtime.settings.get("AUTO_CONTINUE") === true,

            cycles:
                state.cycles,

            plan:
                runtime.currentPlanView(),

            turns:
                state.history.filter(
                    message => message.role === "user"
                ).length,

            pending_approvals:
                approvalStore.pendingValues().map(
                    request => ({
                        id: request.id,
                        agent: request.agent,
                        tool: request.tool,
                        reason: request.reason,
                        arguments: request.arguments,
                        project_id: request.project_id || null
                    })
                ),

            discussion:
                state.discussion,

            agents:
                runtime.registries.AGENTS.map(
                    agent => ({
                        name: agent.name,
                        description: agent.description
                    })
                ),

            tool_groups:
                runtime.registries.TOOL_GROUPS,

            /*
            | Enough for the header to say whether the external servers
            | are up; the full list is behind /api/mcp.
            */

            mcp:
                context.mcp,

            events:
                state.events,

            session:
                sessions.summarise(state.session),

            messages:
                state.session.messages,

            sessions:
                sessionsEnabled()
                    ? sessions.listSessions()
                    : [],

            project:
                runtime.project.loadProject()
        };
    }


    function eventForClient(event, client) {

        if (!client) {
            return event;
        }

        const visibleOnProjectStream =
            runtime.events.visibleOnProjectStream;

        const aggregateMetadata =
            runtime.events.aggregateMetadata;

        if (client.projectId) {

            return typeof visibleOnProjectStream === "function"
                ? visibleOnProjectStream(event, client.projectId)
                : (event.project_id === client.projectId ? event : null);
        }

        if (
            client.claims &&
            !consoleAuth.allowsAllProjects(client.claims)
        ) {

            if (
                event.project_id &&
                !consoleAuth.allowsProject(client.claims, event.project_id)
            ) {
                return null;
            }

            if (!event.project_id && typeof aggregateMetadata === "function") {
                return aggregateMetadata(event);
            }
        }

        return event;
    }


    function snapshotFor(claims) {

        const snap = snapshot();

        if (!claims || consoleAuth.allowsAllProjects(claims)) {
            return snap;
        }

        snap.events =
            snap.events
                .map(event => eventForClient(event, { claims }))
                .filter(Boolean);

        snap.pending_approvals =
            snap.pending_approvals.filter(
                item =>
                    !item.project_id ||
                    consoleAuth.allowsProject(claims, item.project_id)
            );

        return snap;
    }


    /*
    | runOptions (EXECUTION_PLAN Phase 7 گام ۲): when the caller names a
    | projectId the run is resolved against the project registry and the
    | whole run is scoped to that project (the project context is resolved before accepting). Legacy callers pass nothing
    | and the historical single-run behaviour is untouched.
    */
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


    /*
    | Per-project run slots (plan phase 7 / step 3). The console has ONE
    | foreground conversation (`state`), but that must not serialise the
    | whole process: a run for project B may start while project A's run is in
    | progress. Rules:
    |   - a project with a run in progress refuses another (409) - the
    |     "same project" policy, on top of the scheduler's MAX_RUNS_PER_PROJECT;
    |   - a run for another project starts at once and, when the foreground is
    |     busy, runs in the BACKGROUND (own slot, no clobbering of `state`);
    |   - a run with no project keeps the historical single-run gate.
    */
    const projectSlots = new Map();

    function projectSlotBusy(projectId) {

        const slot = projectSlots.get(projectId);

        return Boolean(slot && slot.status === "running");
    }

    function slotView(projectId) {

        const slot = projectSlots.get(projectId);

        if (!slot) {
            return { project_id: projectId, status: "idle" };
        }

        return {
            project_id: projectId,
            status: slot.status,
            task: slot.task,
            answer: slot.answer,
            error: slot.error,
            started_at: slot.startedAt,
            finished_at: slot.finishedAt,
            background: slot.background
        };
    }


    async function startBackgroundRun(task, runOptions) {

        const projectId = runOptions.projectId;

        const slot = {
            projectId,
            status: "running",
            task,
            answer: null,
            error: null,
            startedAt: Date.now(),
            finishedAt: null,
            background: true,
            history: []
        };

        projectSlots.set(projectId, slot);

        try {

            const action =
                await runtime.runAgent({
                    task,
                    history: slot.history,
                    projectId
                });

            slot.answer = action.response ? action.response.content : null;
            slot.error = action.error || null;
            slot.status = action.error ? "failed" : "done";

        } catch (error) {

            const cancelled =
                error.code === "RUN_CANCELLED" || /cancel/i.test(error.message);

            slot.error = {
                code: cancelled ? "CANCELLED" : error.name || "RUNTIME_ERROR",
                message: error.message,
                retryable: false
            };

            slot.status = cancelled ? "cancelled" : "failed";

            if (!error.runTerminalEmitted) {

                runtime.events.emit("run:error", {
                    project_id: projectId,
                    message: error.message,
                    cancelled
                });
            }

        } finally {

            slot.finishedAt = Date.now();
        }
    }


    async function startTask(task, runOptions = {}) {

        if (runOptions.projectId) {

            if (projectSlotBusy(runOptions.projectId)) {

                throw Object.assign(
                    new Error(`project ${runOptions.projectId} already has a run in progress`),
                    { status: 409 }
                );
            }

            /* the foreground is taken (by another project or the default
               project): run in the background instead of refusing */
            if (state.status === "running") {

                return startBackgroundRun(task, runOptions);
            }

        } else if (state.status === "running") {

            throw Object.assign(
                new Error("a task is already running"),
                { status: 409 }
            );
        }

        state.status = "running";
        state.stopRequested = false;
        state.projectId = runOptions.projectId || null;

        if (runOptions.projectId) {

            projectSlots.set(runOptions.projectId, {
                projectId: runOptions.projectId,
                status: "running",
                task,
                answer: null,
                error: null,
                startedAt: Date.now(),
                finishedAt: null,
                background: false
            });
        }

        if (state.lastPlanSignature === null) {

            const before =
                inRunProject(runOptions, () => runtime.currentPlanSummary());

            state.lastPlanSignature =
                before.exists
                    ? `${before.steps}:${before.done}:${before.blocked}`
                    : "none";
        }
        state.task = task;
        state.answer = null;
        state.error = null;
        state.startedAt = Date.now();
        state.finishedAt = null;

        const turn_id =
            `turn-${Date.now()}-${(state.turnCounter = (state.turnCounter || 0) + 1)}`;

        state.currentTurnId = turn_id;

        addMessage({
            role: "user",
            kind: "message",
            content: task,
            turn_id
        });

        try {

            const action =
                await runtime.runAgent({
                    task,

                    turn_id,

                    history:
                        state.history,

                    ...(runOptions.projectId
                        ? { projectId: runOptions.projectId }
                        : {})
                });

            state.answer =
                action.response
                    ? action.response.content
                    : null;

            state.error =
                action.error || null;

            state.status =
                action.error
                    ? "failed"
                    : "done";

            if (state.answer) {

                addMessage({
                    role: "assistant",
                    kind: "response",
                    turn_id,
                    content: state.answer
                });
            }

            if (state.error) {

                addMessage({
                    role: "assistant",
                    kind: "error",
                    turn_id,
                    content:
                        `${state.error.code}: ${state.error.message}`
                });
            }

        } catch (error) {

            state.error = {
                code:
                    runtime.isRunCancelled()
                        ? "CANCELLED"
                        : error.name || "RUNTIME_ERROR",

                message:
                    error.message,

                retryable: false
            };

            state.status =
                runtime.isRunCancelled()
                    ? "cancelled"
                    : "failed";

            /* the runtime already ended a started run with run:error; only a
               failure before the run started still needs its terminal event */
            if (!error.runTerminalEmitted) {

                runtime.events.emit("run:error", {
                    message: error.message,
                    cancelled: runtime.isRunCancelled()
                });
            }

            addMessage({
                role: "assistant",
                kind: "error",
                turn_id,
                content: error.message
            });

        } finally {

            state.finishedAt = Date.now();

            const foregroundSlot =
                runOptions.projectId
                    ? projectSlots.get(runOptions.projectId)
                    : null;

            if (foregroundSlot && !foregroundSlot.background) {

                foregroundSlot.status = state.status;
                foregroundSlot.answer = state.answer;
                foregroundSlot.error = state.error;
                foregroundSlot.finishedAt = state.finishedAt;
            }

            /* Record what this run changed in git — shown in the
               conversation and streamed as a git:report event. */
            await recordGitReport();
            if (runtime.eventstore && typeof runtime.eventstore.flush === "function") {
                await runtime.eventstore.flush();
            }

            /*
            | The console equivalent of --until-done: while the plan has
            | open steps and the operator has not stopped, the next
            | cycle starts on its own.
            */

            const plan =
                inRunProject(runOptions, () => runtime.currentPlanSummary());

            /*
            | Progress is any movement of the plan: a step finished, a
            | step added, or the plan appearing for the first time.
            */

            const signature =
                plan.exists
                    ? `${plan.steps}:${plan.done}:${plan.blocked}`
                    : "none";

            const madeProgress =
                state.lastPlanSignature === null ||
                signature !== state.lastPlanSignature;

            state.lastPlanSignature = signature;

            const shouldContinue =
                runtime.settings.get("AUTO_CONTINUE") === true &&
                state.status === "done" &&
                plan.exists &&
                !plan.complete &&
                !state.stopRequested &&
                state.cycles < runtime.settings.get("MAX_AUTO_CYCLES");

            if (shouldContinue && !madeProgress) {

                /*
                | A cycle that finished no step would repeat for ever,
                | so the loop stops and says why.
                */

                runtime.events.emit("run:loop", {
                    agent: "main_agent",
                    scope: "main_agent",
                    outcome: "stalled",
                    signature,
                    repeats: state.cycles,
                    reason: "a cycle finished without completing a step"
                });

                runtime.events.emit("run:auto_stopped", {
                    reason: "no step was completed in the last cycle",
                    done: plan.done,
                    steps: plan.steps
                });

            } else if (shouldContinue) {

                state.cycles++;

                /*
                | Each cycle is a fresh conversation. The plan on disk
                | carries the state, so the transcript never has to,
                | which is what keeps a long build inside the context
                | budget.
                */

                state.history = [];

                runtime.events.emit("run:auto_continue", {
                    cycle: state.cycles,
                    open_steps:
                        plan.pending + plan.in_progress,
                    next_step: plan.next_step
                });

                /*
                | The continuation is the SAME run for the same project: it
                | inherits the options (projectId, ...) of the run that just
                | ended. Without them the next cycle silently fell back to the
                | default project (audit F-002 / AUTO_CONTINUE drops project scope).
                */
                setTimeout(
                    () =>
                        startTask(
                            "Continue the plan: read it, take the next open step, verify it, and record the result.",
                            { ...runOptions }
                        ).catch(() => {}),
                    50
                );
            }

            /* nothing may stay pending once the run is over */

            for (const id of approvalStore.pendingKeys()) {
                resolveApproval(id, false);
            }

            runtime.events.emit("run:status", {
                status: state.status,
                answer: state.answer,
                error: state.error
            });

            state.session.turns =
                state.session.messages.filter(
                    message => message.role === "user"
                ).length;

            saveSession();
        }
    }


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
                path.resolve(__dirname, "..", ".."),
                "agent",
                "discussion"
            )
        );

    const discussionService =
        new DiscussionService({ runtime });


    async function startDiscussion({
        task,
        personas,
        maxRounds,
        projectId = null,
        projectContext = null
    }) {

        const {
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

        const started =
            discussionService.start({
                task,
                personas,
                maxRounds,
                projectId,
                projectContext,
                llmCaller: caller,
                maxParallel: runtime.settings.get("MAX_PARALLEL_AGENTS"),
                persist: true,
                defer: true,
                onFinish: (result, discussion) => {
                    if (result.final_report?.summary) {
                        addMessage({
                            role: "assistant",
                            kind: "discussion-report",
                            content: result.final_report.summary
                        });
                    }

                    discussion.rounds = discussion.rounds || [];
                },
                onError: (error, discussion) => {
                    addMessage({
                        role: "assistant",
                        kind: "error",
                        content: `discussion failed: ${error.message}`
                    });
                    discussion.status = "failed";
                }
            });

        state.discussion = started.record;
        state.projectId = projectId || null;

        addMessage({
            role: "user",
            kind: "discussion-request",
            content: task,
            personas
        });

        return started.promise;
    }

    function serveStatic(req, res, pathname) {

        const relative =
            pathname === "/"
                ? "index.html"
                : pathname.replace(/^\/+/, "");

        const target =
            path.join(PUBLIC_DIR, relative);

        if (
            !target.startsWith(PUBLIC_DIR + path.sep) ||
            !fs.existsSync(target) ||
            !fs.statSync(target).isFile()
        ) {

            sendJson(res, 404, { error: "not found" });

            return;
        }

        const body =
            fs.readFileSync(target);

        res.writeHead(200, {
            "content-type":
                MIME[path.extname(target)] ||
                "application/octet-stream",

            "cache-control": "no-store",

            "content-length": body.length
        });

        res.end(body);
    }


    const handle =
        async (req, res) => {

            const url =
                new URL(
                    req.url,
                    `http://${req.headers.host || "localhost"}`
                );

            const { pathname } = url;
            const isApiRequest = pathname.startsWith("/api/");

            if (isApiRequest && !allowApiRequest(req)) {
                sendJson(res, 429, { error: "console API rate limit exceeded" });
                return;
            }

            if (
                isApiRequest &&
                !sameOrigin(req.headers.origin, req.headers.host)
            ) {
                sendJson(res, 403, { error: "cross-origin console request refused" });
                return;
            }

            const suppliedToken = requestToken(req, url);
            const claims = consoleAuth.resolve(suppliedToken, consoleToken);
            const authenticated = Boolean(claims);

            /*
            | Static assets remain public so the browser can load the UI.
            | Every API, SSE and control-plane endpoint requires the token.
            | A token in the launch URL is exchanged for an HttpOnly cookie
            | so normal browser fetch/EventSource calls do not need custom
            | headers.
            */
            if (authenticated && url.searchParams.has("token")) {
                setConsoleCookie(res, CONSOLE_COOKIE, consoleToken);
            }

            if (pathname.startsWith("/api/") && !authenticated) {
                sendJson(res, 401, { error: "console authentication required" });
                return;
            }

            try {

                /* ---------------------------------------------- events */

                if (
                    pathname === "/api/events" &&
                    req.method === "GET"
                ) {

                    const filterProjectId =
                        url.searchParams.get("projectId");

                    if (filterProjectId) {

                        const allowed =
                            consoleAuth.authorize(claims, {
                                projectId: filterProjectId,
                                permission: "project:read"
                            });

                        if (!allowed.ok) {

                            sendJson(res, allowed.status, { error: allowed.error });
                            return;
                        }
                    }

                    const client = {
                        res,
                        projectId: filterProjectId || null,
                        claims
                    };

                    const liveEvents =
                        snapshot().events
                            .map(event => eventForClient(event, client))
                            .filter(Boolean);

                    const snap = {
                        ...snapshotFor(claims),
                        events: liveEvents
                    };

                    sseHub.attach(
                        req,
                        res,
                        client,
                        {
                            type: "snapshot",
                            snapshot: snap
                        }
                    );

                    return;
                }

                /* ---------------------------------------------- state */

                if (
                    pathname === "/api/state" &&
                    req.method === "GET"
                ) {

                    sendJson(res, 200, snapshotFor(claims));

                    return;
                }

                /* ----------------------------------------------- mcp */

                if (
                    pathname === "/api/mcp" &&
                    req.method === "GET"
                ) {

                    if (url.searchParams.get("refresh") === "1") {

                        await toolRuntime
                            .discoverMcpTools({ force: true })
                            .catch(() => {});
                    }

                    const manager =
                        toolRuntime.mcp._manager;

                    sendJson(res, 200, {
                        ...manager.status(),

                        tools:
                            manager.catalogueEntries().map(entry => ({
                                name: entry.name,
                                server: entry.server,
                                tool: entry.tool,
                                description: entry.description
                            }))
                    });

                    return;
                }

                if (
                    pathname === "/api/mcp" &&
                    req.method === "POST"
                ) {

                    const body =
                        await readBody(req);

                    if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
                        sendJson(res, 403, {
                            error: "runtime MCP server management is disabled"
                        });
                        return;
                    }

                    try {

                        // Normalize UI payload to config shape
                        // UI may send command_args (old) or args (new), and env as object
                        const normalizedBody = {
                            ...body,
                            name: body.name,
                            transport: body.transport,
                            command: body.command,
                            args: body.args || body.command_args,
                            env: body.env,
                            url: body.url,
                            token: body.token,
                            headers: body.headers,
                            cwd: body.cwd,
                            trust: body.trust,
                            include: body.include,
                            exclude: body.exclude
                        };

                        await runtime.policyEngine.enforce(
                            "mcp_add",
                            normalizedBody,
                            "web_console"
                        );

                        const added =
                            await toolRuntime.mcp._manager.add(
                                normalizedBody.name,
                                normalizedBody,
                                { persist: body.persist !== false }
                            );

                        sendJson(res, 200, {
                            ok: true,
                            server: added.config.name,
                            transport: added.config.transport,
                            persisted_to: added.persisted_to
                        });

                    } catch (error) {

                        sendJson(res, 400, {
                            error: error.message
                        });
                    }

                    return;
                }

                if (
                    pathname.startsWith("/api/mcp/") &&
                    req.method === "DELETE"
                ) {

                    const name =
                        decodeURIComponent(
                            pathname.slice("/api/mcp/".length)
                        );

                    if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
                        sendJson(res, 403, {
                            error: "runtime MCP server management is disabled"
                        });
                        return;
                    }

                    await runtime.policyEngine.enforce(
                        "mcp_remove",
                        { name },
                        "web_console"
                    );

                    const removed =
                        await toolRuntime.mcp._manager.remove(name);

                    sendJson(res, 200, {
                        ok: true,
                        server: name,
                        ...removed
                    });

                    return;
                }

                /*
                | Toggling a server is not the same as removing it: the
                | definition stays, so it can be switched back on
                | without being typed again.
                */

                if (
                    pathname.startsWith("/api/mcp/") &&
                    pathname.endsWith("/enabled") &&
                    req.method === "POST"
                ) {

                    const name =
                        decodeURIComponent(
                            pathname.slice(
                                "/api/mcp/".length,
                                pathname.length - "/enabled".length
                            )
                        );

                    const body =
                        await readBody(req);

                    if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
                        sendJson(res, 403, {
                            error: "runtime MCP server management is disabled"
                        });
                        return;
                    }

                    await runtime.policyEngine.enforce(
                        "mcp_add",
                        { name, enabled: body.enabled !== false },
                        "web_console"
                    );

                    const changed =
                        toolRuntime.mcp._manager.setEnabled(
                            name,
                            body.enabled !== false
                        );

                    if (!changed) {

                        sendJson(res, 404, {
                            error: `unknown MCP server: ${name}`
                        });

                        return;
                    }

                    if (body.enabled !== false) {

                        await toolRuntime
                            .discoverMcpTools({ force: true })
                            .catch(() => {});
                    }

                    sendJson(res, 200, {
                        ok: true,
                        server: name,
                        enabled: body.enabled !== false
                    });

                    return;
                }

                /* ------------------------------------------- sessions */

                if (
                    pathname === "/api/sessions" &&
                    req.method === "GET"
                ) {

                    sendJson(res, 200, {
                        current: state.session.id,
                        sessions: sessions.listSessions()
                    });

                    return;
                }

                if (
                    pathname === "/api/sessions" &&
                    req.method === "POST"
                ) {

                    if (state.status === "running") {

                        sendJson(res, 409, {
                            error: "cannot switch conversation while a task is running"
                        });

                        return;
                    }

                    saveSession();

                    state.session = sessions.emptySession();
                    state.history = [];
                    state.events = [];
                    state.answer = null;
                    state.error = null;
                    state.status = "idle";
                    state.cycles = 0;
                    state.lastPlanSignature = null;

                    calls.clear();

                    runtime.events.emit("session:switched", {
                        session: sessions.summarise(state.session)
                    });

                    sendJson(res, 201, {
                        session: sessions.summarise(state.session)
                    });

                    return;
                }

                if (
                    pathname.startsWith("/api/sessions/") &&
                    req.method === "GET"
                ) {

                    const id =
                        decodeURIComponent(
                            pathname.slice("/api/sessions/".length)
                        );

                    const found =
                        id === state.session.id
                            ? state.session
                            : sessions.loadSession(id);

                    if (!found) {

                        sendJson(res, 404, {
                            error: "unknown session"
                        });

                        return;
                    }

                    sendJson(res, 200, {
                        session: found,
                        current: state.session.id
                    });

                    return;
                }

                if (
                    pathname.startsWith("/api/sessions/") &&
                    req.method === "POST"
                ) {

                    const id =
                        decodeURIComponent(
                            pathname.slice("/api/sessions/".length)
                        );

                    if (state.status === "running") {

                        sendJson(res, 409, {
                            error: "cannot switch conversation while a task is running"
                        });

                        return;
                    }

                    /*
                    | Opening a conversation continues it: the model
                    | history, the events and the recorded calls all come
                    | back, so the next task sees what the last one did.
                    */

                    saveSession();

                    const opened = activateSession(id);

                    if (!opened) {

                        sendJson(res, 404, {
                            error: "unknown session"
                        });

                        return;
                    }

                    sendJson(res, 200, {
                        session: opened
                    });

                    return;
                }

                if (
                    pathname.startsWith("/api/sessions/") &&
                    req.method === "DELETE"
                ) {

                    const id =
                        decodeURIComponent(
                            pathname.slice("/api/sessions/".length)
                        );

                    if (id === state.session.id) {

                        sendJson(res, 409, {
                            error: "cannot delete the open conversation"
                        });

                        return;
                    }

                    sendJson(
                        res,
                        sessions.deleteSession(id) ? 200 : 404,
                        { deleted: id }
                    );

                    return;
                }

                /* ---------------------------------------------- calls */

                if (
                    pathname === "/api/calls" &&
                    req.method === "GET"
                ) {

                    sendJson(res, 200, {
                        calls:
                            [...calls.values()].map(call => ({
                                key: call.key,
                                agent: call.agent,
                                id: call.id,
                                name: call.name,
                                graph_id: call.graph_id,
                                shape: call.shape,
                                /* planned grouping; the real concurrency is
                                   rebuilt from the interval below */
                                wave: call.wave,
                                iteration: call.iteration,
                                depends_on: call.depends_on,
                                status: call.status,
                                started_at: call.started_at ?? null,
                                finished_at: call.finished_at ?? null,
                                duration_ms: call.duration_ms
                            }))
                    });

                    return;
                }

                if (
                    pathname.startsWith("/api/calls/") &&
                    req.method === "GET"
                ) {

                    const key =
                        decodeURIComponent(
                            pathname.slice("/api/calls/".length)
                        );

                    const call = calls.get(key);

                    if (!call) {

                        sendJson(res, 404, {
                            error: "unknown call"
                        });

                        return;
                    }

                    sendJson(res, 200, { call });

                    return;
                }

                /* ---------------------------------------------- graph visualization */

                if (
                    pathname.startsWith("/api/graph/") &&
                    req.method === "GET"
                ) {
                    const viewType = pathname.slice("/api/graph/".length);
                    let root = path.resolve(runtime.workspaceRoot || process.cwd());
                    let projectName = path.basename(root);
                    const graphProjectId = url.searchParams.get("projectId");

                    if (
                        graphProjectId &&
                        graphProjectId !== "current" &&
                        runtime.projects &&
                        typeof runtime.projects.registry === "function"
                    ) {

                        const allowed =
                            consoleAuth.authorize(claims, {
                                projectId: graphProjectId,
                                permission: "project:read"
                            });

                        if (!allowed.ok) {

                            sendJson(res, allowed.status, { error: allowed.error });
                            return;
                        }

                        try {

                            const record =
                                runtime.projects.registry().get(graphProjectId);

                            root = path.resolve(record.rootPath);
                            projectName = record.name;

                        } catch {

                            sendJson(res, 404, { error: "Unknown project" });
                            return;
                        }
                    }

                    const rootBase = path.basename(root).toLowerCase();
                    const rootParent = path.basename(path.dirname(root)).toLowerCase();

                    if (rootBase === ".agent" || rootBase === ".semantic-engine") {
                        root = path.dirname(root);
                    } else if (rootBase === "semantic" && rootParent === ".agent") {
                        root = path.dirname(path.dirname(root));
                    }

                    const indexCandidates = [
                        path.join(root, ".semantic-engine", "project-index.json"),
                        /* compatibility with older Structured AI indexes */
                        path.join(root, ".agent", "semantic", "project-index.json"),
                        path.join(root, "semantic", "project-index.json")
                    ];
                    const indexPath =
                        indexCandidates.find(candidate => fs.existsSync(candidate)) || indexCandidates[0];

                    let nodes = [];
                    let edges = [];

                    if (fs.existsSync(indexPath)) {
                        try {
                            const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
                            projectName = index.root || projectName;

                            if (viewType === "architecture" || viewType === "module") {
                                const allFiles = Array.isArray(index.files) ? index.files : Object.values(index.files || {});
                                const topDirs = new Set();
                                allFiles.forEach(f => {
                                    const parts = f.path.split("/");
                                    if (parts.length > 1) topDirs.add(parts.slice(0, 2).join("/"));
                                    else topDirs.add("root");
                                });

                                Array.from(topDirs).slice(0, 20).forEach(dir => {
                                    nodes.push({ id: `mod-${dir}`, type: "module", label: dir, metadata: { path: dir, importance: 80 } });
                                });

                                const depEdges = index.graphs?.dependencyGraph || index.graphs?.dependencies || [];
                                depEdges.slice(0, 40).forEach((e, idx) => {
                                    edges.push({ id: `e-${idx}`, source: e.from, target: e.to, relation: "depends_on", metadata: { confidence: e.provenance?.confidence || 90 } });
                                });
                            } else {
                                const allSymbols = (index.symbols || []).slice(0, 50);
                                allSymbols.forEach(s => {
                                    nodes.push({ id: s.id, type: s.kind === "class" ? "class" : "function", label: s.name, metadata: { path: s.filePath, line: s.line, endLine: s.endLine, complexity: s.complexity || 1, referencesCount: s.referenceCount || 0 } });
                                });

                                const callEdges = index.graphs?.callGraph || index.graphs?.calls || [];
                                callEdges.slice(0, 40).forEach((e, idx) => {
                                    edges.push({ id: `call-${idx}`, source: e.caller || e.from, target: e.callee || e.to, relation: "calls", metadata: { confidence: e.provenance?.confidence || 90 } });
                                });
                            }
                        } catch {
                            /* fallback */
                        }
                    }

                    sendJson(res, 200, {
                        view: viewType,
                        projectName,
                        nodes,
                        edges
                    });

                    return;
                }

                /* ---------------------------------------------- tasks */

                if (
                    pathname === "/api/tasks" &&
                    req.method === "POST"
                ) {

                    const body =
                        await readBody(req);

                    const task =
                        typeof body.task === "string"
                            ? body.task.trim()
                            : "";

                    if (task === "") {

                        sendJson(res, 400, {
                            error: "task is required"
                        });

                        return;
                    }

                    if (
                        state.status === "running" ||
                        (
                            state.discussion &&
                            state.discussion.status === "running"
                        )
                    ) {

                        sendJson(res, 409, {
                            error:
                                state.status === "running"
                                    ? "a task is already running"
                                    : "a discussion is already running"
                        });

                        return;
                    }

                    /* the run continues in the background */

                    startTask(task).catch(() => {});

                    sendJson(res, 202, { accepted: true });

                    return;
                }

                /* ---------------------------------- projects (Phase 7+9) */

                if (pathname === "/api/projects" || pathname.startsWith("/api/projects/")) {

                    const registry = runtime.projects.registry();

                    const requireRecord = (projectId) => {

                        try {

                            return registry.get(projectId);

                        } catch (error) {

                            const err = new Error(error.message);
                            err.status = 404;
                            throw err;
                        }
                    };

                    const requireAccess = (projectId, permission) => {

                        const allowed =
                            consoleAuth.authorize(claims, {
                                projectId,
                                permission
                            });

                        if (!allowed.ok) {

                            const err = new Error(allowed.error);
                            err.status = allowed.status;
                            throw err;
                        }
                    };

                    const busy = () =>
                        state.status === "running" ||
                        (
                            state.discussion &&
                            state.discussion.status === "running"
                        );

                    if (pathname === "/api/projects" && req.method === "GET") {

                        const listed =
                            consoleAuth.visibleProjects(claims, registry.list());

                        sendJson(res, 200, { projects: listed });
                        return;
                    }

                    if (pathname === "/api/projects" && req.method === "POST") {

                        const write =
                            consoleAuth.authorize(claims, {
                                permission: "project:write"
                            });

                        if (!write.ok || !consoleAuth.allowsAllProjects(claims)) {

                            sendJson(res, 403, {
                                error: "token cannot register projects"
                            });
                            return;
                        }

                        const body = await readBody(req);

                        if (typeof body.rootPath !== "string" || body.rootPath.trim() === "") {

                            sendJson(res, 400, { error: "rootPath is required" });
                            return;
                        }

                        try {

                            const existing =
                                registry.findByRoot(body.rootPath);

                            const record =
                                registry.register({
                                    id: body.id,
                                    name: body.name,
                                    rootPath: body.rootPath,
                                    semanticEndpoint: body.semanticEndpoint,
                                    enabled: body.enabled,
                                    autoStart: body.autoStart,
                                    permissions: body.permissions
                                });

                            sendJson(res, existing ? 200 : 201, { project: record });

                        } catch (error) {

                            sendJson(res, 400, { error: error.message });
                        }

                        return;
                    }

                    const rest =
                        pathname.slice("/api/projects/".length);

                    const slash = rest.indexOf("/");
                    const projectId =
                        decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
                    const suffix =
                        slash === -1 ? "" : rest.slice(slash);

                    if (!projectId) {

                        sendJson(res, 404, { error: "not found" });
                        return;
                    }

                    if (suffix === "" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        sendJson(res, 200, { project: requireRecord(projectId) });
                        return;
                    }

                    if (suffix === "" && req.method === "PATCH") {

                        requireAccess(projectId, "project:write");
                        const body = await readBody(req);

                        try {

                            sendJson(res, 200, {
                                project: registry.update(projectId, body)
                            });

                        } catch (error) {

                            sendJson(
                                res,
                                /Unknown project/.test(error.message) ? 404 : 400,
                                { error: error.message }
                            );
                        }

                        return;
                    }

                    if (suffix === "" && req.method === "DELETE") {

                        requireAccess(projectId, "project:write");

                        try {

                            registry.remove(projectId);
                            sendJson(res, 200, { deleted: projectId });

                        } catch (error) {

                            sendJson(res, 404, { error: error.message });
                        }

                        return;
                    }

                    if (suffix === "/discussions" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        const record = requireRecord(projectId);
                        const ctx = runtime.projects.createProjectContext(record);

                        sendJson(res, 200, {
                            project_id: record.id,
                            discussions: discussionService.list({
                                projectId: record.id,
                                projectContext: ctx
                            })
                        });
                        return;
                    }

                    if (
                        suffix.startsWith("/discussions/") &&
                        req.method === "GET"
                    ) {

                        requireAccess(projectId, "project:read");
                        const record = requireRecord(projectId);
                        const discussionId = decodeURIComponent(
                            suffix.slice("/discussions/".length)
                        );
                        const ctx = runtime.projects.createProjectContext(record);
                        const discussion = discussionService.load(discussionId, {
                            projectId: record.id,
                            projectContext: ctx
                        });

                        if (!discussion) {
                            sendJson(res, 404, { error: "unknown discussion" });
                            return;
                        }

                        sendJson(res, 200, {
                            project_id: record.id,
                            discussion
                        });
                        return;
                    }

                    if (suffix === "/discussions" && req.method === "POST") {

                        requireAccess(projectId, "project:write");
                        const record = requireRecord(projectId);
                        const body = await readBody(req);
                        const task = typeof body.task === "string" ? body.task.trim() : "";
                        const personas = Array.isArray(body.personas)
                            ? body.personas.filter(id => typeof id === "string").map(id => id.trim()).filter(Boolean)
                            : [];
                        const maxRounds = Number.isInteger(body.max_rounds) ? body.max_rounds : 5;

                        if (task === "" || personas.length === 0 || maxRounds < 1 || maxRounds > 10) {
                            sendJson(res, 400, {
                                error: task === ""
                                    ? "task is required"
                                    : personas.length === 0
                                        ? "personas is required: a non-empty array of persona ids"
                                        : "max_rounds must be between 1 and 10"
                            });
                            return;
                        }

                        const ctx = runtime.projects.createProjectContext(record);
                        const known = DISCUSSION_MODULE.listPersonas().map(persona => persona.id);
                        const unknown = personas.find(id => !known.includes(id));

                        if (unknown) {
                            sendJson(res, 400, {
                                error: `unknown persona: ${unknown}; available: ${known.join(", ")}`
                            });
                            return;
                        }

                        if (busy()) {
                            sendJson(res, 409, {
                                error: state.status === "running"
                                    ? "a task is already running"
                                    : "a discussion is already running"
                            });
                            return;
                        }

                        startDiscussion({
                            task,
                            personas,
                            maxRounds,
                            projectId: record.id,
                            projectContext: ctx
                        }).catch(() => {});

                        sendJson(res, 202, {
                            accepted: true,
                            id: state.discussion.id,
                            project_id: record.id
                        });
                        return;
                    }

                    if (suffix === "/state" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        const record = requireRecord(projectId);
                        const live = state.projectId === record.id;
                        const ctx =
                            runtime.projects.createProjectContext(record);

                        sendJson(res, 200, {
                            project: record,
                            status: live ? state.status : "idle",
                            task: live ? state.task : null,
                            answer: live ? state.answer : null,
                            error: live ? state.error : null,
                            events:
                                state.events
                                    .map(event =>
                                        eventForClient(event, { projectId: record.id, claims })
                                    )
                                    .filter(Boolean),
                            sessions:
                                sessions.listSessions(ctx.dataRoot),
                            pending_approvals:
                                approvalStore.pendingValues()
                                    .filter(item => item.project_id === record.id)
                                    .map(item => ({
                                        id: item.id,
                                        agent: item.agent,
                                        tool: item.tool,
                                        reason: item.reason,
                                        arguments: item.arguments,
                                        project_id: item.project_id
                                    })),
                            active_runs:
                                typeof runtime.runManager.activeRuns === "function"
                                    ? runtime.runManager.activeRuns()
                                        .filter(run => run.projectId === record.id)
                                        .map(run => ({
                                            run_id: run.runId,
                                            task: run.task,
                                            status: run.status
                                        }))
                                    : []
                        });
                        return;
                    }

                    if (suffix === "/sessions" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        const record = requireRecord(projectId);
                        const ctx =
                            runtime.projects.createProjectContext(record);

                        sendJson(res, 200, {
                            project_id: record.id,
                            sessions: sessions.listSessions(ctx.dataRoot)
                        });
                        return;
                    }

                    if (suffix === "/events" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        requireRecord(projectId);

                        const client = {
                            res,
                            projectId,
                            claims
                        };

                        const snap = {
                            events:
                                snapshot().events
                                    .map(event => eventForClient(event, client))
                                    .filter(Boolean)
                        };

                        sseHub.attach(
                            req,
                            res,
                            client,
                            {
                                type: "snapshot",
                                snapshot: snap
                            }
                        );

                        return;
                    }

                    if (suffix === "/cancel" && req.method === "POST") {

                        requireAccess(projectId, "project:write");
                        requireRecord(projectId);

                        const cancelled = [];

                        if (
                            typeof runtime.runManager.activeRuns === "function"
                        ) {

                            for (const run of runtime.runManager.activeRuns()) {

                                if (run.projectId === projectId) {

                                    runtime.cancelRunById(run.runId, "web console");
                                    cancelled.push(run.runId);
                                }
                            }
                        }

                        if (state.projectId === projectId) {

                            state.stopRequested = true;
                            runtime.cancelRun("web console");
                        }

                        const dropped =
                            runtime.runScheduler &&
                            typeof runtime.runScheduler.cancelQueued === "function"
                                ? runtime.runScheduler.cancelQueued(projectId, "web console")
                                : 0;

                        sendJson(res, 200, {
                            cancelled: true,
                            project_id: projectId,
                            run_ids: cancelled,
                            queued_dropped: dropped
                        });
                        return;
                    }

                    if (
                        (suffix === "/tasks" || suffix === "/chat") &&
                        req.method === "POST"
                    ) {

                        requireAccess(projectId, "project:write");

                        const body = await readBody(req);

                        const task =
                            typeof body.task === "string"
                                ? body.task.trim()
                                : typeof body.message === "string"
                                    ? body.message.trim()
                                    : "";

                        if (task === "") {

                            sendJson(res, 400, {
                                error: "task is required"
                            });
                            return;
                        }

                        /* per-project gate: only THIS project's own run blocks it */
                        if (projectSlotBusy(projectId)) {

                            sendJson(res, 409, {
                                error: `project ${projectId} already has a run in progress`,
                                project_id: projectId
                            });
                            return;
                        }

                        const record = requireRecord(projectId);

                        const admission =
                            runtime.runScheduler &&
                            typeof runtime.runScheduler.admit === "function"
                                ? runtime.runScheduler.admit(record.id)
                                : "start";

                        if (admission === "reject") {

                            sendJson(res, 429, {
                                error: "run queue is full",
                                code: "RUN_QUEUE_FULL",
                                project_id: record.id
                            });
                            return;
                        }

                        startTask(task, { projectId: record.id }).catch(() => {});

                        sendJson(res, 202, {
                            accepted: true,
                            project_id: record.id,
                            queued: admission === "queue"
                        });
                        return;
                    }

                    if (suffix === "/run" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        requireRecord(projectId);

                        sendJson(res, 200, slotView(projectId));
                        return;
                    }

                    if (suffix === "/metrics" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        requireRecord(projectId);

                        sendJson(res, 200, {
                            project_id: projectId,
                            metrics:
                                runtime.observability.projectSnapshot(projectId),
                            scheduler:
                                runtime.runScheduler.snapshot()
                        });
                        return;
                    }

                    if (suffix === "/health" && req.method === "GET") {

                        requireAccess(projectId, "project:read");
                        requireRecord(projectId);

                        sendJson(res, 200, runtime.observability.healthOf(projectId));
                        return;
                    }

                    sendJson(res, 404, { error: "not found" });
                    return;
                }

                /* ----------------------------------------- discussion */

                if (
                    pathname === "/api/discussion/personas" &&
                    req.method === "GET"
                ) {

                    sendJson(res, 200, {
                        personas: DISCUSSION_MODULE.listPersonas()
                    });

                    return;
                }

                if (
                    pathname === "/api/discussion" &&
                    req.method === "POST"
                ) {

                    const body =
                        await readBody(req);

                    const task =
                        typeof body.task === "string"
                            ? body.task.trim()
                            : "";

                    const personas =
                        Array.isArray(body.personas)
                            ? body.personas
                                .filter(id => typeof id === "string")
                                .map(id => id.trim())
                                .filter(id => id !== "")
                            : [];

                    const maxRounds =
                        Number.isInteger(body.max_rounds)
                            ? body.max_rounds
                            : 5;

                    if (task === "") {
                        sendJson(res, 400, { error: "task is required" });
                        return;
                    }

                    if (personas.length === 0) {
                        sendJson(res, 400, {
                            error:
                                "personas is required: a non-empty array of persona ids"
                        });
                        return;
                    }

                    if (maxRounds < 1 || maxRounds > 10) {
                        sendJson(res, 400, {
                            error: "max_rounds must be between 1 and 10"
                        });
                        return;
                    }

                    const known =
                        DISCUSSION_MODULE.listPersonas()
                            .map(persona => persona.id);

                    const unknown =
                        personas.filter(id => !known.includes(id));

                    if (unknown.length > 0) {
                        sendJson(res, 400, {
                            error:
                                `unknown persona: ${unknown[0]}; available: ${known.join(", ")}`
                        });
                        return;
                    }

                    if (
                        state.status === "running" ||
                        (
                            state.discussion &&
                            state.discussion.status === "running"
                        )
                    ) {
                        sendJson(res, 409, {
                            error:
                                "a task or discussion is already running"
                        });
                        return;
                    }

                    /* the rounds continue in the background, their
                       events stream out through /api/events */

                    startDiscussion({ task, personas, maxRounds })
                        .catch(error => {
                            /*
                            | A rejection before the discussion was
                            | registered has nothing to mark failed;
                            | the request was already answered.
                            */
                            const discussion = state.discussion;

                            if (discussion && discussion.status !== "failed") {
                                discussion.status = "failed";
                                discussion.error = error.message;
                                discussion.finished_at = Date.now();

                                runtime.events.emit("discussion:error", {
                                    id: discussion.id,
                                    error: error.message
                                });
                            }
                        });

                    sendJson(res, 202, {
                        accepted: true,
                        id: state.discussion.id
                    });

                    return;
                }

                /* ------------------------------------------ approvals */

                if (
                    pathname.startsWith("/api/approvals/") &&
                    req.method === "POST"
                ) {

                    const id =
                        decodeURIComponent(
                            pathname.slice("/api/approvals/".length)
                        );

                    const body =
                        await readBody(req);

                    const resolved =
                        resolveApproval(
                            id,
                            body.approved === true
                        );

                    sendJson(
                        res,
                        resolved
                            ? 200
                            : 404,
                        {
                            resolved
                        }
                    );

                    return;
                }

                /* --------------------------------------------- control */

                if (
                    pathname === "/api/cancel" &&
                    req.method === "POST"
                ) {

                    state.stopRequested = true;

                    runtime.cancelRun("web console");

                    for (const id of approvalStore.pendingKeys()) {
                        resolveApproval(id, false);
                    }

                    sendJson(res, 200, { cancelled: true });

                    return;
                }

                if (
                    pathname === "/api/clear" &&
                    req.method === "POST"
                ) {

                    if (state.status === "running") {

                        sendJson(res, 409, {
                            error: "cannot clear while a task is running"
                        });

                        return;
                    }

                    state.cycles = 0;
                    state.lastPlanSignature = null;
                    state.history = [];
                    state.events = [];

                    /*
                    | The previous conversation is kept on disk; this
                    | starts the next one rather than erasing it.
                    */

                    saveSession();

                    state.session = sessions.emptySession();

                    calls.clear();
                    state.answer = null;
                    state.error = null;
                    state.status = "idle";

                    runtime.events.emit("session:cleared", {});

                    sendJson(res, 200, { cleared: true });

                    return;
                }

                if (
                    pathname === "/api/approval-mode" &&
                    req.method === "POST"
                ) {

                    const body =
                        await readBody(req);

                    try {

                        runtime.setApprovalMode(body.mode);

                    } catch (error) {

                        sendJson(res, 400, {
                            error: error.message
                        });

                        return;
                    }

                    runtime.events.emit("session:approval_mode", {
                        mode: body.mode
                    });

                    sendJson(res, 200, { mode: body.mode });

                    return;
                }

                /* --------------------------------------------- settings */

                if (
                    pathname === "/api/settings" &&
                    req.method === "GET"
                ) {

                    sendJson(res, 200, {
                        settings:
                            runtime.settings.all()
                    });

                    return;
                }

                if (
                    pathname === "/api/settings" &&
                    req.method === "POST"
                ) {

                    const body =
                        await readBody(req);

                    try {

                        const value =
                            body.reset === true
                                ? runtime.settings.reset(body.key)
                                : runtime.settings.set(body.key, body.value);

                        const definition =
                            runtime.settings.describe(
                                runtime.settings.definitionOf(body.key)
                            );

                        runtime.events.emit("settings:changed", {
                            key: body.key,
                            value: definition.value,
                            source: definition.source
                        });

                        sendJson(res, 200, {
                            setting: definition,

                            applied_to_running_agent:
                                state.status === "running"
                        });

                        void value;

                    } catch (error) {

                        sendJson(res, 400, {
                            error: error.message
                        });
                    }

                    return;
                }

                if (
                    pathname === "/api/stats" &&
                    req.method === "GET"
                ) {

                    sendJson(
                        res,
                        200,
                        await toolRuntime.telemetry.runtime_stats({
                            recent_limit: 10
                        })
                    );

                    return;
                }

                if (
                    pathname === "/api/metrics" &&
                    req.method === "GET"
                ) {

                    const snap = runtime.observability.snapshot();

                    if (!consoleAuth.allowsAllProjects(claims)) {

                        const allowed = {};

                        for (const [id, metrics] of Object.entries(snap.projects)) {

                            if (consoleAuth.allowsProject(claims, id)) {
                                allowed[id] = metrics;
                            }
                        }

                        snap.projects = allowed;
                    }

                    sendJson(res, 200, snap);
                    return;
                }

                if (
                    pathname === "/api/health" &&
                    req.method === "GET"
                ) {

                    const health = runtime.observability.health();

                    if (!consoleAuth.allowsAllProjects(claims)) {

                        const allowed = {};

                        for (const [id, item] of Object.entries(health.projects)) {

                            if (consoleAuth.allowsProject(claims, id)) {
                                allowed[id] = item;
                            }
                        }

                        health.projects = allowed;
                    }

                    sendJson(res, 200, health);
                    return;
                }

                /* ---------------------------------------------- static */

                if (
                    req.method === "GET" &&
                    (pathname === "/projects" || pathname.startsWith("/projects/"))
                ) {

                    /* Phase 11: the console owns /projects/:id so a
                       dashboard deep-link loads the same page. */
                    serveStatic(req, res, "/");
                    return;
                }

                if (req.method === "GET") {

                    serveStatic(req, res, pathname);

                    return;
                }

                sendJson(res, 405, { error: "method not allowed" });

            } catch (error) {

                sendJson(
                    res,
                    error.status || 500,
                    {
                        error: error.message
                    }
                );
            }
        };

    const server =
        http.createServer(handle);


    return {
        server,
        handle,

        state,
        startTask,
        snapshot,
        eventForClient,
        approvalStore,
        resolveApproval,
        sseHub,

        /* Exposed to the launcher/test harness, never sent by an API route. */
        token: consoleToken,

        listen(port, host) {

            return new Promise(resolve => {

                server.listen(
                    port,
                    host,
                    () => resolve(server.address())
                );
            });
        },

        close() {

            /* Do not leave MCP children/background processes behind. */
            toolRuntime.shutdown();

            sseHub.close();

            if (!server.listening) {
                return Promise.resolve();
            }

            return new Promise(resolve => server.close(resolve));
        }
    };
}


module.exports = {
    createServer
};
