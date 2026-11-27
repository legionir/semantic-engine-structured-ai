"use strict";

/*
|--------------------------------------------------------------------------
| Session and call routes
|--------------------------------------------------------------------------
|
| Saved conversations (list, start, read, open, delete) and the recorded
| tool calls.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const path = require("path");
const { sendJson } = require("../Response");


module.exports = async function SessionsRoutes(shared, request) {

    const {
        activateSession,
        calls,
        runtime,
        saveSession,
        sessions,
        state
    } = shared;

    const {
        pathname,
        req,
        requireUnscoped,
        res,
        url
    } = request;

    function projectCatalog() {

        const byId = new Map();

        try {
            const listed = runtime.projects && runtime.projects.registry().list();
            for (const item of listed || []) {
                byId.set(item.id, item);
            }
        } catch {
            /* project registry unavailable */
        }

        return byId;
    }

    function sessionRoots() {

        const roots = [{
            projectId: null,
            projectName: null,
            workspace: shared.workspaceRoot || null,
            root: undefined
        }];

        for (const project of projectCatalog().values()) {

            try {

                const context =
                    typeof runtime.resolveRunProjectContext === "function"
                        ? runtime.resolveRunProjectContext({ projectId: project.id })
                        : null;

                if (context && context.dataRoot) {
                    roots.push({
                        projectId: project.id,
                        projectName: project.name || project.id,
                        workspace: context.workspaceRoot || project.rootPath || null,
                        root: context.dataRoot
                    });
                }

            } catch {
                /* project root unavailable */
            }
        }

        const seen = new Set();

        return roots.filter(item => {

            let dir;

            try {
                dir = path.resolve(sessions.sessionsDirectory(item.root));
            } catch {
                return false;
            }

            if (seen.has(dir)) {
                return false;
            }

            seen.add(dir);
            return true;
        });
    }

    function annotateSummary(item, origin, projectsById) {

        const projectId = item.project_id ?? origin.projectId ?? null;
        const project = projectId ? projectsById.get(projectId) : null;
        const workspace =
            item.workspace ||
            project?.rootPath ||
            origin.workspace ||
            shared.workspaceRoot ||
            null;
        const projectName =
            item.project_name ||
            project?.name ||
            origin.projectName ||
            null;

        return {
            ...item,
            project_id: projectId,
            ...(projectName ? { project_name: projectName } : {}),
            ...(workspace ? { workspace } : {})
        };
    }

    function collectSessions() {

        const projectsById = projectCatalog();
        const byId = new Map();

        for (const origin of sessionRoots()) {

            let listed = [];

            try {
                listed = sessions.listSessions(origin.root);
            } catch {
                listed = [];
            }

            for (const item of listed) {

                const annotated = annotateSummary(item, origin, projectsById);
                const prev = byId.get(annotated.id);

                if (
                    !prev ||
                    String(annotated.updated_at || "").localeCompare(String(prev.updated_at || "")) > 0
                ) {
                    byId.set(annotated.id, annotated);
                }
            }
        }

        return [...byId.values()].sort(
            (left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
        );
    }

    function findSessionRoot(id, requestedProjectId) {

        const roots = sessionRoots();

        if (requestedProjectId) {
            const match = roots.find(item => item.projectId === requestedProjectId);
            if (match && sessions.loadSession(id, match.root)) {
                return match;
            }
        }

        for (const origin of roots) {
            if (sessions.loadSession(id, origin.root)) {
                return origin;
            }
        }

        return null;
    }

    /* ------------------------------------------- sessions */

    if (
        pathname === "/api/sessions" &&
        req.method === "GET"
    ) {

        if (requireUnscoped("project:read")) {
            return true;
        }

        sendJson(res, 200, {
            current: state.session.id,
            sessions: collectSessions()
        });

        return true;
    }

    if (
        pathname === "/api/sessions" &&
        req.method === "POST"
    ) {

        if (requireUnscoped("project:write")) {
            return true;
        }

        if (state.status === "running") {

            sendJson(res, 409, {
                error: "cannot switch conversation while a task is running"
            });

            return true;
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

        /* the project the foreground holds starts afresh with it */
        shared.conversations.syncForeground();

        runtime.events.emit("session:switched", {
            session: sessions.summarise(state.session)
        });

        sendJson(res, 201, {
            session: sessions.summarise(state.session)
        });

        return true;
    }

    if (
        pathname.startsWith("/api/sessions/") &&
        req.method === "GET"
    ) {

        if (requireUnscoped("project:read")) {
            return true;
        }

        const id =
            decodeURIComponent(
                pathname.slice("/api/sessions/".length)
            );
        const requestedProjectId = url?.searchParams?.get("projectId") || null;

        let found = null;
        if (id === state.session.id) {
            found = state.session;
        } else {
            const location = findSessionRoot(id, requestedProjectId);
            found = location ? sessions.loadSession(id, location.root) : null;
        }

        if (!found) {

            sendJson(res, 404, {
                error: "unknown session"
            });

            return true;
        }

        sendJson(res, 200, {
            session: found,
            current: state.session.id
        });

        return true;
    }

    if (
        pathname.startsWith("/api/sessions/") &&
        req.method === "POST"
    ) {

        if (requireUnscoped("project:write")) {
            return true;
        }

        const id =
            decodeURIComponent(
                pathname.slice("/api/sessions/".length)
            );
        const requestedProjectId = url?.searchParams?.get("projectId") || null;

        if (state.status === "running") {

            sendJson(res, 409, {
                error: "cannot switch conversation while a task is running"
            });

            return true;
        }

        /*
        | Opening a conversation continues it: the model
        | history, the events and the recorded calls all come
        | back, so the next task sees what the last one did.
        */

        saveSession();

        const location = findSessionRoot(id, requestedProjectId);
        const opened = location ? activateSession(id, location.root) : null;

        if (!opened) {

            sendJson(res, 404, {
                error: "unknown session"
            });

            return true;
        }

        sendJson(res, 200, {
            session: opened
        });

        return true;
    }

    if (
        pathname.startsWith("/api/sessions/") &&
        req.method === "DELETE"
    ) {

        if (requireUnscoped("project:write")) {
            return true;
        }

        const id =
            decodeURIComponent(
                pathname.slice("/api/sessions/".length)
            );
        const requestedProjectId = url?.searchParams?.get("projectId") || null;

        if (id === state.session.id) {

            sendJson(res, 409, {
                error: "cannot delete the open conversation"
            });

            return true;
        }

        const location = findSessionRoot(id, requestedProjectId);
        if (location && sessions.deleteSession(id, location.root)) {
            sendJson(res, 200, { deleted: id });
        } else {
            sendJson(res, 404, { error: "unknown session" });
        }

        return true;
    }

    /* ---------------------------------------------- calls */

    if (
        pathname === "/api/calls" &&
        req.method === "GET"
    ) {

        if (requireUnscoped("project:read")) {
            return true;
        }

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

        return true;
    }

    if (
        pathname.startsWith("/api/calls/") &&
        req.method === "GET"
    ) {

        if (requireUnscoped("project:read")) {
            return true;
        }

        const key =
            decodeURIComponent(
                pathname.slice("/api/calls/".length)
            );

        const call = calls.get(key);

        if (!call) {

            sendJson(res, 404, {
                error: "unknown call"
            });

            return true;
        }

        sendJson(res, 200, { call });

        return true;
    }

    return false;
};
