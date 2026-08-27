"use strict";

/*
|--------------------------------------------------------------------------
| Web console approval routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The two endpoints the approval buttons and the mode switch call.
|
| `POST /api/approvals/:id` resolves a *pending* request, and the service
| takes it out of the store before resolving it — so a second click resolves
| nothing and answers 404. Two tabs open on one console is the normal case
| that covers, and the route contract keeps it.
|
| `body.approved === true`, not truthiness: an empty or malformed body is a
| denial. Deny-by-default is the only safe reading for this endpoint.
|
| The mode route answers 400 from the runtime's own validation of the name,
| then emits `session:approval_mode` so a second open tab updates without a
| reload.
|--------------------------------------------------------------------------
*/

function createApprovalController(ctx) {

    const { runtime } = ctx;

    /* ------------------------------------------ approvals */

    async function resolve(req, res, url, pathname, claims) {

        const id =
            decodeURIComponent(
                pathname.slice("/api/approvals/".length)
            );

        const body =
            await ctx.readBody(req);

        const resolved =
            ctx.resolveApproval(
                id,
                body.approved === true
            );

        ctx.sendJson(
            res,
            resolved
                ? 200
                : 404,
            {
                resolved
            }
        );

    }

    async function setMode(req, res, url, pathname, claims) {

        const body =
            await ctx.readBody(req);

        try {

            runtime.setApprovalMode(body.mode);

        } catch (error) {

            ctx.sendJson(res, 400, {
                error: error.message
            });

            return;
        }

        runtime.events.emit("session:approval_mode", {
            mode: body.mode
        });

        ctx.sendJson(res, 200, { mode: body.mode });

    }

    return {
        resolve,
        setMode
    };
}

module.exports = { createApprovalController };
