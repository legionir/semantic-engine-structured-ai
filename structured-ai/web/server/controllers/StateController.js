"use strict";

/*
|--------------------------------------------------------------------------
| Web console status routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Everything an operator reads without asking the runtime a question: the
| snapshot, the tool telemetry, the gateway metrics and health.
|
| `/api/state` is one line because the snapshot has three consumers — a
| reload, a reconnecting stream and a session replay — and they must not be
| able to differ.
|
| Metrics and health filter their per-project maps by the token's claims
| before answering. What a scoped token loses is the *key*, not a redacted
| value: an absent project and a masked one are different claims, and the
| console must not be able to make the first look like the second.
|--------------------------------------------------------------------------
*/

const consoleAuth = require("../../../agent/lib/consoleAuth");

function createStateController(ctx) {

    const { runtime, toolRuntime } = ctx;

    /* ---------------------------------------------- state */

    async function readState(req, res, url, pathname, claims) {

        ctx.sendJson(res, 200, ctx.snapshotFor(claims));

    }

    async function stats(req, res, url, pathname, claims) {

        ctx.sendJson(
            res,
            200,
            await toolRuntime.telemetry.runtime_stats({
                recent_limit: 10
            })
        );

    }

    async function metrics(req, res, url, pathname, claims) {

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

        ctx.sendJson(res, 200, snap);

    }

    async function health(req, res, url, pathname, claims) {

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

        ctx.sendJson(res, 200, health);

    }

    return {
        readState,
        stats,
        metrics,
        health
    };
}

module.exports = { createStateController };
