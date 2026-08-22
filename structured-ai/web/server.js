"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
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

const PUBLIC_DIR =
    path.join(__dirname, "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

const CONSOLE_COOKIE = "structured_ai_console";


function newConsoleToken() {

    return crypto.randomBytes(24).toString("base64url");
}


function parseCookies(header) {

    return String(header || "")
        .split(";")
        .map(part => part.trim().split("="))
        .filter(parts => parts.length >= 2)
        .reduce((cookies, [key, ...value]) => {
            cookies[key] = decodeURIComponent(value.join("="));
            return cookies;
        }, {});
}


function tokenMatches(candidate, expected) {

    if (typeof candidate !== "string" || candidate.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(candidate),
        Buffer.from(expected)
    );
}


function requestToken(req, url) {

    const authorization =
        typeof req.headers.authorization === "string"
            ? /^Bearer\s+(.+)$/i.exec(req.headers.authorization)?.[1]
            : null;

    return (
        authorization ||
        (typeof req.headers["x-console-token"] === "string"
            ? req.headers["x-console-token"]
            : null) ||
        url.searchParams.get("token") ||
        parseCookies(req.headers.cookie)[CONSOLE_COOKIE] ||
        null
    );
}


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
                path.resolve(__dirname, ".."),
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

        finishedAt: null
    };

    const clients = new Set();
    const requestWindows = new Map();
    const API_RATE_LIMIT = 120;
    const API_RATE_WINDOW_MS = 60_000;

    function allowApiRequest(req) {
        const key = req.socket.remoteAddress || "unknown";
        const now = Date.now();
        const current = requestWindows.get(key);

        if (!current || now >= current.resetAt) {
            requestWindows.set(key, { count: 1, resetAt: now + API_RATE_WINDOW_MS });
            if (requestWindows.size > 10_000) requestWindows.clear();
            return true;
        }

        current.count++;
        return current.count <= API_RATE_LIMIT;
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

        const payload =
            `data: ${JSON.stringify(event)}\n\n`;

        for (const client of clients) {

            try {

                client.write(payload);

            } catch {

                clients.delete(client);
            }
        }
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
    | An approval becomes a pending question the browser can answer.
    */

    runtime.setApprovalHandler((evaluation, args) => {

        const id =
            `approval_${state.approvals.size + 1}_${Date.now()}`;

        return new Promise(resolve => {

            const request = {
                id,

                agent:
                    evaluation.agent,

                tool:
                    evaluation.tool,

                reason:
                    evaluation.reason,

                groups:
                    evaluation.groups,

                arguments:
                    args,

                requested_at:
                    Date.now(),

                resolve
            };

            state.approvals.set(id, request);

            runtime.events.emit("approval:request", {
                id,
                agent: request.agent,
                tool: request.tool,
                reason: request.reason,
                groups: request.groups,
                arguments: args
            });
        });
    });


    function resolveApproval(id, approved) {

        const request =
            state.approvals.get(id);

        if (!request) {
            return false;
        }

        state.approvals.delete(id);

        request.resolve(approved);

        runtime.events.emit("approval:resolved", {
            id,
            tool: request.tool,
            approved
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
                [...state.approvals.values()].map(
                    request => ({
                        id: request.id,
                        agent: request.agent,
                        tool: request.tool,
                        reason: request.reason,
                        arguments: request.arguments
                    })
                ),

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


    async function startTask(task) {

        if (state.status === "running") {

            throw Object.assign(
                new Error("a task is already running"),
                { status: 409 }
            );
        }

        state.status = "running";
        state.stopRequested = false;

        if (state.lastPlanSignature === null) {

            const before =
                runtime.currentPlanSummary();

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
                        state.history
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

            runtime.events.emit("run:error", {
                message: error.message,
                cancelled: runtime.isRunCancelled()
            });

            addMessage({
                role: "assistant",
                kind: "error",
                turn_id,
                content: error.message
            });

        } finally {

            state.finishedAt = Date.now();

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
                runtime.currentPlanSummary();

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

                setTimeout(
                    () =>
                        startTask(
                            "Continue the plan: read it, take the next open step, verify it, and record the result."
                        ).catch(() => {}),
                    50
                );
            }

            /* nothing may stay pending once the run is over */

            for (const id of [...state.approvals.keys()]) {
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


    function readBody(req) {

        return new Promise((resolve, reject) => {

            let body = "";
            let size = 0;
            let rejected = false;

            const rejectTooLarge = () => {

                if (rejected) {
                    return;
                }

                rejected = true;
                req.destroy();
                reject(new Error("request body is too large"));
            };

            req.on("data", chunk => {

                if (rejected) {
                    return;
                }

                size += chunk.length;

                if (size > 1_000_000) {
                    rejectTooLarge();
                    return;
                }

                body += chunk.toString("utf8");
            });

            req.on("end", () => {

                if (rejected) {
                    return;
                }

                if (body.trim() === "") {

                    resolve({});

                    return;
                }

                try {

                    resolve(JSON.parse(body));

                } catch {

                    reject(new Error("request body is not valid JSON"));
                }
            });

            req.on("error", error => {

                if (!rejected) {
                    reject(error);
                }
            });
        });
    }


    function sendJson(res, status, value) {

        const payload =
            JSON.stringify(value);

        res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "content-length": Buffer.byteLength(payload)
        });

        res.end(payload);
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


    const server =
        http.createServer(async (req, res) => {

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

            if (isApiRequest && req.headers.origin) {
                let sameOrigin = false;
                try {
                    sameOrigin = new URL(req.headers.origin).host === req.headers.host;
                } catch {
                    sameOrigin = false;
                }
                if (!sameOrigin) {
                    sendJson(res, 403, { error: "cross-origin console request refused" });
                    return;
                }
            }

            const suppliedToken = requestToken(req, url);
            const authenticated = tokenMatches(suppliedToken, consoleToken);

            /*
            | Static assets remain public so the browser can load the UI.
            | Every API, SSE and control-plane endpoint requires the token.
            | A token in the launch URL is exchanged for an HttpOnly cookie
            | so normal browser fetch/EventSource calls do not need custom
            | headers.
            */
            if (authenticated && url.searchParams.has("token")) {
                res.setHeader(
                    "set-cookie",
                    `${CONSOLE_COOKIE}=${encodeURIComponent(consoleToken)}; HttpOnly; SameSite=Strict; Path=/`
                );
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

                    res.writeHead(200, {
                        "content-type": "text/event-stream; charset=utf-8",
                        "cache-control": "no-cache, no-transform",
                        connection: "keep-alive",
                        "x-accel-buffering": "no"
                    });

                    res.write(
                        `data: ${
                            JSON.stringify({
                                type: "snapshot",
                                snapshot: snapshot()
                            })
                        }\n\n`
                    );

                    clients.add(res);

                    const keepAlive =
                        setInterval(
                            () => res.write(": ping\n\n"),
                            15000
                        );

                    req.on("close", () => {

                        clearInterval(keepAlive);

                        clients.delete(res);
                    });

                    return;
                }

                /* ---------------------------------------------- state */

                if (
                    pathname === "/api/state" &&
                    req.method === "GET"
                ) {

                    sendJson(res, 200, snapshot());

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

                        await runtime.policyEngine.enforce(
                            "mcp_add",
                            body,
                            "web_console"
                        );

                        const added =
                            await toolRuntime.mcp._manager.add(
                                body.name,
                                body,
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
                                wave: call.wave,
                                iteration: call.iteration,
                                depends_on: call.depends_on,
                                status: call.status,
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
                    const root = runtime.workspaceRoot;
                    const indexPath = path.join(root, ".agent", "semantic", "project-index.json");

                    let nodes = [];
                    let edges = [];
                    let projectName = path.basename(root);

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

                    if (state.status === "running") {

                        sendJson(res, 409, {
                            error: "a task is already running"
                        });

                        return;
                    }

                    /* the run continues in the background */

                    startTask(task).catch(() => {});

                    sendJson(res, 202, { accepted: true });

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

                    for (const id of [...state.approvals.keys()]) {
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

                /* ---------------------------------------------- static */

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
        });


    return {
        server,

        state,

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

            for (const client of clients) {
                client.end();
            }

            return new Promise(resolve => server.close(resolve));
        }
    };
}


module.exports = {
    createServer
};
