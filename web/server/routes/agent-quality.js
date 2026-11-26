"use strict";

/*
|--------------------------------------------------------------------------
| Task snapshots and review routes (roadmap P3-08, P3-09)
|--------------------------------------------------------------------------
|
|   GET  /api/snapshots?projectId=               runs with a snapshot,
|                                                 newest first
|   GET  /api/snapshots/:runId?projectId=        what that run changed
|                                                 (files and patch)
|   POST /api/snapshots/:runId/revert            put back every file the run
|                                                 created, edited or deleted
|                                                 {projectId?, force?}
|   POST /api/review                             one review {projectId?,
|                                                 target, ref?, base?,
|                                                 number?, focus?, post?}
|
| A workspace that is not a git repository answers 409 with
| code NOT_A_REPOSITORY and a sentence that says so. A revert that would
| overwrite a file changed again after the run answers 409 with the list
| (conflicts) unless force is set. Admin token only: a revert rewrites
| files and a review can read any of them. Called in order by
| ServerImplementation.
*/

const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");
const RunSnapshots = require("../../../agent/runtime/RunSnapshots");
const ReviewRunner = require("../../../agent/review/ReviewRunner");


function rootFor(shared, projectId) {

    if (projectId === undefined || projectId === null || projectId === "") {
        return shared.workspaceRoot();
    }

    if (typeof projectId !== "string" || projectId.length > 200) {
        throw Object.assign(new Error("projectId must be a string"), { status: 400 });
    }

    let record = null;

    try {
        record = shared.runtime.projects.registry().get(projectId);
    } catch {
        record = null;
    }

    if (!record || typeof record.rootPath !== "string") {
        throw Object.assign(new Error(`Unknown project: ${projectId}`), { status: 404 });
    }

    return record.rootPath;
}


function statusOf(error) {

    if (error.status) return error.status;

    if (error.code === "NOT_A_REPOSITORY" || error.code === "RUN_NOT_FINISHED") return 409;

    if (error.code === "NO_SNAPSHOT") return 404;

    if (error.code === "INVALID_RUN" || error.code === "INVALID_PHASE") return 400;

    return 500;
}


async function jsonBody(req) {

    const body = await readBody(req);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("request body must be a JSON object"), { status: 400 });
    }

    return body;
}


module.exports = async function AgentQualityRoutes(shared, request) {

    const { pathname, req, res, url } = request;

    const snapshots = pathname === "/api/snapshots" || pathname.startsWith("/api/snapshots/");
    const review = pathname === "/api/review";

    if (!snapshots && !review) {
        return false;
    }

    if (request.requireAdmin()) return true;

    try {

        if (pathname === "/api/snapshots" && req.method === "GET") {

            const root = rootFor(shared, url.searchParams.get("projectId"));

            sendJson(res, 200, { enabled: RunSnapshots.enabled(), runs: await RunSnapshots.list(root) });
            return true;
        }

        const revert = /^\/api\/snapshots\/([^/]+)\/revert$/.exec(pathname);

        if (revert && req.method === "POST") {

            const body = await jsonBody(req);
            const root = rootFor(shared, body.projectId);
            const result = await RunSnapshots.revert(root, decodeURIComponent(revert[1]), { force: body.force === true });

            if (result.reverted) {
                shared.runtime.events.emit("run:snapshot", {
                    run_id: result.run_id,
                    project_id: body.projectId || null,
                    phase: "reverted",
                    restored: result.restored.length,
                    removed: result.removed.length
                });
            }

            sendJson(res, result.reverted ? 200 : 409, result.reverted ? result : {
                ...result,
                error: `${result.conflicts.length} file(s) changed again after the run; revert with force to overwrite them`,
                code: "SNAPSHOT_CONFLICT"
            });
            return true;
        }

        const one = /^\/api\/snapshots\/([^/]+)$/.exec(pathname);

        if (one && req.method === "GET") {

            const root = rootFor(shared, url.searchParams.get("projectId"));

            sendJson(res, 200, await RunSnapshots.diff(root, decodeURIComponent(one[1])));
            return true;
        }

        if (review && req.method === "POST") {

            const body = await jsonBody(req);
            const root = rootFor(shared, body.projectId);

            const result = await ReviewRunner.review({
                root,
                callAI: options => shared.runtime.callAI(options),
                target: body.target || "diff",
                ref: body.ref || undefined,
                base: body.base || undefined,
                number: body.number,
                owner: body.owner || undefined,
                repo: body.repo || undefined,
                focus: body.focus,
                post: body.post === true,
                projectId: body.projectId || null
            });

            sendJson(res, 200, { ...result, fix_task: ReviewRunner.fixTask(result.findings, result.label) });
            return true;
        }

    } catch (error) {

        sendJson(res, statusOf(error), { error: error.message, ...(error.code ? { code: error.code } : {}) });
        return true;
    }

    sendJson(res, 404, { error: "not found" });
    return true;
};
