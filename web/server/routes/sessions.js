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
        res
    } = request;

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
            sessions: sessions.listSessions()
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

        const found =
            id === state.session.id
                ? state.session
                : sessions.loadSession(id);

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

        const opened = activateSession(id);

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

        if (id === state.session.id) {

            sendJson(res, 409, {
                error: "cannot delete the open conversation"
            });

            return true;
        }

        sendJson(
            res,
            sessions.deleteSession(id) ? 200 : 404,
            { deleted: id }
        );

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
