"use strict";

/*
|--------------------------------------------------------------------------
| Control, settings and health routes
|--------------------------------------------------------------------------
|
| Approvals, cancel, clear, approval mode, the model catalog, settings,
| stats, metrics and health.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");
const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");
const { listModels, listModelCatalog, clearModelCatalogCache } = require("../../../agent/providers/ModelCatalog");


module.exports = async function ControlRoutes(shared, request) {

    const {
        approvalStore,
        calls,
        resolveApproval,
        runtime,
        saveSession,
        sessions,
        state,
        toolRuntime
    } = shared;

    const {
        claims,
        pathname,
        refuse,
        req,
        requireAdmin,
        requireUnscoped,
        res,
        url
    } = request;

    /* ------------------------------------------ approvals */

    if (
        pathname.startsWith("/api/approvals/") &&
        req.method === "POST"
    ) {

        const id =
            decodeURIComponent(
                pathname.slice("/api/approvals/".length)
            );

        /*
        | P0-4: only a token allowed on the approval's project
        | may answer it; approvals of the legacy console run
        | (no project) need a token for every project.
        */
        const pendingApproval =
            approvalStore.getPending(id);

        if (pendingApproval) {

            const ownerProject =
                pendingApproval.project_id ||
                pendingApproval.projectId ||
                null;

            const decision =
                ownerProject
                    ? consoleAuth.authorize(claims, {
                        projectId: ownerProject,
                        permission: "project:write"
                    })
                    : consoleAuth.authorizeUnscoped(claims, "project:write");

            if (refuse(decision)) {
                return true;
            }

        } else if (
            refuse(consoleAuth.authorize(claims, { permission: "project:write" }))
        ) {
            return true;
        }

        const body =
            await readBody(req);

        const resolved =
            resolveApproval(
                id,
                body.approved === true
            );

        sendJson(
            res,
            resolved
                ? 200
                : 404,
            {
                resolved
            }
        );

        return true;
    }

    /* --------------------------------------------- control */

    if (
        pathname === "/api/cancel" &&
        req.method === "POST"
    ) {

        if (requireUnscoped("project:write")) {
            return true;
        }

        state.stopRequested = true;

        const runManager = runtime.runManager;
        const activeRuns = runManager && typeof runManager.activeRuns === "function"
            ? runManager.activeRuns()
            : [];
        const queuedRuns = runManager && typeof runManager.queuedRuns === "function"
            ? runManager.queuedRuns()
            : [];
        let cancelledTrackedRun = false;

        for (const run of [...activeRuns, ...queuedRuns]) {
            if ((run.projectId || null) === (state.projectId || null)) {
                cancelledTrackedRun = runtime.cancelRunById(run.runId, "web console") || cancelledTrackedRun;
            }
        }

        if (!cancelledTrackedRun) {
            runtime.cancelRun("web console");
        }

        for (const id of approvalStore.pendingKeys()) {
            resolveApproval(id, false);
        }

        sendJson(res, 200, { cancelled: true });

        return true;
    }

    if (
        pathname === "/api/clear" &&
        req.method === "POST"
    ) {

        if (requireUnscoped("project:write")) {
            return true;
        }

        if (state.status === "running") {

            sendJson(res, 409, {
                error: "cannot clear while a task is running"
            });

            return true;
        }

        state.cycles = 0;
        state.lastPlanSignature = null;
        state.history = [];
        state.events = [];

        /*
        | The previous conversation is kept on disk; this
        | starts the next one rather than erasing it.
        */

        saveSession();

        state.session = sessions.emptySession();

        calls.clear();
        state.answer = null;
        state.error = null;
        state.status = "idle";

        runtime.events.emit("session:cleared", {});

        sendJson(res, 200, { cleared: true });

        return true;
    }

    if (
        pathname === "/api/approval-mode" &&
        req.method === "POST"
    ) {

        if (requireAdmin()) {
            return true;
        }

        const body =
            await readBody(req);

        try {

            runtime.setApprovalMode(body.mode);

        } catch (error) {

            sendJson(res, 400, {
                error: error.message
            });

            return true;
        }

        runtime.events.emit("session:approval_mode", {
            mode: body.mode
        });

        sendJson(res, 200, { mode: body.mode });

        return true;
    }

    /* ------------------------------------------ model catalog */

    if (
        pathname === "/api/models" &&
        req.method === "GET"
    ) {
        if (requireAdmin()) return true;
        try {
            const role = url.searchParams.get("role");

            if (role) {
                const models = await listModels({ role });
                sendJson(res, 200, { models });
            } else {
                const catalog = await listModelCatalog();
                sendJson(res, 200, catalog);
            }
        } catch (error) {
            sendJson(res, 502, { error: error.message });
        }
        return true;
    }

    /* --------------------------------------------- settings */

    if (
        pathname === "/api/settings" &&
        req.method === "GET"
    ) {

        if (requireAdmin()) {
            return true;
        }

        sendJson(res, 200, {
            settings:
                runtime.settings.all()
        });

        return true;
    }

    if (
        pathname === "/api/settings" &&
        req.method === "POST"
    ) {

        if (requireAdmin()) {
            return true;
        }

        const body =
            await readBody(req);

        try {

            const value =
                body.reset === true
                    ? runtime.settings.reset(body.key)
                    : runtime.settings.set(body.key, body.value);

            const definition =
                runtime.settings.describe(
                    runtime.settings.definitionOf(body.key)
                );

            if (
                /^(AGENT_PROVIDER|AGENT_PROVIDER_REGION|AGENT_BASE_URL|AGENT_API_KEY|AGENT_PROXY_URL|AZURE_OPENAI_API_VERSION|BEDROCK_ACCESS_KEY_ID|BEDROCK_SECRET_ACCESS_KEY|BEDROCK_SESSION_TOKEN|ENDPOINT_(MAIN|L1|L2|L3|SUMMARY)_(BASE_URL|API_KEY))$/.test(String(body.key))
            ) {
                clearModelCatalogCache();
            }

            runtime.events.emit("settings:changed", {
                key: body.key,
                value: definition.value,
                source: definition.source
            });

            sendJson(res, 200, {
                setting: definition,

                applied_to_running_agent:
                    state.status === "running"
            });

            void value;

        } catch (error) {

            sendJson(res, 400, {
                error: error.message
            });
        }

        return true;
    }

    if (
        pathname === "/api/stats" &&
        req.method === "GET"
    ) {

        sendJson(
            res,
            200,
            await toolRuntime.telemetry.runtime_stats({
                recent_limit: 10
            })
        );

        return true;
    }

    if (
        pathname === "/api/metrics" &&
        req.method === "GET"
    ) {

        const snap = runtime.observability.snapshot();

        if (!consoleAuth.allowsAllProjects(claims)) {

            const allowed = {};

            for (const [id, metrics] of Object.entries(snap.projects)) {

                if (consoleAuth.allowsProject(claims, id)) {
                    allowed[id] = metrics;
                }
            }

            snap.projects = allowed;
        }

        sendJson(res, 200, snap);
        return true;
    }

    if (
        pathname === "/api/health" &&
        req.method === "GET"
    ) {

        const health = runtime.observability.health();

        if (!consoleAuth.allowsAllProjects(claims)) {

            const allowed = {};

            for (const [id, item] of Object.entries(health.projects)) {

                if (consoleAuth.allowsProject(claims, id)) {
                    allowed[id] = item;
                }
            }

            health.projects = allowed;
        }

        sendJson(res, 200, health);
        return true;
    }

    return false;
};
