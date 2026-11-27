"use strict";

/*
|--------------------------------------------------------------------------
| Project conversation routes (roadmap P1-03 / P1-04)
|--------------------------------------------------------------------------
|
| One project's conversation beyond starting a run: the queue of messages
| waiting for its next turn (read, add, edit, delete, clear, resume), a
| course correction for the running turn, and starting the conversation
| afresh.
|
| Called in order by the projects route group (routes/projects.js). It
| returns true once it has answered the request, false when the request is
| not one of its routes.
*/

const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");


function messageText(body) {

    const value =
        typeof body.text === "string"
            ? body.text
            : typeof body.task === "string"
                ? body.task
                : typeof body.message === "string"
                    ? body.message
                    : "";

    return value.trim();
}


module.exports = async function ProjectConversationRoutes(shared, request, project) {

    const {
        clearForeground,
        conversations,
        projectQueue,
        requestReasoningEffort,
        requestRunFlags,
        runtime,
        startTask,
        state
    } = shared;

    const {
        req,
        res
    } = request;

    const {
        projectId,
        requireAccess,
        requireRecord,
        suffix
    } = project;

    const fail = (status, error) => {
        sendJson(res, status, { error, project_id: projectId });
        return true;
    };

    /* an idle project whose queue may run starts its next message */
    const drain = () => {

        const conv = conversations.get(projectId);

        if (!conv || conv.status === "running") {
            return false;
        }

        const next = projectQueue.takeNext(conv, { turnEnded: false });

        if (!next) {
            return false;
        }

        startTask(next.text, {
            projectId,
            reasoningEffort: next.reasoningEffort,
            runFlags: next.runFlags,
            kind: next.kind
        }).catch(() => {});

        return true;
    };

    if (suffix === "/queue" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        requireRecord(projectId);

        sendJson(res, 200, projectQueue.view(projectId));
        return true;
    }

    if (suffix === "/queue" && req.method === "POST") {

        requireAccess(projectId, "project:write");
        requireRecord(projectId);

        const body = await readBody(req);
        const text = messageText(body);

        if (text === "") {
            return fail(400, "text is required");
        }

        let reasoningEffort;
        let runFlags;

        try {
            reasoningEffort = requestReasoningEffort(body);
            runFlags = requestRunFlags(body);
        } catch (error) {
            return fail(error.status || 400, error.message);
        }

        try {

            const item = projectQueue.add(projectId, text, { reasoningEffort, runFlags });

            const started = drain();

            sendJson(res, 201, {
                ...projectQueue.view(projectId),
                item,
                started
            });

        } catch (error) {

            return fail(error.status || 400, error.message);
        }

        return true;
    }

    if (suffix === "/queue" && req.method === "DELETE") {

        requireAccess(projectId, "project:write");
        requireRecord(projectId);

        const dropped = projectQueue.clear(projectId);

        sendJson(res, 200, { ...projectQueue.view(projectId), dropped });
        return true;
    }

    if (suffix === "/queue/resume" && req.method === "POST") {

        requireAccess(projectId, "project:write");
        requireRecord(projectId);

        projectQueue.setPaused(projectId, false);

        const started = drain();

        sendJson(res, 200, { ...projectQueue.view(projectId), started });
        return true;
    }

    const item = /^\/queue\/([^/]+)$/.exec(suffix);

    if (item && (req.method === "PATCH" || req.method === "DELETE")) {

        requireAccess(projectId, "project:write");
        requireRecord(projectId);

        let itemId;

        try {
            itemId = decodeURIComponent(item[1]);
        } catch {
            return fail(400, "malformed queue item id");
        }

        if (req.method === "DELETE") {

            if (!projectQueue.remove(projectId, itemId)) {
                return fail(404, `no queued message ${itemId}`);
            }

            sendJson(res, 200, projectQueue.view(projectId));
            return true;
        }

        const text = messageText(await readBody(req));

        if (text === "") {
            return fail(400, "text is required");
        }

        const edited = projectQueue.edit(projectId, itemId, text);

        if (!edited) {
            return fail(404, `no queued message ${itemId}`);
        }

        sendJson(res, 200, { ...projectQueue.view(projectId), item: edited });
        return true;
    }

    /*
    | A correction reaches the running turn at its next iteration. With
    | no turn running it is simply the next message: it starts a turn.
    */
    if (suffix === "/correction" && req.method === "POST") {

        requireAccess(projectId, "project:write");
        const record = requireRecord(projectId);

        const text = messageText(await readBody(req));

        if (text === "") {
            return fail(400, "text is required");
        }

        const offered = projectQueue.offerCorrection(record.id, text);

        if (!offered && conversations.busy(record.id)) {

            /* the turn is between runs: it is the first thing the next reads */
            try {

                const queued =
                    projectQueue.add(record.id, text, { kind: "correction", front: true });

                sendJson(res, 202, { accepted: true, project_id: record.id, injected: false, queued: true, item: queued });

            } catch (error) {

                return fail(error.status || 400, error.message);
            }

            return true;
        }

        if (!offered) {

            startTask(text, { projectId: record.id, kind: "correction" }).catch(() => {});

            sendJson(res, 202, { accepted: true, project_id: record.id, injected: false, started: true });
            return true;
        }

        const conv = conversations.get(record.id);
        const entry = { role: "user", kind: "correction", content: text, turn_id: conv.currentTurnId };

        /* the transcript shows the correction where the operator sent it */
        if (conv.background) {
            conversations.addMessage(conv, entry);
        } else if (state.projectId === record.id) {
            shared.addMessage(entry);
        }

        sendJson(res, 202, {
            accepted: true,
            project_id: record.id,
            injected: true,
            correction_id: offered.id,
            run_id: offered.run_id
        });
        return true;
    }

    /* "New conversation" on a project */
    if (suffix === "/clear" && req.method === "POST") {

        requireAccess(projectId, "project:write");
        const record = requireRecord(projectId);

        const conv = conversations.get(record.id);

        if (conversations.busy(record.id)) {
            return fail(409, "cannot clear while a task is running");
        }

        /* the foreground holds this project: clear it the historical way */
        if (state.projectId === record.id && !(conv && conv.background)) {

            if (!clearForeground()) {
                return fail(409, "cannot clear while a task is running");
            }

        } else {

            conversations.resetConversation(record.id);

            runtime.events.emit("session:cleared", { project_id: record.id, background: true });
        }

        sendJson(res, 200, { cleared: true, project_id: record.id });
        return true;
    }

    return false;
};
