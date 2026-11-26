"use strict";

/*
|--------------------------------------------------------------------------
| Project record routes
|--------------------------------------------------------------------------
|
| One project's record (read, rename, delete), its discussions, state,
| sessions and event stream.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");


module.exports = async function ProjectRecordsRoutes(shared, request, project) {

    const {
        DISCUSSION_MODULE,
        approvalStore,
        conversations,
        discussionService,
        requestReasoningEffort,
        runtime,
        projectSnapshot,
        sessions,
        sseHub,
        startDiscussion,
        state
    } = shared;

    const {
        claims,
        req,
        res
    } = request;

    const {
        busy,
        projectId,
        registry,
        requireAccess,
        requireRecord,
        suffix
    } = project;

    if (!projectId) {

        sendJson(res, 404, { error: "not found" });
        return true;
    }

    if (suffix === "" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        sendJson(res, 200, { project: requireRecord(projectId) });
        return true;
    }

    if (suffix === "" && req.method === "PATCH") {

        requireAccess(projectId, "project:write");
        const body = await readBody(req);

        try {

            sendJson(res, 200, {
                project: registry.update(projectId, body)
            });

        } catch (error) {

            sendJson(
                res,
                /Unknown project/.test(error.message) ? 404 : 400,
                { error: error.message }
            );
        }

        return true;
    }

    if (suffix === "" && req.method === "DELETE") {

        requireAccess(projectId, "project:write");

        try {

            registry.remove(projectId);
            sendJson(res, 200, { deleted: projectId });

        } catch (error) {

            sendJson(res, 404, { error: error.message });
        }

        return true;
    }

    if (suffix === "/discussions" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        const record = requireRecord(projectId);
        const ctx = runtime.projects.createProjectContext(record);

        sendJson(res, 200, {
            project_id: record.id,
            discussions: discussionService.list({
                projectId: record.id,
                projectContext: ctx
            })
        });
        return true;
    }

    if (
        suffix.startsWith("/discussions/") &&
        req.method === "GET"
    ) {

        requireAccess(projectId, "project:read");
        const record = requireRecord(projectId);
        const discussionId = decodeURIComponent(
            suffix.slice("/discussions/".length)
        );
        const ctx = runtime.projects.createProjectContext(record);
        const discussion = discussionService.load(discussionId, {
            projectId: record.id,
            projectContext: ctx
        });

        if (!discussion) {
            sendJson(res, 404, { error: "unknown discussion" });
            return true;
        }

        sendJson(res, 200, {
            project_id: record.id,
            discussion
        });
        return true;
    }

    if (suffix === "/discussions" && req.method === "POST") {

        requireAccess(projectId, "project:write");
        const record = requireRecord(projectId);
        const body = await readBody(req);
        const task = typeof body.task === "string" ? body.task.trim() : "";
        const personas = Array.isArray(body.personas)
            ? body.personas.filter(id => typeof id === "string").map(id => id.trim()).filter(Boolean)
            : [];
        const maxRounds = Number.isInteger(body.max_rounds) ? body.max_rounds : 5;
        let reasoningEffort;
        try {
            reasoningEffort = requestReasoningEffort(body);
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message });
            return true;
        }

        if (task === "" || personas.length === 0 || maxRounds < 1 || maxRounds > 10) {
            sendJson(res, 400, {
                error: task === ""
                    ? "task is required"
                    : personas.length === 0
                        ? "personas is required: a non-empty array of persona ids"
                        : "max_rounds must be between 1 and 10"
            });
            return true;
        }

        const ctx = runtime.projects.createProjectContext(record);
        const known = DISCUSSION_MODULE.listPersonas().map(persona => persona.id);
        const unknown = personas.find(id => !known.includes(id));

        if (unknown) {
            sendJson(res, 400, {
                error: `unknown persona: ${unknown}; available: ${known.join(", ")}`
            });
            return true;
        }

        if (busy()) {
            sendJson(res, 409, {
                error: state.status === "running"
                    ? "a task is already running"
                    : "a discussion is already running"
            });
            return true;
        }

        startDiscussion({
            task,
            personas,
            maxRounds,
            projectId: record.id,
            projectContext: ctx,
            reasoningEffort
        }).catch(() => {});

        sendJson(res, 202, {
            accepted: true,
            id: state.discussion.id,
            project_id: record.id
        });
        return true;
    }

    if (suffix === "/state" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        const record = requireRecord(projectId);
        const conv = conversations.get(record.id);
        /* the foreground holds this project, or its own conversation does */
        const live =
            conv && (conv.background || state.projectId !== record.id)
                ? conv
                : state.projectId === record.id ? state : null;
        const ctx =
            runtime.projects.createProjectContext(record);

        sendJson(res, 200, {
            project: record,
            status: live ? live.status : "idle",
            task: live ? live.task : null,
            answer: live ? live.answer : null,
            error: live ? live.error : null,
            background: Boolean(conv && conv.background),
            queue_length: conv ? conv.queue.length : 0,
            events: projectSnapshot(record.id, claims).events,
            sessions:
                sessions.listSessions(ctx.dataRoot),
            pending_approvals:
                approvalStore.pendingValues()
                    .filter(item => item.project_id === record.id)
                    .map(item => ({
                        id: item.id,
                        agent: item.agent,
                        tool: item.tool,
                        reason: item.reason,
                        arguments: item.arguments,
                        project_id: item.project_id
                    })),
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
        return true;
    }

    if (suffix === "/sessions" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        const record = requireRecord(projectId);
        const ctx =
            runtime.projects.createProjectContext(record);

        sendJson(res, 200, {
            project_id: record.id,
            sessions: sessions.listSessions(ctx.dataRoot)
        });
        return true;
    }

    if (suffix === "/events" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        requireRecord(projectId);

        const client = {
            res,
            projectId,
            claims
        };

        const snap = {
            events: projectSnapshot(projectId, claims).events
        };

        sseHub.attach(
            req,
            res,
            client,
            {
                type: "snapshot",
                snapshot: snap
            }
        );

        return true;
    }

    return false;
};
