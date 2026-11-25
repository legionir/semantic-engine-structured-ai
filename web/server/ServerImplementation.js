"use strict";

const crypto = require("crypto");
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
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

const {
    CONSOLE_COOKIE,
    newConsoleToken,
    parseCookies,
    requestToken,
    sameOrigin,
    RateLimiter
} = require("./Middleware");
const {
    sendJson,
    setConsoleCookie
} = require("./Response");
const { SseHub } = require("./SseHub");

const consoleAuth = require("../../agent/config/ConsoleAuth");
const { ApprovalStore } = require("../../agent/policy");
const ProcessOutputBus = require("../../agent/tools/process/ProcessOutputBus");
const { DiscussionService } = require("../../agent/discussion/DiscussionService");

const ROUTE_GROUPS = [
    require("./routes/auth-and-state"),
    require("./routes/mcp"),
    require("./routes/sessions"),
    require("./routes/tasks"),
    require("./routes/projects"),
    require("./routes/discussion"),
    require("./routes/control")
];


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
    const consolePasswordRequired =
        Boolean(runtime.settings && runtime.settings.get("AGENT_CONSOLE_PASSWORD_REQUIRED"));
    const consolePassword =
        String(runtime.settings && runtime.settings.get("AGENT_CONSOLE_PASSWORD") || "");
    const passwordSessionToken =
        consolePasswordRequired ? newConsoleToken() : null;

    if (consolePasswordRequired && consolePassword.length === 0) {
        throw new Error("AGENT_CONSOLE_PASSWORD_REQUIRED is enabled, but AGENT_CONSOLE_PASSWORD is empty.");
    }

    const toolRuntime =
        require(
            path.join(
                path.resolve(__dirname, "..", ".."),
                "agent",
                "tools"
            )
        );

    const requestReasoningEffort = body => {
        const value = body && body.reasoning_effort;
        if (value === undefined || value === null || value === "" || value === "inherit") return null;
        if (["low", "medium", "high", "xhigh"].includes(value)) return value;
        throw Object.assign(new Error("reasoning_effort must be inherit, low, medium, high, or xhigh"), { status: 400 });
    };

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
    /*
    | The limiter is a control-plane guard, so the production default (120
    | requests/minute) is kept. Callers that legitimately exceed it in one
    | window — the web suite drives ~125 API calls over a single shared
    | server — can raise it explicitly via options.apiRateLimit.
    */
    const apiRateLimiter =
        new RateLimiter({
            limit: Number.isInteger(options.apiRateLimit) && options.apiRateLimit > 0
                ? options.apiRateLimit
                : 120,
            windowMs: 60_000
        });
    const loginRateLimiter = new RateLimiter({ limit: 5, windowMs: 60_000 });

    function allowApiRequest(req) {
        return apiRateLimiter.allow(req);
    }

    function passwordSessionMatches(req) {
        const supplied = parseCookies(req.headers.cookie).structured_ai_console_password;
        if (typeof supplied !== "string" || supplied.length !== passwordSessionToken?.length) return false;
        return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(passwordSessionToken));
    }

    function passwordMatches(candidate) {
        if (typeof candidate !== "string") return false;
        const supplied = Buffer.from(candidate);
        const expected = Buffer.from(consolePassword);
        return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
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

    const broadcastProcessOutput = output => {
        sseHub.broadcast(
            { type: "process:output", ...output },
            (event, client) => eventForClient(event, client)
        );
    };
    ProcessOutputBus.on(ProcessOutputBus.outputEvent, broadcastProcessOutput);


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

                /*
                | Stamp the run that owns this pending approval. A run's
                | end-of-life cleanup may only resolve approvals it created;
                | otherwise a finishing run (whose finally is still draining
                | the git report / eventstore) silently auto-denies an
                | approval a newer run has already surfaced. `request` is the
                | same object the store holds, so this mutation is visible to
                | the sweep below.
                */
                request.ownerTurnId = state.currentTurnId || null;

                runtime.events.emit("approval:request", {
                    id: request.id,
                    agent: request.agent,
                    tool: request.tool,
                    reason: request.reason,
                    groups: request.groups,
                    arguments: args,
                    project_id: request.project_id,
                    turn_id: request.ownerTurnId
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
                    projectId,
                    ...(runOptions.reasoningEffort ? { reasoning_effort: runOptions.reasoningEffort } : {})
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
                        : {}),
                    ...(runOptions.reasoningEffort
                        ? { reasoning_effort: runOptions.reasoningEffort }
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

            /*
            | Nothing may stay pending once THIS run is over — but only the
            | approvals this run created. A finishing run used to resolve every
            | pending approval, including one a newer run had already surfaced
            | during the git-report/eventstore drain, silently auto-denying it.
            */

            for (const id of approvalStore.pendingKeys()) {
                const owned = approvalStore.getPending(id);
                if (owned && owned.ownerTurnId === turn_id) {
                    resolveApproval(id, false);
                }
            }

            runtime.events.emit("run:status", {
                status: state.status,
                answer: state.answer,
                error: state.error,
                turn_id
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
        projectContext = null,
        reasoningEffort = null
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
                ? createLlmCaller({ callAI: runtime.callAI, reasoningEffort })
                : createLlmCaller({ endpointFor: runtime.endpointFor, reasoningEffort });

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

    function wellEncodedPath(pathname) {

        try {
            decodeURIComponent(pathname);
            return true;
        } catch {
            return false;
        }
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


    /*
    | What the route groups (routes/*.js) share with this closure. Built once
    | the closure is complete; the groups read it per request.
    */
    const ctx = {
        DISCUSSION_MODULE,
        activateSession,
        approvalStore,
        calls,
        consolePasswordRequired,
        discussionService,
        eventForClient,
        loginRateLimiter,
        passwordMatches,
        passwordSessionToken,
        projectSlotBusy,
        requestReasoningEffort,
        resolveApproval,
        runtime,
        saveSession,
        sessions,
        slotView,
        snapshot,
        snapshotFor,
        sseHub,
        startDiscussion,
        startTask,
        state,
        toolRuntime
    };


    const handle =
        async (req, res) => {

            let url;

            try {

                url =
                    new URL(
                        req.url,
                        `http://${req.headers.host || "localhost"}`
                    );

            } catch {

                /* P0-4: a malformed Host header or request URL is a client error. */
                sendJson(res, 400, { error: "malformed request URL or Host header" });
                return;
            }

            const { pathname } = url;
            const isApiRequest = pathname.startsWith("/api/");

            if (isApiRequest && !allowApiRequest(req)) {
                sendJson(res, 429, { error: "console API rate limit exceeded" });
                return;
            }

            const authStatusRoute = pathname === "/auth/status" && req.method === "GET";
            const authLoginRoute = pathname === "/auth/login" && req.method === "POST";

            if (
                (isApiRequest || authLoginRoute) &&
                !sameOrigin(req.headers.origin, req.headers.host)
            ) {
                sendJson(res, 403, { error: "cross-origin console request refused" });
                return;
            }

            const passwordSessionAuthenticated =
                consolePasswordRequired && passwordSessionMatches(req);
            let suppliedToken;
            let claims;

            if (consolePasswordRequired) {
                const headerToken =
                    typeof req.headers.authorization === "string"
                        ? /^Bearer\s+(.+)$/i.exec(req.headers.authorization)?.[1]
                        : req.headers["x-console-token"];
                suppliedToken = headerToken || null;
                claims = passwordSessionAuthenticated
                    ? consoleAuth.masterClaims()
                    : consoleAuth.resolve(suppliedToken, consoleToken);
            } else {
                suppliedToken = requestToken(req, url);
                claims = consoleAuth.resolve(suppliedToken, consoleToken);
            }
            const authenticated = Boolean(claims);

            /*
            | When password login is enabled, browser access uses a distinct,
            | HttpOnly session cookie. Token query parameters and old console
            | cookies cannot silently skip the password screen.
            */
            if (!consolePasswordRequired && authenticated && url.searchParams.has("token")) {
                setConsoleCookie(res, CONSOLE_COOKIE, consoleToken);
            }

            if (
                pathname.startsWith("/api/") &&
                !authenticated &&
                pathname !== "/auth/status" &&
                pathname !== "/auth/login"
            ) {
                sendJson(res, 401, { error: "console authentication required" });
                return;
            }

            /*
            | P0-4: scoped tokens. Console-wide changes need the admin
            | (master) token; legacy endpoints that are not tied to a
            | project need a token allowed on every project.
            */
            const refuse = decision => {

                if (decision.ok) {
                    return false;
                }

                sendJson(res, decision.status, { error: decision.error });
                return true;
            };

            const requireAdmin = () =>
                refuse(consoleAuth.authorizeAdmin(claims));

            const requireUnscoped = permission =>
                refuse(consoleAuth.authorizeUnscoped(claims, permission));

            /* what the route groups read about this request */
            const request = {
                authLoginRoute,
                authStatusRoute,
                claims,
                passwordSessionAuthenticated,
                pathname,
                refuse,
                req,
                requireAdmin,
                requireUnscoped,
                res,
                url
            };

            try {

                /* the API routes, group by group, in a fixed order */
                for (const routes of ROUTE_GROUPS) {
                    if (await routes(ctx, request)) {
                        return;
                    }
                }

                /* ---------------------------------------------- static */

                /* P0-4: static and deep-link paths are not decoded by the
                   router, so a malformed escape must still be a 400. */
                if (req.method === "GET" && !wellEncodedPath(pathname)) {

                    sendJson(res, 400, { error: "malformed percent-encoding in request path" });
                    return;
                }

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
                    error instanceof URIError
                        ? 400
                        : error.status || 500,
                    {
                        error: error instanceof URIError
                            ? "malformed percent-encoding in request path"
                            : error.message
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

            ProcessOutputBus.removeListener(ProcessOutputBus.outputEvent, broadcastProcessOutput);

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
