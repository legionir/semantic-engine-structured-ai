"use strict";

const settings = require("../lib/storage");

const { PolicyMatcher, DECISIONS } = require("./PolicyMatcher");
const { PolicyRegistry } = require("./PolicyRegistry");
const { ApprovalManager } = require("./ApprovalManager");
const {
    PolicyDeniedError
} = require("./PolicyErrors");


function currentProjectId() {

    try {

        const runtime = require("../runtime");

        if (typeof runtime.effectiveProjectId === "function") {

            const overridden = runtime.effectiveProjectId();

            if (overridden) {
                return overridden;
            }
        }

        const run =
            runtime.runManager &&
            typeof runtime.runManager.current === "function"
                ? runtime.runManager.current()
                : null;

        return run && run.projectId ? run.projectId : null;

    } catch {
        return null;
    }
}


function mcpServerOf(toolName, args) {

    if (toolName === "mcp_call") {

        if (args && args.server) {
            return String(args.server);
        }

        const requested =
            args && (args.tool || args.name);

        if (typeof requested === "string") {

            try {

                const { parseToolName } = require("../mcp/manager");
                const parsed = parseToolName(requested);
                return parsed ? parsed.server : null;

            } catch {
                return null;
            }
        }

        return null;
    }

    try {

        const { parseToolName } = require("../mcp/manager");
        const parsed = parseToolName(toolName);
        return parsed ? parsed.server : null;

    } catch {
        return null;
    }
}


function globalMcpServer(serverName) {

    if (!serverName) {
        return null;
    }

    try {

        const { manager } = require("../mcp/manager");
        const client = manager.client(serverName);

        if (!client) {
            return null;
        }

        return (client.config.scope || "global") === "global"
            ? client
            : null;

    } catch {
        return null;
    }
}


function mcpEscalation(toolName, { settingsStore = settings } = {}) {

    const isGatewayCall =
        toolName === "mcp_call";

    const isNamespaced =
        toolName.startsWith("mcp__");

    if (!isGatewayCall && !isNamespaced) {
        return null;
    }

    const mode =
        settingsStore.get("MCP_APPROVAL");

    if (mode === "never") {
        return null;
    }

    if (mode === "always") {

        return {
            decision: DECISIONS.REQUIRE_APPROVAL,
            reason: "every MCP call needs approval (MCP_APPROVAL=always)",
            rule: "mcp_approval_always"
        };
    }

    if (!isNamespaced) {
        return null;
    }

    let manager;

    try {
        ({ manager } = require("../mcp/manager"));
    } catch {
        return null;
    }

    const entry =
        manager.catalogueEntry(toolName);

    if (!entry || entry.trust !== "restricted") {
        return null;
    }

    return {
        decision: DECISIONS.REQUIRE_APPROVAL,
        reason: `the MCP server "${entry.server}" is configured as restricted`,
        rule: "mcp_restricted_server"
    };
}


class PolicyEngine {

    constructor({
        policy,
        toolGroups,
        onDecision,
        settingsStore,
        registry,
        matcher,
        approvalManager
    } = {}) {

        this.settings = settingsStore || settings;
        this.registry =
            registry ||
            new PolicyRegistry({
                policy,
                toolGroups
            });

        this.approvalManager =
            approvalManager ||
            new ApprovalManager({
                settingsStore: this.settings,
                currentProjectId,
                mcpServerOf,
                globalMcpServer
            });

        this.matcher =
            matcher ||
            new PolicyMatcher({
                mcpEscalation:
                    toolName =>
                        mcpEscalation(toolName, {
                            settingsStore: this.settings
                        })
            });

        this.onDecision =
            onDecision || (() => {});
    }


    get approvals() {
        return this.approvalManager.approvals;
    }


    /* Compatibility views retained for callers that inspected the old
       monolithic engine while the wrapper migration is in progress. */
    get policy() {
        return this.registry.policy;
    }


    get groupsByTool() {
        return this.registry.groupsByTool;
    }


    reload({ policy, toolGroups } = {}) {

        this.registry.reload({ policy, toolGroups });
        return this;
    }


    groupsFor(toolName) {
        return this.registry.groupsFor(toolName);
    }


    evaluate(toolName, args, agent) {

        return this.matcher.evaluate(
            toolName,
            args,
            agent,
            this.registry
        );
    }


    async requestApproval(evaluation, args) {
        return this.approvalManager.request(evaluation, args);
    }


    prompt(evaluation, args) {
        return this.approvalManager.prompt(evaluation, args);
    }


    async enforce(toolName, args, agent) {

        const evaluation =
            this.evaluate(toolName, args, agent);

        /* Add project attribution only when a project is actually scoped. */
        const projectId = currentProjectId();

        if (projectId) {
            evaluation.project_id = projectId;
        }

        if (evaluation.decision === DECISIONS.DENY) {

            this.onDecision(evaluation);
            throw new PolicyDeniedError(toolName, evaluation.reason);
        }

        if (evaluation.decision === DECISIONS.REQUIRE_APPROVAL) {

            const approval =
                await this.requestApproval(evaluation, args);

            this.onDecision({
                ...evaluation,
                approved: approval.approved,
                approval_mode: approval.mode,
                gateway_cached: approval.gateway_cached === true
            });

            return evaluation;
        }

        this.onDecision(evaluation);
        return evaluation;
    }


    /* Used by cross-project/multi-project write guards. Keeping the
       lifecycle here ensures every approval is recorded and audited by the
       same boundary as ordinary policy approvals. */
    async enforceApproval(evaluation, args) {

        const approval =
            await this.requestApproval(evaluation, args);

        this.onDecision({
            ...evaluation,
            approved: approval.approved,
            approval_mode: approval.mode,
            gateway_cached: approval.gateway_cached === true
        });

        return approval;
    }


    /*
    | The extra guard for a delegated write is policy, not tool execution.
    | Runtime supplies the current project frame and the feature gate; the
    | approval lifecycle and audit callback stay centralized here.
    */
    async enforceCrossProjectWrite({
        toolName,
        args,
        agent,
        enabled,
        fileMutatingTools,
        currentRun,
        effectiveProject,
        projectIdOf,
        isMultiProjectTask
    } = {}) {

        if (
            !enabled ||
            !Array.isArray(fileMutatingTools) ||
            !fileMutatingTools.includes(toolName)
        ) {
            return null;
        }

        const run = currentRun();
        const effective = effectiveProject(run.project);
        const effectiveId =
            projectIdOf(effective) || run.projectId || null;
        const parentId =
            run.projectId || projectIdOf(run.project) || null;
        const cross =
            Boolean(effectiveId && parentId && effectiveId !== parentId);
        const multi = isMultiProjectTask(run);

        if (!cross && !multi) {
            return null;
        }

        const evaluation = {
            tool: toolName,
            agent: agent || "main_agent",
            groups: this.groupsFor(toolName),
            decision: DECISIONS.REQUIRE_APPROVAL,
            reason:
                cross
                    ? `cross-project write on "${effectiveId}" (run project is "${parentId}")`
                    : `write in a multi-project task (project "${effectiveId || parentId}")`,
            rule:
                cross
                    ? "cross_project_write"
                    : "multi_project_write",
            project_id: effectiveId
        };

        return this.enforceApproval(evaluation, args);
    }


    summary() {

        return {
            mode:
                this.approvalManager.getMode(),
            default_action:
                this.registry.defaultAction(),
            rules:
                this.registry.rules().length,
            approvals:
                this.approvals.length
        };
    }
}


module.exports = {
    PolicyEngine,
    DECISIONS,
    currentProjectId,
    mcpServerOf,
    globalMcpServer,
    mcpEscalation
};
