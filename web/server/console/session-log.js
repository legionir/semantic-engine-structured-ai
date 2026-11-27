"use strict";

/*
|--------------------------------------------------------------------------
| Session log
|--------------------------------------------------------------------------
|
| The conversation as a file under .agent/sessions: saving, appending
| messages, the git report of a run and switching to another session.
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/

const { execFile } = require("child_process");
const childEnvironment = require("../../../agent/tools/process/ChildEnvironment");
const { withoutImages } = require("../../../agent/runtime/ImageChannel");


module.exports = function createSessionLog(shared) {

    const {
        calls,
        runtime,
        state
    } = shared;

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

        state.session.history = withoutImages(state.history);

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

        /* a foreground project run keeps the project's own transcript too,
           and its stream receives the message in full (P1-03) */
        if (state.projectId && shared.conversations) {
            shared.conversations.mirrorMessage(state.projectId, message);
        }

        runtime.events.emit("session:message", {
            session: state.session.id,
            ...(state.projectId ? { project_id: state.projectId } : {}),
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
                    env: childEnvironment.build({ GIT_TERMINAL_PROMPT: "0" }),
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


    /*
    | Options name another conversation: a project's workspace, its turn and
    | its own transcript (a background turn). Without them it is the
    | foreground run in the active workspace, as it always was.
    */
    async function recordGitReport(options = {}) {

        const runtimeContext = options.workspace ? null : runtime.createRuntimeContext();
        const workspace =
            options.workspace ||
            runtimeContext?.runtime?.workspace_root ||
            runtimeContext?.workspace?.root ||
            runtimeContext?.workspace_root;

        const projectId =
            options.projectId === undefined
                ? state.projectId
                : options.projectId;

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
            turn_id: options.turnId || state.currentTurnId || null,
            ...(projectId ? { project_id: projectId } : {})
        });

        (options.addMessage || addMessage)({
            role: "system",
            kind: "git-report",
            content: report.text,
            branch: report.branch
        });

        return report;
    }


    function activateSession(id, root) {

        const loaded =
            sessions.loadSession(id, root);

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

        if (shared.conversations) {
            shared.conversations.syncForeground();
        }

        return loaded;
    }

    /*
    | "New conversation" on the foreground: the previous conversation is kept
    | on disk; this starts the next one rather than erasing it. The project
    | the foreground holds starts afresh too. False while a task runs.
    */
    function clearForeground() {

        if (state.status === "running") {
            return false;
        }

        state.cycles = 0;
        state.lastPlanSignature = null;
        state.history = [];
        state.events = [];

        saveSession();

        state.session = sessions.emptySession();

        calls.clear();
        state.answer = null;
        state.error = null;
        state.status = "idle";

        const conv =
            state.projectId && shared.conversations
                ? shared.conversations.get(state.projectId)
                : null;

        if (conv && !conv.background) {
            shared.conversations.resetConversation(state.projectId);
        }

        runtime.events.emit("session:cleared", {
            ...(state.projectId ? { project_id: state.projectId } : {})
        });

        return true;
    }


    return {
        clearForeground,
        sessions,
        sessionsEnabled,
        saveSession,
        addMessage,
        executionMessageKey,
        recordGitReport,
        activateSession
    };
};
