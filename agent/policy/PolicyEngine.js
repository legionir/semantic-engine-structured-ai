"use strict";

const settings = require("../config");

const { PolicyMatcher, DECISIONS } = require("./PolicyMatcher");
const { PolicyRegistry } = require("./PolicyRegistry");
const { ApprovalManager } = require("./ApprovalManager");
const { planModeRefusal, isPlanModeRun } = require("./PlanModeGate");
const {
    PolicyDeniedError
} = require("./PolicyErrors");


function currentRunContext() {

    try {

        const runtime = require("../runtime");

        return runtime.runManager && typeof runtime.runManager.current === "function"
            ? runtime.runManager.current()
            : null;

    } catch {
        return null;
    }
}


function planModeRefusalForCurrentRun(toolName, args) {

    if (!isPlanModeRun(currentRunContext())) {
        return null;
    }

    return planModeRefusal(toolName, args || {}, {
        catalogueEntry: (name, callArgs) => {
            try {
                const { manager } = require("../mcp/McpManager");
                return manager ? destructiveHintEntry(manager, name, callArgs || {}) : null;
            } catch {
                return null;
            }
        }
    });
}


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

        /*
        | P0-2: same precedence as mcp_call itself (McpTools.mcpCall): a
        | namespaced tool name carries its own server and wins over the
        | `server` argument, so the approval is attributed to the server
        | that actually runs the call.
        */
        const requested =
            args && (args.tool || args.name);

        if (typeof requested === "string") {

            try {

                const { parseToolName } = require("../mcp/McpManager");
                const parsed = parseToolName(requested);

                if (parsed) {
                    return parsed.server;
                }

            } catch {
                /* fall through to the server argument */
            }
        }

        if (args && args.server) {
            return String(args.server);
        }

        return null;
    }

    try {

        const { parseToolName } = require("../mcp/McpManager");
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

        const { manager } = require("../mcp/McpManager");
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


/*
| P0-2: the trust of the server a call really reaches. A namespaced tool
| carries it on its catalogue entry; a gateway call (mcp_call) names the
| server in its arguments, so the server's own configuration decides.
| Before this, only the namespaced form was escalated and
| mcp_call {server:"restricted-one"} ran as a plain allow.
*/
function serverTrust(manager, serverName) {

    if (!serverName) {
        return null;
    }

    try {

        const client = manager.client(serverName);

        return client && client.config
            ? client.config.trust || null
            : null;

    } catch {
        return null;
    }
}


function restrictedServer(manager, toolName, args) {

    let parseToolName = null;

    try {
        ({ parseToolName } = require("../mcp/McpManager"));
    } catch {
        parseToolName = null;
    }

    const parse = name => {

        try {
            return parseToolName ? parseToolName(name) : null;
        } catch {
            return null;
        }
    };

    if (toolName !== "mcp_call") {

        const entry = manager.catalogueEntry(toolName);

        if (entry) {
            return entry.trust === "restricted" ? entry.server : null;
        }

        const parsed = parse(toolName);

        return parsed && serverTrust(manager, parsed.server) === "restricted"
            ? parsed.server
            : null;
    }

    const requested =
        args && (args.tool || args.name);

    const parsed =
        typeof requested === "string" ? parse(requested) : null;

    if (parsed) {

        const entry = manager.catalogueEntry(String(requested));

        if (entry && entry.trust === "restricted") {
            return entry.server;
        }
    }

    const serverName =
        parsed
            ? parsed.server
            : args && args.server
                ? String(args.server)
                : null;

    return serverTrust(manager, serverName) === "restricted"
        ? serverName
        : null;
}


function destructiveHintEntry(manager, toolName, args) {

    const requested = toolName === "mcp_call"
        ? args && (args.tool || args.name)
        : toolName;

    if (typeof requested !== "string") {
        return null;
    }

    try {

        const direct = manager.catalogueEntry(requested);
        if (direct) {
            return direct;
        }

        const parsed = require("../mcp/McpManager").parseToolName(requested);
        const server = parsed ? parsed.server : args && args.server;
        const tool = parsed ? parsed.tool : requested;
        if (!server || typeof manager.catalogueEntries !== "function") {
            return null;
        }

        return manager.catalogueEntries().find(entry =>
            entry.server === String(server) && entry.tool === String(tool)
        ) || null;

    } catch {

        return null;
    }
}


function mcpEscalation(toolName, { settingsStore = settings, args, mcpManager } = {}) {

    const isGatewayCall =
        toolName === "mcp_call";

    const isNamespaced =
        toolName.startsWith("mcp__");

    if (!isGatewayCall && !isNamespaced) {
        return null;
    }

    const mode =
        settingsStore.get("MCP_APPROVAL");

    if (mode === "always") {

        return {
            decision: DECISIONS.REQUIRE_APPROVAL,
            reason: "every MCP call needs approval (MCP_APPROVAL=always)",
            rule: "mcp_approval_always"
        };
    }

    let manager = mcpManager;

    if (!manager) {
        try {
            ({ manager } = require("../mcp/McpManager"));
        } catch {
            manager = null;
        }
    }

    const annotated = manager
        ? destructiveHintEntry(manager, toolName, args || {})
        : null;

    if (annotated?.annotations?.destructiveHint === true) {
        return {
            decision: DECISIONS.REQUIRE_APPROVAL,
            reason: "the MCP tool declares destructiveHint=true",
            rule: "mcp_destructive_hint"
        };
    }

    if (mode === "never" || !manager) {
        return null;
    }

    const server =
        restrictedServer(manager, toolName, args || {});

    if (!server) {
        return null;
    }

    return {
        decision: DECISIONS.REQUIRE_APPROVAL,
        reason: `the MCP server "${server}" is configured as restricted`,
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
                    (toolName, context = {}) =>
                        mcpEscalation(toolName, {
                            settingsStore: this.settings,
                            args: context.args
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

        /* P3-03: plan mode refuses project changes before any rule or approval */
        const planRefusal = planModeRefusalForCurrentRun(toolName, args);

        if (planRefusal) {

            this.onDecision({
                tool: toolName,
                agent,
                decision: DECISIONS.DENY,
                reason: planRefusal,
                rule: "plan_mode"
            });
            throw new PolicyDeniedError(toolName, planRefusal);
        }

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

            /*
            | SA-POL-004/SA-POL-008: a denied approval used to throw out of
            | `requestApproval` before any decision event was emitted — the
            | audit trail only ever saw approvals that were granted. The
            | denial IS the security-relevant event; emit it (with
            | approved:false) before rethrowing.
            */
            let approval;

            try {

                approval = await this.requestApproval(evaluation, args);

            } catch (error) {

                this.onDecision({
                    ...evaluation,
                    approved: false,
                    denial: true
                });
                throw error;
            }

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

        /* SA-POL-004: same denial-audit contract as `enforce` above. */
        let approval;

        try {

            approval = await this.requestApproval(evaluation, args);

        } catch (error) {

            this.onDecision({
                ...evaluation,
                approved: false,
                denial: true
            });
            throw error;
        }

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
