"use strict";

/*
|--------------------------------------------------------------------------
| Interrupted conversations (roadmap P1-06)
|--------------------------------------------------------------------------
|
| A run lives in the server, not in the browser: closing the tab never
| stopped it. A restart did, and silently: the conversation came back as
| whatever was saved last. Now:
|
|   - turns are checkpointed while they run (turn-checkpoint.js), so a
|     session still marked "running" when the console starts was cut off;
|   - on start, every such session (the default workspace's and each
|     registered project's) is marked "interrupted" and listed here;
|   - Continue loads the conversation back, with the history the run had
|     built (its tool calls and their results), into the conversation it
|     belongs to and starts a turn that tells the agent what happened and
|     to carry on; Dismiss just marks it as stopped.
|
| Part of the console server's closure (ServerImplementation): created
| after the task runner, whose startTask a continued turn goes through.
*/

const path = require("path");

const { resumeTask } = require("../../../agent/persistence/SessionResume");


module.exports = function createInterruptedRuns(shared) {

    const {
        activateSession,
        conversations,
        runtime,
        state
    } = shared;

    /* id → { id, project_id, root, title, task, interrupted_at, updated_at } */
    const interrupted = new Map();


    /* where sessions are kept: the default workspace, then each project's data root */
    function sessionRoots() {

        const roots = [{ projectId: null, root: undefined }];

        let projects = [];

        try {
            projects = runtime.projects.registry().list();
        } catch {
            projects = [];
        }

        for (const project of projects) {

            try {

                const context = runtime.resolveRunProjectContext({ projectId: project.id });

                if (context && context.dataRoot) {
                    roots.push({ projectId: project.id, root: context.dataRoot });
                }

            } catch {
                /* a project whose root is gone has no sessions to recover */
            }
        }

        const seen = new Set();

        return roots.filter(item => {

            let directory;

            try {
                directory = path.resolve(runtime.sessions.sessionsDirectory(item.root));
            } catch {
                return false;
            }

            if (seen.has(directory)) {
                return false;
            }

            seen.add(directory);
            return true;
        });
    }


    function scan() {

        if (runtime.settings.get("SESSIONS_ENABLED") !== true) {
            return [];
        }

        const found = [];

        for (const { projectId, root } of sessionRoots()) {

            let listed = [];

            try {
                listed = runtime.sessions.listSessions(root);
            } catch {
                listed = [];
            }

            for (const summary of listed) {

                if (summary.status !== "running" && summary.status !== "interrupted") {
                    continue;
                }

                const session = runtime.sessions.loadSession(summary.id, root);

                if (!session) {
                    continue;
                }

                if (session.status === "running") {

                    session.status = "interrupted";
                    session.interrupted_at = new Date().toISOString();

                    try {
                        runtime.sessions.saveSession(session, root);
                    } catch {
                        /* listed anyway; the file says "running" until it is continued */
                    }
                }

                const entry = {
                    id: session.id,
                    project_id: session.project_id || projectId || null,
                    background_root: root ? projectId : null,
                    root,
                    title: session.title || runtime.sessions.titleFrom(session),
                    task: session.task || null,
                    interrupted_at: session.interrupted_at || session.updated_at,
                    updated_at: session.updated_at,
                    messages: session.messages.length
                };

                interrupted.set(entry.id, entry);
                found.push(entry);
            }
        }

        if (found.length > 0) {

            runtime.events.emit("session:interrupted", {
                sessions: found.map(entry => ({ id: entry.id, project_id: entry.project_id, title: entry.title }))
            });
        }

        return found;
    }


    function view(entry) {

        const { root, ...rest } = entry;

        void root;

        return rest;
    }


    function list(allow = () => true) {

        return [...interrupted.values()]
            .filter(entry => allow(entry.project_id))
            .map(view);
    }


    function get(id) {

        const entry = interrupted.get(id);

        return entry ? view(entry) : null;
    }


    function failure(message, status) {

        return Object.assign(new Error(message), { status });
    }


    /*
    | Loads the conversation where its next turn will run and starts that
    | turn. A session saved by the foreground goes back to the foreground;
    | one saved by a project's background conversation goes back there.
    */
    async function resume(id, options = {}) {

        const entry = interrupted.get(id);

        if (!entry) {
            throw failure(`no interrupted conversation ${id}`, 404);
        }

        const projectId = entry.project_id;
        const session = runtime.sessions.loadSession(entry.id, entry.root);

        if (!session) {
            interrupted.delete(id);
            throw failure(`the conversation ${id} is no longer stored`, 404);
        }

        if (projectId && conversations.busy(projectId)) {
            throw failure(`project ${projectId} already has a run in progress; continue when it is done`, 409);
        }

        const task = resumeTask(session, options.message);

        const toForeground =
            !entry.background_root && state.status !== "running";

        if (toForeground) {

            if (!activateSession(entry.id)) {
                throw failure(`the conversation ${id} could not be opened`, 404);
            }

            state.projectId = projectId;

        } else {

            if (!projectId) {
                throw failure("a task is already running; continue when it is done", 409);
            }

            /* the project's own conversation, continued in the background */
            const conv = conversations.ensure(projectId);

            Object.assign(conv, {
                session,
                messages: session.messages.slice(),
                events: session.events.slice(),
                history: Array.isArray(session.history) ? session.history : [],
                background: true
            });
        }

        interrupted.delete(id);

        /* not awaited: the turn runs on its own, the answer is the start */
        const started =
            shared.startTask(task, {
                ...(projectId ? { projectId } : {}),
                kind: "resume"
            });

        started.catch(() => {});

        /* a refusal (409) is reported, not swallowed */
        await Promise.race([
            started,
            new Promise(resolve => setTimeout(resolve, 20))
        ]);

        return {
            ok: true,
            id: entry.id,
            project_id: projectId,
            where: toForeground ? "foreground" : "background"
        };
    }


    function dismiss(id) {

        const entry = interrupted.get(id);

        if (!entry) {
            throw failure(`no interrupted conversation ${id}`, 404);
        }

        interrupted.delete(id);

        const session = runtime.sessions.loadSession(entry.id, entry.root);

        if (session && session.status === "interrupted") {

            session.status = "cancelled";

            try {
                runtime.sessions.saveSession(session, entry.root);
            } catch {
                /* the list no longer shows it either way */
            }
        }

        return { ok: true, id: entry.id };
    }


    scan();


    return {
        interrupted: {
            dismiss,
            get,
            list,
            resume,
            scan
        }
    };
};
