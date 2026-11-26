"use strict";

/*
|--------------------------------------------------------------------------
| Upload and task routes
|--------------------------------------------------------------------------
|
| File uploads and starting a task in the default workspace.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readMultipart } = require("../Multipart");
const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");


module.exports = async function TasksRoutes(shared, request) {

    const {
        requestReasoningEffort,
        runtime,
        startTask,
        state
    } = shared;

    const {
        claims,
        pathname,
        refuse,
        req,
        requireUnscoped,
        res,
        url
    } = request;

    /* ---------------------------------------------- uploads */

    if (
        pathname === "/api/uploads" &&
        req.method === "POST"
    ) {
        const projectId = url.searchParams.get("projectId") || null;
        const permission = projectId
            ? consoleAuth.authorize(claims, { projectId, permission: "project:write" })
            : consoleAuth.authorizeUnscoped(claims, "project:write");

        if (refuse(permission)) return true;

        let saved = [];

        try {
            const multipart = await readMultipart(req);
            const files = multipart.files.filter(file => ["file", "files"].includes(file.fieldName));

            if (files.length === 0) {
                sendJson(res, 400, { error: "select at least one file to upload" });
                return true;
            }

            let rootPath;
            if (projectId) {
                try {
                    rootPath = runtime.projects.registry().get(projectId).rootPath;
                } catch (error) {
                    error.status = 404;
                    throw error;
                }
            } else {
                const context = runtime.createRuntimeContext();
                rootPath = context?.runtime?.workspace_root || context?.workspace_root;
                if (typeof rootPath !== "string" || rootPath.trim() === "") {
                    const error = new Error("workspace root is unavailable for uploads");
                    error.status = 500;
                    throw error;
                }
            }
            const realRoot = fs.realpathSync(rootPath);
            const uploadDirectory = path.join(realRoot, "upload_tmp");

            fs.mkdirSync(uploadDirectory, { recursive: true });
            const realUploadDirectory = fs.realpathSync(uploadDirectory);
            const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
            if (realUploadDirectory === realRoot || !realUploadDirectory.startsWith(rootPrefix)) {
                throw new Error("upload_tmp must remain inside the project root");
            }

            for (const file of files) {
                const suppliedName = path.win32.basename(path.basename(file.filename || "file"));
                const originalExtension = path.extname(suppliedName);
                const extension = originalExtension.toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 16);
                const stem = path.basename(suppliedName, originalExtension)
                    .normalize("NFKC")
                    .replace(/[^a-zA-Z0-9_-]+/g, "_")
                    .replace(/^[_-]+|[_-]+$/g, "")
                    .slice(0, 72) || "file";
                const storedName = `${stem}_${crypto.randomBytes(6).toString("hex")}${extension}`;
                const filePath = path.join(realUploadDirectory, storedName);

                fs.writeFileSync(filePath, file.data, { flag: "wx", mode: 0o600 });
                saved.push({
                    name: suppliedName || "file",
                    path: filePath,
                    size: file.data.length,
                    type: file.contentType
                });
            }

            sendJson(res, 201, { files: saved, project_id: projectId });
        } catch (error) {
            for (const file of saved) {
                try { fs.unlinkSync(file.path); } catch { /* cleanup best-effort */ }
            }
            sendJson(res, error.status || 400, { error: error.message || "file upload failed" });
        }

        return true;
    }

    /* ---------------------------------------------- tasks */

    if (
        pathname === "/api/tasks" &&
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
        let reasoningEffort;
        try {
            reasoningEffort = requestReasoningEffort(body);
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message });
            return true;
        }

        if (task === "") {

            sendJson(res, 400, {
                error: "task is required"
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
                    state.status === "running"
                        ? "a task is already running"
                        : "a discussion is already running"
            });

            return true;
        }

        /* the run continues in the background */

        startTask(task, { reasoningEffort }).catch(() => {});

        sendJson(res, 202, { accepted: true });

        return true;
    }

    return false;
};
