"use strict";

const http = require("http");

const { createServer: createImplementationServer } = require("./ServerImplementation");
const { Router } = require("./Router");
const { ROUTES } = require("./RouteInventory");
const controllers = require("./controllers");
const services = require("./services");
const serializers = require("./serializers");
const { EventStreamService } = require("./services/EventStreamService");


/*
|--------------------------------------------------------------------------
| Canonical Web Server — EXECUTION_PLAN Phase 30
|--------------------------------------------------------------------------
|
| The implementation owns the established HTTP behavior. This class owns
| the canonical lifecycle, route inventory and dependency graph; each
| controller is an explicit adapter around an injected domain service.
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
        this.implementation =
            createImplementationServer(runtime, options);

        const forward =
            (req, res) => this.implementation.handle(req, res);

        this.services = {
            task: new services.TaskService({
                runtime,
                state: this.implementation.state,
                startTask: this.implementation.startTask
            }),
            session: new services.SessionService({ runtime }),
            settings: new services.SettingsService({ runtime }),
            events: new EventStreamService({
                events: runtime.events,
                auth: require("../../agent/config/ConsoleAuth")
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
                approvalStore: this.implementation.approvalStore,
                resolve: this.implementation.resolveApproval,
                forward
            }),
            mcp: new controllers.McpController({
                manager: toolRuntime.mcp._manager,
                forward
            }),
            archive: new controllers.ArchiveController({
                archive: require("../../agent/persistence/ArchiveRepository"),
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
            fallback: (req, res) => this.implementation.handle(req, res)
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
           adapter, so all callers share one client lifecycle. */
        this.sseHub = this.implementation.sseHub;

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

        await this.implementation.close();

        if (!this.server.listening) {
            return;
        }

        await new Promise(resolve => this.server.close(resolve));
    }


    facade() {

        const implementation = this.implementation;

        return {
            ...implementation,
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
