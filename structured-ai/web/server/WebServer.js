"use strict";

const http = require("http");

const { createServer: createLegacyServer } = require("./LegacyWebServer");
const { Router } = require("./Router");
const { ROUTES } = require("./RouteInventory");
const controllers = require("./controllers");
const services = require("./services");
const serializers = require("./serializers");
const { EventStreamService } = require("./services/EventStreamService");


/*
|--------------------------------------------------------------------------
| Modular Web Server — EXECUTION_PLAN Phase 23
|--------------------------------------------------------------------------
|
| The compatibility implementation is kept in LegacyWebServer while the
| web boundary is migrated in one safe step. This class owns the modular
| HTTP lifecycle, route inventory and dependency graph; each registered
| controller forwards into the already contract-tested handler until its
| domain service is moved. Thus `WEB_SERVER_MODE=modular` changes structure
| and routing, not API results or browser behaviour.
|--------------------------------------------------------------------------
*/

function controllerFor(registered, path) {

    if (path.startsWith("/api/projects")) {
        return registered.project;
    }

    if (path.startsWith("/api/sessions")) {
        return registered.session;
    }

    if (path.startsWith("/api/approvals")) {
        return registered.approval;
    }

    if (path.startsWith("/api/mcp")) {
        return registered.mcp;
    }

    if (path.startsWith("/api/discussion")) {
        return registered.discussion;
    }

    if (path === "/api/tasks" || path === "/api/events") {
        return path === "/api/tasks"
            ? registered.task
            : registered.event;
    }

    if (
        path === "/api/state" ||
        path === "/api/stats" ||
        path === "/api/metrics" ||
        path === "/api/health"
    ) {
        return registered.state;
    }

    if (path.startsWith("/api/settings") || path === "/api/approval-mode") {
        return registered.settings;
    }

    if (path.startsWith("/api/graph") || path.startsWith("/api/calls")) {
        return registered.run;
    }

    return registered.task;
}


class WebServer {

    constructor(runtime, options = {}) {

        this.runtime = runtime;
        this.options = options;
        this.mode = "modular";

        /* The moved implementation is used as a contract-preserving domain
           adapter; it is never put on a listening socket in this mode. */
        this.legacy =
            createLegacyServer(runtime, options);

        const forward =
            (req, res) => this.legacy.handle(req, res);

        this.services = {
            task: new services.TaskService({
                runtime,
                state: this.legacy.state,
                startTask: this.legacy.startTask
            }),
            session: new services.SessionService({ runtime }),
            settings: new services.SettingsService({ runtime }),
            events: new EventStreamService({
                events: runtime.events,
                auth: require("../../agent/lib/consoleAuth")
            })
        };

        const toolRuntime = require("../../agent/tools");
        const projectRegistry =
            runtime.projects && typeof runtime.projects.registry === "function"
                ? runtime.projects.registry()
                : null;
        const discussion = require("../../agent/discussion");

        this.controllers = {
            task: new controllers.TaskController({
                taskService: this.services.task,
                forward
            }),
            session: new controllers.SessionController({
                sessionService: this.services.session,
                forward
            }),
            state: new controllers.StateController({ forward }),
            settings: new controllers.SettingsController({
                settingsService: this.services.settings,
                forward
            }),
            approval: new controllers.ApprovalController({
                approvalStore: this.legacy.approvalStore,
                resolve: this.legacy.resolveApproval,
                forward
            }),
            mcp: new controllers.McpController({
                manager: toolRuntime.mcp._manager,
                forward
            }),
            archive: new controllers.ArchiveController({
                archive: require("../../agent/lib/archive"),
                forward
            }),
            plan: new controllers.PlanController({
                plan: {
                    summary: runtime.currentPlanSummary,
                    update: value => value
                },
                forward
            }),
            project: new controllers.ProjectController({
                registry: projectRegistry,
                forward
            }),
            run: new controllers.RunController({
                runManager: runtime.runManager,
                observability: runtime.observability,
                forward
            }),
            discussion: new controllers.DiscussionController({
                discussion,
                forward
            }),
            event: new controllers.StateController({ forward })
        };

        this.serializers = serializers;
        this.routeInventory = ROUTES;
        this.router = new Router({
            fallback: (req, res) => this.legacy.handle(req, res)
        });

        for (const route of ROUTES) {

            const controller =
                controllerFor(this.controllers, route.path);

            this.router.register(
                route.method,
                route.path,
                request => controller.forward(request),
                `${route.method} ${route.path}`
            );
        }

        /* The extracted SSE hub is owned by the compatibility domain
           adapter, so modular and legacy modes share one client lifecycle. */
        this.sseHub = this.legacy.sseHub;

        this.server =
            http.createServer((req, res) =>
                this.router.handle(req, res, {
                    runtime,
                    webServer: this
                })
            );
    }


    listen(port, host) {

        return new Promise(resolve => {
            this.server.listen(port, host, () => resolve(this.server.address()));
        });
    }


    async close() {

        await this.legacy.close();

        if (!this.server.listening) {
            return;
        }

        await new Promise(resolve => this.server.close(resolve));
    }


    facade() {

        const legacy = this.legacy;

        return {
            ...legacy,
            server: this.server,
            mode: this.mode,
            router: this.router,
            routeInventory: this.routeInventory,
            controllers: this.controllers,
            services: this.services,
            serializers: this.serializers,
            webServer: this,
            listen: this.listen.bind(this),
            close: this.close.bind(this)
        };
    }
}


function createServer(runtime, options = {}) {
    return new WebServer(runtime, options).facade();
}


module.exports = {
    WebServer,
    createServer,
    controllerFor
};
