"use strict";

/*
|--------------------------------------------------------------------------
| Discussion routes
|--------------------------------------------------------------------------
|
| The persona list and starting a discussion in the default workspace.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");


module.exports = async function DiscussionRoutes(shared, request) {

    const {
        DISCUSSION_MODULE,
        requestReasoningEffort,
        runtime,
        startDiscussion,
        state
    } = shared;

    const {
        pathname,
        req,
        requireUnscoped,
        res
    } = request;

    /* ----------------------------------------- discussion */

    if (
        pathname === "/api/discussion/personas" &&
        req.method === "GET"
    ) {

        sendJson(res, 200, {
            personas: DISCUSSION_MODULE.listPersonas()
        });

        return true;
    }

    if (
        pathname === "/api/discussion" &&
        req.method === "POST"
    ) {

        if (requireUnscoped("project:write")) {
            return true;
        }

        const body =
            await readBody(req);

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
        let reasoningEffort;
        try {
            reasoningEffort = requestReasoningEffort(body);
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message });
            return true;
        }

        if (task === "") {
            sendJson(res, 400, { error: "task is required" });
            return true;
        }

        if (personas.length === 0) {
            sendJson(res, 400, {
                error:
                    "personas is required: a non-empty array of persona ids"
            });
            return true;
        }

        if (maxRounds < 1 || maxRounds > 10) {
            sendJson(res, 400, {
                error: "max_rounds must be between 1 and 10"
            });
            return true;
        }

        const known =
            DISCUSSION_MODULE.listPersonas()
                .map(persona => persona.id);

        const unknown =
            personas.filter(id => !known.includes(id));

        if (unknown.length > 0) {
            sendJson(res, 400, {
                error:
                    `unknown persona: ${unknown[0]}; available: ${known.join(", ")}`
            });
            return true;
        }

        if (
            state.status === "running" ||
            (
                state.discussion &&
                state.discussion.status === "running"
            )
        ) {
            sendJson(res, 409, {
                error:
                    "a task or discussion is already running"
            });
            return true;
        }

        /* the rounds continue in the background, their
           events stream out through /api/events */

        startDiscussion({ task, personas, maxRounds, reasoningEffort })
            .catch(error => {
                /*
                | A rejection before the discussion was
                | registered has nothing to mark failed;
                | the request was already answered.
                */
                const discussion = state.discussion;

                if (discussion && discussion.status !== "failed") {
                    discussion.status = "failed";
                    discussion.error = error.message;
                    discussion.finished_at = Date.now();

                    runtime.events.emit("discussion:error", {
                        id: discussion.id,
                        error: error.message
                    });
                }
            });

        sendJson(res, 202, {
            accepted: true,
            id: state.discussion.id
        });

        return true;
    }

    return false;
};
