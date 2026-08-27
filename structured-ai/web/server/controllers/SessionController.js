"use strict";

/*
|--------------------------------------------------------------------------
| Web console conversation routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| List, start, read, open and delete a conversation.
|
| Every mutation refuses with 409 while a task is running — wording
| included, verbatim — because switching the conversation under a live run
| would write its messages into whichever session is opened next.
|
| Opening a conversation continues it: model history, events and recorded
| calls all come back, so the next task sees what the last one did. Reading
| one answers from the live session when the id is the open one and from
| disk otherwise, because the file is always a turn behind.
|
| Deleting the open conversation is refused rather than allowed and then
| re-created by the next save: the id a browser holds would stop existing
| under it.
|--------------------------------------------------------------------------
*/

function createSessionController(ctx) {

    const { runtime, state, calls, sessions } = ctx;

    /* ------------------------------------------- sessions */

    async function list(req, res, url, pathname, claims) {

        ctx.sendJson(res, 200, {
            current: state.session.id,
            sessions: sessions.listSessions()
        });

    }

    async function create(req, res, url, pathname, claims) {

        if (state.status === "running") {

            ctx.sendJson(res, 409, {
                error: "cannot switch conversation while a task is running"
            });

            return;
        }

        ctx.saveSession();

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

        ctx.sendJson(res, 201, {
            session: sessions.summarise(state.session)
        });

    }

    async function read(req, res, url, pathname, claims) {

        const id =
            decodeURIComponent(
                pathname.slice("/api/sessions/".length)
            );

        const found =
            id === state.session.id
                ? state.session
                : sessions.loadSession(id);

        if (!found) {

            ctx.sendJson(res, 404, {
                error: "unknown session"
            });

            return;
        }

        ctx.sendJson(res, 200, {
            session: found,
            current: state.session.id
        });

    }

    async function open(req, res, url, pathname, claims) {

        const id =
            decodeURIComponent(
                pathname.slice("/api/sessions/".length)
            );

        if (state.status === "running") {

            ctx.sendJson(res, 409, {
                error: "cannot switch conversation while a task is running"
            });

            return;
        }

        /*
        | Opening a conversation continues it: the model
        | history, the events and the recorded calls all come
        | back, so the next task sees what the last one did.
        */

        ctx.saveSession();

        const opened = ctx.activateSession(id);

        if (!opened) {

            ctx.sendJson(res, 404, {
                error: "unknown session"
            });

            return;
        }

        ctx.sendJson(res, 200, {
            session: opened
        });

    }

    async function remove(req, res, url, pathname, claims) {

        const id =
            decodeURIComponent(
                pathname.slice("/api/sessions/".length)
            );

        if (id === state.session.id) {

            ctx.sendJson(res, 409, {
                error: "cannot delete the open conversation"
            });

            return;
        }

        ctx.sendJson(
            res,
            sessions.deleteSession(id) ? 200 : 404,
            { deleted: id }
        );

    }

    return {
        list,
        create,
        read,
        open,
        remove
    };
}

module.exports = { createSessionController };
