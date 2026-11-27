"use strict";

/*
|--------------------------------------------------------------------------
| Project routes
|--------------------------------------------------------------------------
|
| Listing and registering projects, then everything under
| /api/projects/:id: the id is parsed once here and the routes on one
| project are in project-records.js and project-runs.js.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");
const fs = require("fs");
const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");
const ProjectRecordsRoutes = require("./project-records");
const ProjectRunsRoutes = require("./project-runs");
const ProjectConversationRoutes = require("./project-conversation");


module.exports = async function ProjectsRoutes(shared, request) {

    const {
        runtime,
        state
    } = shared;

    const {
        claims,
        pathname,
        req,
        res
    } = request;

    /* ------------------- every live conversation (P1-03 tabs) */

    if (pathname === "/api/conversations" && req.method === "GET") {

        sendJson(res, 200, { conversations: shared.conversationsFor(claims) });
        return true;
    }

    /* ------------------------- new project from a git URL (P1-02) */

    if (pathname === "/api/project-clones" || pathname.startsWith("/api/project-clones/")) {

        const write =
            consoleAuth.authorize(claims, {
                permission: "project:write"
            });

        if (!write.ok || !consoleAuth.allowsAllProjects(claims)) {

            sendJson(res, 403, {
                error: "token cannot register projects"
            });
            return true;
        }

        const ProjectClone = require("../../../agent/projects/ProjectClone");

        if (pathname === "/api/project-clones" && req.method === "GET") {

            sendJson(res, 200, { root: ProjectClone.projectsRoot(), jobs: ProjectClone.list() });
            return true;
        }

        if (pathname === "/api/project-clones" && req.method === "POST") {

            const body = await readBody(req);

            try {

                const job =
                    ProjectClone.start({
                        url: body.url,
                        branch: body.branch,
                        shallow: body.shallow === true,
                        folder: body.folder,
                        name: body.name,
                        secret: body.secret,
                        registry: runtime.projects.registry(),
                        emit: (type, payload) => runtime.events.emit(type, payload)
                    });

                sendJson(res, 202, { job });

            } catch (error) {

                sendJson(res, error.status || 400, { error: error.message });
            }

            return true;
        }

        const jobId =
            decodeURIComponent(pathname.slice("/api/project-clones/".length));

        if (req.method === "GET" && jobId && !jobId.includes("/")) {

            const job = ProjectClone.get(jobId);

            sendJson(res, job ? 200 : 404, job ? { job } : { error: `unknown clone job ${jobId}` });
            return true;
        }

        sendJson(res, 404, { error: "not found" });
        return true;
    }

    /* ---------------------------------- projects (Phase 7+9) */

    if (pathname === "/api/projects" || pathname.startsWith("/api/projects/")) {

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

            sendJson(res, 200, { projects: listed });
            return true;
        }

        if (pathname === "/api/projects" && req.method === "POST") {

            const write =
                consoleAuth.authorize(claims, {
                    permission: "project:write"
                });

            if (!write.ok || !consoleAuth.allowsAllProjects(claims)) {

                sendJson(res, 403, {
                    error: "token cannot register projects"
                });
                return true;
            }

            const body = await readBody(req);

            if (typeof body.rootPath !== "string" || body.rootPath.trim() === "") {

                sendJson(res, 400, { error: "rootPath is required" });
                return true;
            }

            try {

                const existing = fs.existsSync(body.rootPath)
                    ? registry.findByRoot(body.rootPath)
                    : null;

                const record =
                    registry.register({
                        id: body.id,
                        name: body.name,
                        rootPath: body.rootPath,
                        createIfMissing: body.createIfMissing === true,
                        enabled: body.enabled,
                        autoStart: body.autoStart,
                        permissions: body.permissions
                    });

                sendJson(res, existing ? 200 : 201, { project: record });

            } catch (error) {

                sendJson(res, 400, { error: error.message });
            }

            return true;
        }

        const rest =
            pathname.slice("/api/projects/".length);

        const slash = rest.indexOf("/");
        const projectId =
            decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
        const suffix =
            slash === -1 ? "" : rest.slice(slash);

        /* the routes on one project */
        const project = { busy, projectId, registry, requireAccess, requireRecord, suffix };

        if (await ProjectRecordsRoutes(shared, request, project)) {
            return true;
        }

        if (await ProjectRunsRoutes(shared, request, project)) {
            return true;
        }

        if (await ProjectConversationRoutes(shared, request, project)) {
            return true;
        }

        sendJson(res, 404, { error: "not found" });
        return true;
    }

    return false;
};
