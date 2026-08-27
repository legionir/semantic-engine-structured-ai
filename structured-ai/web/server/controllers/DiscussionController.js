"use strict";

/*
|--------------------------------------------------------------------------
| Web console discussion routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The persona list, and starting a discussion.
|
| Validation lives here and the run does not: personas are filtered,
| trimmed and checked against the registry, `max_rounds` is bounded to
| 1..10, and every refusal is a 400 a caller can act on. Only then does the
| service start, and it starts in the background — the rounds stream out
| through /api/events, which is what makes the live panel possible.
|
| The rejection handler on the started run marks the discussion failed *if*
| one was registered; a failure before registration has nothing to mark and
| the request has already been answered. That asymmetry is in the original
| and moved with it.
|--------------------------------------------------------------------------
*/

const { DISCUSSION_MODULE } = require("../services/DiscussionService");

function createDiscussionController(ctx) {

    const { runtime, state } = ctx;

    /* ----------------------------------------- discussion */

    async function personas(req, res, url, pathname, claims) {

        ctx.sendJson(res, 200, {
            personas: DISCUSSION_MODULE.listPersonas()
        });

    }

    async function start(req, res, url, pathname, claims) {

        const body =
            await ctx.readBody(req);

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
            ctx.sendJson(res, 400, { error: "task is required" });
            return;
        }

        if (personas.length === 0) {
            ctx.sendJson(res, 400, {
                error:
                    "personas is required: a non-empty array of persona ids"
            });
            return;
        }

        if (maxRounds < 1 || maxRounds > 10) {
            ctx.sendJson(res, 400, {
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
            ctx.sendJson(res, 400, {
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
            ctx.sendJson(res, 409, {
                error:
                    "a task or discussion is already running"
            });
            return;
        }

        /* the rounds continue in the background, their
           events stream out through /api/events */

        ctx.startDiscussion({ task, personas, maxRounds })
            .catch(error => {
                /*
                | A rejection before the discussion was
                | registered has nothing to mark failed;
                | the request was already answered.
                */
                const discussion = state.discussion;

                if (discussion) {
                    discussion.status = "failed";
                    discussion.error = error.message;
                    discussion.finished_at = Date.now();

                    runtime.events.emit("discussion:error", {
                        id: discussion.id,
                        error: error.message
                    });
                }
            });

        ctx.sendJson(res, 202, {
            accepted: true,
            id: state.discussion.id
        });

    }

    return {
        personas,
        start
    };
}

module.exports = { createDiscussionController };
