"use strict";

/*
|--------------------------------------------------------------------------
| Web console settings routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Read every setting; change or reset one.
|
| The write route keeps only what an HTTP request owns: parse the body, hand
| it to the settings service, answer. The service writes the value, then
| describes it, then emits `settings:changed`, and the response is built from
| that same description — so what a browser is told it set is what the
| runtime recorded, including which source won (env, workspace, project or
| default).
|
| `applied_to_running_agent: state.status === "running"` is the honest half
| of that contract: a setting changed mid-run reaches the run only for the
| keys the loop re-reads each cycle, and the console says so instead of
| pretending.
|--------------------------------------------------------------------------
*/

function createSettingsController(ctx) {

    const { state } = ctx;

    /* --------------------------------------------- settings */

    async function read(req, res, url, pathname, claims) {

        ctx.sendJson(res, 200, {
            settings:
                ctx.settings.all()
        });

    }

    async function write(req, res, url, pathname, claims) {

        const body =
            await ctx.readBody(req);

        try {

const definition =
            ctx.settings.apply(body);

        ctx.sendJson(res, 200, {
            setting: definition,

            applied_to_running_agent:
                state.status === "running"
        });

        } catch (error) {

            ctx.sendJson(res, 400, {
                error: error.message
            });
        }

    }

    return {
        read,
        write
    };
}

module.exports = { createSettingsController };
