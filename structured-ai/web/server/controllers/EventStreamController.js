"use strict";

/*
|--------------------------------------------------------------------------
| Web console stream and call routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Three routes: the event stream a browser subscribes to, the list of
| recorded calls, and one recorded call in full.
|
| The stream writes its snapshot frame *before* the client joins the hub,
| and joins it after: a client added first could receive a live event
| before the snapshot and draw the same event twice. That order is the
| original's and it is load-bearing.
|
| The 15s keep-alive comment and the `req.on("close")` detach moved with the
| body. Without the ping a proxy quietly cuts an idle console; without the
| detach a closed tab is a client that never goes away and every event is
| written into a socket nobody reads.
|
| The project-scoped stream lives in ProjectController instead, on purpose:
| it is reached through /api/projects/:id/events, and the prefix route that
| owns that path answers 404 for everything it does not know.
|--------------------------------------------------------------------------
*/

const { callSummaries } = require("../serializers/SessionSerializer");

const consoleAuth = require("../../../agent/lib/consoleAuth");

function createEventStreamController(ctx) {

    const { calls, clients } = ctx;

    /* ---------------------------------------------- events */

    async function openStream(req, res, url, pathname, claims) {

        const filterProjectId =
            url.searchParams.get("projectId");

        if (filterProjectId) {

            const allowed =
                consoleAuth.authorize(claims, {
                    projectId: filterProjectId,
                    permission: "project:read"
                });

            if (!allowed.ok) {

                ctx.sendJson(res, allowed.status, { error: allowed.error });
                return;
            }
        }

        const client = {
            res,
            projectId: filterProjectId || null,
            claims
        };

        res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no"
        });

        const liveEvents =
            ctx.snapshot().events
                .map(event => ctx.eventForClient(event, client))
                .filter(Boolean);

        const snap = {
            ...ctx.snapshotFor(claims),
            events: liveEvents
        };

        res.write(
            `data: ${
                JSON.stringify({
                    type: "snapshot",
                    snapshot: snap
                })
            }\n\n`
        );

        clients.add(client);

        const keepAlive =
            setInterval(
                () => res.write(": ping\n\n"),
                15000
            );

        req.on("close", () => {

            clearInterval(keepAlive);

            clients.delete(client);
        });

    }

    /* ---------------------------------------------- calls */

    async function listCalls(req, res, url, pathname, claims) {

        ctx.sendJson(res, 200, {
            calls:
callSummaries([...calls.values()])
        });

    }

    async function readCall(req, res, url, pathname, claims) {

        const key =
            decodeURIComponent(
                pathname.slice("/api/calls/".length)
            );

        const call = calls.get(key);

        if (!call) {

            ctx.sendJson(res, 404, {
                error: "unknown call"
            });

            return;
        }

        ctx.sendJson(res, 200, { call });

    }

    return {
        openStream,
        listCalls,
        readCall
    };
}

module.exports = { createEventStreamController };
