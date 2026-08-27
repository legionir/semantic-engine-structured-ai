"use strict";

/*
|--------------------------------------------------------------------------
| Web console project routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The project-scoped half of the console: registry writes, per-project
| state / sessions / events, cancel, task submission, metrics and health.
|
| One prefix route owns every /api/projects path and answers 404 itself, so
| /api/projects/prj-x/nope is refused here and never reaches the routes below
| it. `requireRecord` and `requireAccess` are the two guards every sub-route
| runs through, and both throw with a `.status` for the one error handler
| above the whole chain: 404 for an unknown id, 403 for a token that may not
| look, 401 for no token at all.
|
| Registering is a master-token action (403 for a scoped one) and a
| project-scoped task answers 409 with PROJECT_MODE_REQUIRED unless the
| context modes are modular — refusing to run mis-scoped is the entire point
| of that gate — with 429/RUN_QUEUE_FULL as the scheduler saying the same
| about queue depth.
|
| Two locals named `ctx` were renamed `projectContext`: this layer's
| composition context owns that name now, and a route shadowing it would
| have been calling `sendJson` on a project context.
|--------------------------------------------------------------------------
*/

const { pendingApprovalsForProject } = require("../serializers/SessionSerializer");

const consoleAuth = require("../../../agent/lib/consoleAuth");

function createProjectController(ctx) {

    const { runtime, state, clients, sessions } = ctx;

    /* ---------------------------------- projects (Phase 7+9) */

    async function handle(req, res, url, pathname, claims) {

        const registry = runtime.projects.registry();

        const requireRecord = (projectId) => {

            try {

                return registry.get(projectId);

            } catch (error) {

                const err = new Error(error.message);
                err.status = 404;
                throw err;
            }
        };

        const requireAccess = (projectId, permission) => {

            const allowed =
                consoleAuth.authorize(claims, {
                    projectId,
                    permission
                });

            if (!allowed.ok) {

                const err = new Error(allowed.error);
                err.status = allowed.status;
                throw err;
            }
        };

        const busy = () =>
            state.status === "running" ||
            (
                state.discussion &&
                state.discussion.status === "running"
            );

        if (pathname === "/api/projects" && req.method === "GET") {

            const listed =
                consoleAuth.visibleProjects(claims, registry.list());

            ctx.sendJson(res, 200, { projects: listed });
            return;
        }

        if (pathname === "/api/projects" && req.method === "POST") {

            const write =
                consoleAuth.authorize(claims, {
                    permission: "project:write"
                });

            if (!write.ok || !consoleAuth.allowsAllProjects(claims)) {

                ctx.sendJson(res, 403, {
                    error: "token cannot register projects"
                });
                return;
            }

            const body = await ctx.readBody(req);

            if (typeof body.rootPath !== "string" || body.rootPath.trim() === "") {

                ctx.sendJson(res, 400, { error: "rootPath is required" });
                return;
            }

            try {

                const existing =
                    registry.findByRoot(body.rootPath);

                const record =
                    registry.register({
                        id: body.id,
                        name: body.name,
                        rootPath: body.rootPath,
                        semanticEndpoint: body.semanticEndpoint,
                        enabled: body.enabled,
                        autoStart: body.autoStart,
                        permissions: body.permissions
                    });

                ctx.sendJson(res, existing ? 200 : 201, { project: record });

            } catch (error) {

                ctx.sendJson(res, 400, { error: error.message });
            }

            return;
        }

        const rest =
            pathname.slice("/api/projects/".length);

        const slash = rest.indexOf("/");
        const projectId =
            decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
        const suffix =
            slash === -1 ? "" : rest.slice(slash);

        if (!projectId) {

            ctx.sendJson(res, 404, { error: "not found" });
            return;
        }

        if (suffix === "" && req.method === "GET") {

            requireAccess(projectId, "project:read");
            ctx.sendJson(res, 200, { project: requireRecord(projectId) });
            return;
        }

        if (suffix === "" && req.method === "PATCH") {

            requireAccess(projectId, "project:write");
            const body = await ctx.readBody(req);

            try {

                ctx.sendJson(res, 200, {
                    project: registry.update(projectId, body)
                });

            } catch (error) {

                ctx.sendJson(
                    res,
                    /Unknown project/.test(error.message) ? 404 : 400,
                    { error: error.message }
                );
            }

            return;
        }

        if (suffix === "" && req.method === "DELETE") {

            requireAccess(projectId, "project:write");

            try {

                registry.remove(projectId);
                ctx.sendJson(res, 200, { deleted: projectId });

            } catch (error) {

                ctx.sendJson(res, 404, { error: error.message });
            }

            return;
        }

        if (suffix === "/state" && req.method === "GET") {

            requireAccess(projectId, "project:read");
            const record = requireRecord(projectId);
            const live = state.projectId === record.id;
            const projectContext =
                runtime.projects.createProjectContext(record);

            ctx.sendJson(res, 200, {
                project: record,
                status: live ? state.status : "idle",
                task: live ? state.task : null,
                answer: live ? state.answer : null,
                error: live ? state.error : null,
                events:
                    state.events
                        .map(event =>
                            ctx.eventForClient(event, { projectId: record.id, claims })
                        )
                        .filter(Boolean),
                sessions:
                    sessions.listSessions(projectContext.dataRoot),
                pending_approvals:
                    pendingApprovalsForProject(
                        state.approvals
                            .listPending({ projectId: record.id, includeUnscoped: false })
                    ),
                active_runs:
                    typeof runtime.runManager.activeRuns === "function"
                        ? runtime.runManager.activeRuns()
                            .filter(run => run.projectId === record.id)
                            .map(run => ({
                                run_id: run.runId,
                                task: run.task,
                                status: run.status
                            }))
                        : []
            });
            return;
        }

        if (suffix === "/sessions" && req.method === "GET") {

            requireAccess(projectId, "project:read");
            const record = requireRecord(projectId);
            const projectContext =
                runtime.projects.createProjectContext(record);

            ctx.sendJson(res, 200, {
                project_id: record.id,
                sessions: sessions.listSessions(projectContext.dataRoot)
            });
            return;
        }

        if (suffix === "/events" && req.method === "GET") {

            requireAccess(projectId, "project:read");
            requireRecord(projectId);

            const client = {
                res,
                projectId,
                claims
            };

            res.writeHead(200, {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-cache, no-transform",
                connection: "keep-alive",
                "x-accel-buffering": "no"
            });

            const snap = {
                events:
                    ctx.snapshot().events
                        .map(event => ctx.eventForClient(event, client))
                        .filter(Boolean)
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

            return;
        }

        if (suffix === "/cancel" && req.method === "POST") {

            requireAccess(projectId, "project:write");
            requireRecord(projectId);

            const cancelled = [];

            if (
                typeof runtime.runManager.activeRuns === "function"
            ) {

                for (const run of runtime.runManager.activeRuns()) {

                    if (run.projectId === projectId) {

                        runtime.cancelRunById(run.runId, "web console");
                        cancelled.push(run.runId);
                    }
                }
            }

            if (state.projectId === projectId) {

                state.stopRequested = true;
                runtime.cancelRun("web console");
            }

            const dropped =
                runtime.runScheduler &&
                typeof runtime.runScheduler.cancelQueued === "function"
                    ? runtime.runScheduler.cancelQueued(projectId, "web console")
                    : 0;

            ctx.sendJson(res, 200, {
                cancelled: true,
                project_id: projectId,
                run_ids: cancelled,
                queued_dropped: dropped
            });
            return;
        }

        if (
            (suffix === "/tasks" || suffix === "/chat") &&
            req.method === "POST"
        ) {

            requireAccess(projectId, "project:write");

            const body = await ctx.readBody(req);

            const task =
                typeof body.task === "string"
                    ? body.task.trim()
                    : typeof body.message === "string"
                        ? body.message.trim()
                        : "";

            if (task === "") {

                ctx.sendJson(res, 400, {
                    error: "task is required"
                });
                return;
            }

            if (busy()) {

                ctx.sendJson(res, 409, {
                    error:
                        state.status === "running"
                            ? "a task is already running"
                            : "a discussion is already running"
                });
                return;
            }

            const record = requireRecord(projectId);

            if (
                runtime.projects.projectContextMode() !== "modular" ||
                runtime.runContextMode() !== "modular"
            ) {

                ctx.sendJson(res, 409, {
                    error:
                        "project-scoped task execution requires " +
                        "PROJECT_CONTEXT_MODE=modular and " +
                        "RUN_CONTEXT_MODE=modular; enable them in the " +
                        "environment and restart the server " +
                        "(PROMPT_BUILDER_MODE=modular additionally puts " +
                        "the project_context message into the prompt)",
                    code: "PROJECT_MODE_REQUIRED",
                    project_id: record.id
                });
                return;
            }

            const admission =
                runtime.runScheduler &&
                typeof runtime.runScheduler.admit === "function"
                    ? runtime.runScheduler.admit(record.id)
                    : "start";

            if (admission === "reject") {

                ctx.sendJson(res, 429, {
                    error: "run queue is full",
                    code: "RUN_QUEUE_FULL",
                    project_id: record.id
                });
                return;
            }

            ctx.startTask(task, { projectId: record.id }).catch(() => {});

            ctx.sendJson(res, 202, {
                accepted: true,
                project_id: record.id,
                queued: admission === "queue"
            });
            return;
        }

        if (suffix === "/metrics" && req.method === "GET") {

            requireAccess(projectId, "project:read");
            requireRecord(projectId);

            ctx.sendJson(res, 200, {
                project_id: projectId,
                metrics:
                    runtime.observability.projectSnapshot(projectId),
                scheduler:
                    runtime.runScheduler.snapshot()
            });
            return;
        }

        if (suffix === "/health" && req.method === "GET") {

            requireAccess(projectId, "project:read");
            requireRecord(projectId);

            ctx.sendJson(res, 200, runtime.observability.healthOf(projectId));
            return;
        }

        ctx.sendJson(res, 404, { error: "not found" });

    }

    return {
        handle
    };
}

module.exports = { createProjectController };
