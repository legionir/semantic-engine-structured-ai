"use strict";

const readline = require("readline");

const settings = require("../config");
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

        const mode = this.getMode();

        /*
        | P0-2: AGENT_APPROVAL=deny is terminal. It used to be checked only
        | after the gateway cache, so an approval remembered for a global
        | MCP server (granted while the mode was auto/prompt) kept running
        | calls unattended after the operator switched to deny.
        */
        if (mode === "deny") {

            record.approved = false;
            record.mode = "deny";
            this.store.record(record);

            throw unattendedApproval(
                evaluation.tool,
                evaluation.reason
            );
        }

        /*
        | P0-2: a remembered gateway answer expires. It used to be reused for
        | the life of the process, so one answer gave a global MCP server
        | unattended access until restart. MCP_GATEWAY_APPROVAL_TTL_MS bounds
        | the reuse; 0 asks every time.
        */
        const cached =
            globalServer
                ? this.freshGateway(serverName)
                : null;

        if (cached) {

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

        /* P0-2: an automatic answer is not remembered as a gateway
           approval; only a human answer is, so switching to prompt asks
           again instead of reusing what auto mode decided. */

        this.store.record(record);
        return record;
    }


    /*
    | How long a remembered gateway answer may be reused, in milliseconds.
    | An injected settings store that does not know the key falls back to
    | the real settings, so the shipped default still applies.
    */
    gatewayTtlMs() {

        const key = "MCP_GATEWAY_APPROVAL_TTL_MS";

        let value = null;

        try {
            value = this.settings.get(key);
        } catch {
            value = null;
        }

        if (value === null || value === undefined) {
            value = settings.get(key);
        }

        const ttl = Number(value);

        return Number.isFinite(ttl) && ttl > 0
            ? ttl
            : 0;
    }


    /*
    | The cached gateway answer for a server, or null when there is none or
    | it has expired. An entry without a numeric timestamp cannot be aged,
    | so it is treated as expired rather than trusted forever.
    */
    freshGateway(serverName) {

        if (
            !serverName ||
            !this.store.hasGateway(serverName)
        ) {
            return null;
        }

        const cached =
            this.store.gatewayFor(serverName);

        if (!cached) {
            return null;
        }

        const at = Number(cached.at);
        const ttl = this.gatewayTtlMs();

        if (
            !Number.isFinite(at) ||
            ttl <= 0 ||
            Date.now() - at >= ttl
        ) {
            return null;
        }

        return cached;
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
            new Promise((resolve, reject) => {

                const projectId =
                    typeof projectIdOf === "function"
                        ? projectIdOf(evaluation, args)
                        : evaluation.project_id || this.currentProjectId() || null;

                const id =
                    typeof createId === "function"
                        ? createId(evaluation, args, pendingStore)
                        : `approval_${pendingStore.pendingSize() + 1}_${Date.now()}`;

                /*
                | SA-POL-002/SA-POL-006: the pending promise used to settle
                | ONLY on an operator answer. A run cancelled or aborted
                | while its approval was pending stayed `pending:1,
                | settled:false` forever — the run's finally could never
                | complete and the operator kept seeing a question nobody
                | would ever answer. The approval now binds to the owning
                | run's cancellation signal: when the run is cancelled the
                | request is removed from pending and the promise rejects
                | with RUN_CANCELLED, so the waiting stack unwinds honestly.
                */
                const settle = (answer) => {

                    if (signal && onAbort) {
                        signal.removeEventListener("abort", onAbort);
                    }
                    resolve(answer);
                };

                let signal = null;
                let onAbort = null;

                try {

                    const runtime = require("../runtime");
                    const context =
                        runtime.runManager &&
                        typeof runtime.runManager.current === "function"
                            ? runtime.runManager.current()
                            : null;

                    signal = context?.cancellation?.signal || null;

                    if (signal && signal.aborted) {

                        reject(
                            Object.assign(
                                new Error("run cancelled before approval was answered"),
                                { code: "RUN_CANCELLED" }
                            )
                        );
                        return;
                    }

                    if (signal) {

                        onAbort = () => {

                            pendingStore.removePending(id);

                            reject(
                                Object.assign(
                                    new Error("run cancelled while the approval was pending"),
                                    { code: "RUN_CANCELLED" }
                                )
                            );
                        };

                        signal.addEventListener("abort", onAbort, { once: true });
                    }

                } catch {
                    /* runtime not wired (unit contexts): keep the legacy
                       operator-only settlement rather than failing the ask */
                    signal = null;
                }

                const request = {
                    id,
                    agent: evaluation.agent,
                    tool: evaluation.tool,
                    reason: evaluation.reason,
                    groups: evaluation.groups,
                    arguments: args,
                    project_id: projectId,
                    requested_at: Date.now(),
                    resolve: settle
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
