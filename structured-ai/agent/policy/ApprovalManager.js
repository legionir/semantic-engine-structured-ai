"use strict";

const readline = require("readline");

const settings = require("../lib/storage");
const {
    ApprovalDeniedError,
    unattendedApproval,
    interactiveApprovalUnavailable
} = require("./PolicyErrors");
const { ApprovalStore } = require("./ApprovalStore");


/* The historical handler and gateway cache were process-wide. Keep that
   property while giving each engine its own decision history. */
let approvalHandler = null;


class ApprovalManager {

    constructor({
        settingsStore,
        store,
        currentProjectId,
        mcpServerOf,
        globalMcpServer
    } = {}) {

        this.settings = settingsStore || settings;
        this.store = store || new ApprovalStore();
        this.currentProjectId =
            typeof currentProjectId === "function"
                ? currentProjectId
                : () => null;
        this.mcpServerOf =
            typeof mcpServerOf === "function"
                ? mcpServerOf
                : () => null;
        this.globalMcpServer =
            typeof globalMcpServer === "function"
                ? globalMcpServer
                : () => null;
    }


    getMode() {
        return this.settings.get("AGENT_APPROVAL");
    }


    setMode(mode) {
        return this.settings.set("AGENT_APPROVAL", mode);
    }


    setHandler(handler) {
        approvalHandler = handler;
    }


    setApprovalHandler(handler) {
        return this.setHandler(handler);
    }


    getApprovalMode() {
        return this.getMode();
    }


    setApprovalMode(mode) {
        return this.setMode(mode);
    }


    handler() {
        return approvalHandler;
    }


    get approvals() {
        return this.store.records();
    }


    async requestApproval(evaluation, args) {
        return this.request(evaluation, args);
    }


    async request(evaluation, args) {

        const projectId =
            evaluation.project_id || this.currentProjectId();

        const record = {
            tool: evaluation.tool,
            agent: evaluation.agent,
            reason: evaluation.reason,
            project_id: projectId,
            at: new Date().toISOString()
        };

        const serverName =
            this.mcpServerOf(evaluation.tool, args);

        const globalServer =
            projectId
                ? this.globalMcpServer(serverName)
                : null;

        if (
            globalServer &&
            this.store.hasGateway(serverName)
        ) {

            const cached =
                this.store.gatewayFor(serverName);

            record.approved = cached.approved;
            record.mode = "gateway";
            record.gateway_cached = true;

            this.store.record(record);

            if (!cached.approved) {
                throw new ApprovalDeniedError(
                    evaluation.tool,
                    evaluation.reason
                );
            }

            return record;
        }

        const mode = this.getMode();

        if (mode === "deny") {

            record.approved = false;
            record.mode = "deny";
            this.store.record(record);

            throw unattendedApproval(
                evaluation.tool,
                evaluation.reason
            );
        }

        const handler = this.handler();

        if (
            mode === "prompt" &&
            !handler &&
            !process.stdin.isTTY
        ) {

            record.approved = false;
            record.mode = "prompt (no tty)";
            this.store.record(record);

            throw interactiveApprovalUnavailable(
                evaluation.tool,
                evaluation.reason
            );
        }

        if (
            mode === "prompt" &&
            (handler || process.stdin.isTTY)
        ) {

            const answer =
                handler
                    ? await handler(evaluation, args)
                    : await this.prompt(evaluation, args);

            record.approved = answer;
            record.mode = "prompt";
            this.store.record(record);

            if (globalServer && serverName) {

                this.store.rememberGateway(serverName, {
                    approved: answer,
                    at: Date.now()
                });
            }

            if (!answer) {
                throw new ApprovalDeniedError(
                    evaluation.tool,
                    evaluation.reason
                );
            }

            return record;
        }

        record.approved = true;
        record.mode =
            mode === "prompt"
                ? "auto (no tty)"
                : "auto";

        if (globalServer && serverName) {

            this.store.rememberGateway(serverName, {
                approved: true,
                at: Date.now()
            });
        }

        this.store.record(record);
        return record;
    }


    prompt(evaluation, args) {

        const rl =
            readline.createInterface({
                input: process.stdin,
                output: process.stderr
            });

        const summary =
            JSON.stringify(args || {}).slice(0, 300);

        return new Promise(resolve => {

            rl.question(
                `\nApproval required\n  agent : ${
                    evaluation.agent
                }\n  tool  : ${
                    evaluation.tool
                }${
                    evaluation.project_id
                        ? `\n  project: ${evaluation.project_id}`
                        : ""
                }\n  reason: ${
                    evaluation.reason
                }\n  args  : ${summary}\nAllow? [y/N] `,
                answer => {

                    rl.close();

                    resolve(
                        /^y(es)?$/i.test(answer.trim())
                    );
                }
            );
        });
    }


    /*
    | Adapt the manager to a web/interactive pending-approval boundary.
    | The callback is intentionally just an operator-facing adapter; the
    | policy engine remains responsible for recording the final decision.
    */
    createPendingHandler({
        store,
        createId,
        projectIdOf,
        onRequest
    } = {}) {

        const pendingStore =
            store || this.store;

        return (evaluation, args) =>
            new Promise(resolve => {

                const projectId =
                    typeof projectIdOf === "function"
                        ? projectIdOf(evaluation, args)
                        : evaluation.project_id || this.currentProjectId() || null;

                const id =
                    typeof createId === "function"
                        ? createId(evaluation, args, pendingStore)
                        : `approval_${pendingStore.pendingSize() + 1}_${Date.now()}`;

                const request = {
                    id,
                    agent: evaluation.agent,
                    tool: evaluation.tool,
                    reason: evaluation.reason,
                    groups: evaluation.groups,
                    arguments: args,
                    project_id: projectId,
                    requested_at: Date.now(),
                    resolve
                };

                pendingStore.addPending(request);

                if (typeof onRequest === "function") {
                    onRequest(request, args);
                }
            });
    }
}


function setGlobalApprovalHandler(handler) {
    approvalHandler = handler;
}


module.exports = {
    ApprovalManager,
    setGlobalApprovalHandler
};
