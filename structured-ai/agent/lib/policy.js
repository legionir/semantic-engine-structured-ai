const readline = require("readline");

const settings = require("./storage");


/*
|--------------------------------------------------------------------------
| Policy Engine
|--------------------------------------------------------------------------
|
| The tool allowlist on an Agent Profile answers "may this agent use this
| capability at all". The policy engine answers the separate question
| "may this specific call run right now", and is the single place where
| a destructive operation can be denied or sent for approval.
|
|   Agent -> Tool Request -> Policy Engine -> allow
|                                          -> deny
|                                          -> require_approval -> Approval
|
| Rules are declarative and live in registry/policy.json so the runtime
| behaviour can be changed without touching code.
|--------------------------------------------------------------------------*/

const DECISIONS = {
    ALLOW: "allow",
    DENY: "deny",
    REQUIRE_APPROVAL: "require_approval"
};


/*
| auto   approve everything a rule sends for approval, and record it
| prompt ask on the terminal, only usable when stdin is a TTY
| deny   refuse anything that needs approval, for unattended runs
*/

/*
| An interactive front end already owns stdin, so it injects its own
| handler instead of letting the engine open a second reader.
*/

let approvalHandler = null;

/* Phase 9: one gateway-level approval for a scope:global MCP server,
   reused across projects; each use is audited with the consuming
   project_id. Only engaged when a run actually has a project_id so
   legacy single-project approval is unchanged. */
const gatewayApprovals = new Map();


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
            runtime.runManager && typeof runtime.runManager.current === "function"
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


function resetGatewayApprovals() {

    gatewayApprovals.clear();
}


function getApprovalMode() {

    return settings.get("AGENT_APPROVAL");
}


function setApprovalMode(mode) {

    return settings.set("AGENT_APPROVAL", mode);
}


function setApprovalHandler(handler) {

    approvalHandler = handler;
}


function matchesGlob(pattern, value) {

    const escaped =
        pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`, "i").test(value);
}


function valueAtPath(source, pathExpression) {

    return pathExpression
        .split(".")
        .reduce(
            (current, segment) =>
                current === null || current === undefined
                    ? current
                    : current[segment],
            source
        );
}


function conditionMatches(condition, context) {

    /*
    | A rule without conditions matches every call to its target.
    */

    if (!condition) {
        return true;
    }

    if (
        condition.agents &&
        !condition.agents.some(
            pattern =>
                matchesGlob(pattern, context.agent)
        )
    ) {
        return false;
    }

    if (condition.argument_matches) {

        for (
            const [argumentPath, patterns]
            of Object.entries(condition.argument_matches)
        ) {

            const value =
                valueAtPath(context.args, argumentPath);

            const text =
                value === undefined || value === null
                    ? ""
                    : String(value);

            const matched =
                patterns.some(
                    pattern =>
                        new RegExp(pattern, "i").test(text)
                );

            if (!matched) {
                return false;
            }
        }
    }

    if (condition.argument_absent) {

        for (const argumentPath of condition.argument_absent) {

            const value =
                valueAtPath(context.args, argumentPath);

            if (
                value !== undefined &&
                value !== null &&
                value !== false
            ) {
                return false;
            }
        }
    }

    return true;
}


/*
| An MCP tool runs outside this runtime, so the workspace boundary and
| the argument guards that protect a built-in tool do not apply to it.
| What is left is the operator's own judgement, recorded per server as
| its trust setting, and MCP_APPROVAL as a blanket override. Neither can
| make a call more permissive than the rules already decided, so this is
| an escalation and never a downgrade.
*/

function mcpEscalation(toolName) {

    const isGatewayCall =
        toolName === "mcp_call";

    const isNamespaced =
        toolName.startsWith("mcp__");

    if (!isGatewayCall && !isNamespaced) {
        return null;
    }

    const mode =
        settings.get("MCP_APPROVAL");

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

        /*
        | Through the gateway the server is an argument, and it is
        | resolved where the call is made rather than guessed here.
        */

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


function ruleTargets(rule, toolName, groupsForTool) {

    if (rule.tools) {

        return rule.tools.some(
            pattern =>
                matchesGlob(pattern, toolName)
        );
    }

    if (rule.groups) {

        return rule.groups.some(
            group =>
                groupsForTool.includes(group)
        );
    }

    return false;
}


class PolicyEngine {

    constructor({
        policy,
        toolGroups,
        onDecision
    }) {

        this.approvals = [];

        this.onDecision =
            onDecision || (() => {});

        this.reload({ policy, toolGroups });
    }


    /*
    | The rules come from a file, so the engine has to be able to take a
    | new version of them without the process restarting.
    */

    reload({ policy, toolGroups }) {

        this.policy =
            policy || {
                default_action: DECISIONS.ALLOW,
                rules: []
            };

        this.groupsByTool =
            new Map();

        for (
            const [group, definition]
            of Object.entries(toolGroups || {})
        ) {

            for (const tool of definition.tools || []) {

                this.groupsByTool.set(
                    tool,
                    [
                        ...(this.groupsByTool.get(tool) || []),
                        group
                    ]
                );
            }
        }

        return this;
    }


    groupsFor(toolName) {

        return this.groupsByTool.get(toolName) || [];
    }


    /*
    | The last matching rule wins, so a specific rule can be written
    | after a broad one.
    */

    evaluate(toolName, args, agent) {

        const context = {
            args: args || {},
            agent: agent || "main_agent"
        };

        const groups =
            this.groupsFor(toolName);

        let decision = {
            decision:
                this.policy.default_action ||
                DECISIONS.ALLOW,

            reason:
                "default policy",

            rule: null
        };

        for (const rule of this.policy.rules || []) {

            if (!ruleTargets(rule, toolName, groups)) {
                continue;
            }

            if (!conditionMatches(rule.when, context)) {
                continue;
            }

            decision = {
                decision:
                    rule.action,

                reason:
                    rule.reason ||
                    `rule "${rule.id || rule.action}"`,

                rule:
                    rule.id || null
            };
        }

        /*
        | A denial stands; anything softer may still be escalated by the
        | server's own trust setting.
        */

        if (decision.decision !== DECISIONS.DENY) {

            const escalation =
                mcpEscalation(toolName);

            if (escalation) {
                decision = escalation;
            }
        }

        return {
            tool: toolName,
            agent: context.agent,
            groups,
            ...decision
        };
    }


    async requestApproval(evaluation, args) {

        const projectId =
            evaluation.project_id || currentProjectId();

        const record = {
            tool:
                evaluation.tool,

            agent:
                evaluation.agent,

            reason:
                evaluation.reason,

            project_id:
                projectId,

            at:
                new Date().toISOString()
        };

        const serverName =
            mcpServerOf(evaluation.tool, args);

        const globalServer =
            projectId ? globalMcpServer(serverName) : null;

        if (globalServer && gatewayApprovals.has(serverName)) {

            const cached = gatewayApprovals.get(serverName);

            record.approved = cached.approved;
            record.mode = "gateway";
            record.gateway_cached = true;

            this.approvals.push(record);

            if (!cached.approved) {

                throw new Error(
                    `Tool "${evaluation.tool}" was denied by the operator: ${evaluation.reason}`
                );
            }

            return record;
        }

        if (getApprovalMode() === "deny") {

            record.approved = false;
            record.mode = "deny";

            this.approvals.push(record);

            throw new Error(
                `Tool "${evaluation.tool}" requires approval and the runtime is running unattended (AGENT_APPROVAL=deny): ${evaluation.reason}`
            );
        }

        if (
            getApprovalMode() === "prompt" &&
            !approvalHandler &&
            !process.stdin.isTTY
        ) {
            record.approved = false;
            record.mode = "prompt (no tty)";
            this.approvals.push(record);

            throw new Error(
                `Tool "${evaluation.tool}" requires an interactive approval, but no approval handler or TTY is available: ${evaluation.reason}`
            );
        }

        if (
            getApprovalMode() === "prompt" &&
            (approvalHandler || process.stdin.isTTY)
        ) {

            const answer =
                approvalHandler
                    ? await approvalHandler(evaluation, args)
                    : await this.prompt(evaluation, args);

            record.approved = answer;
            record.mode = "prompt";

            this.approvals.push(record);

            if (globalServer && serverName) {
                gatewayApprovals.set(serverName, {
                    approved: answer,
                    at: Date.now()
                });
            }

            if (!answer) {

                throw new Error(
                    `Tool "${evaluation.tool}" was denied by the operator: ${evaluation.reason}`
                );
            }

            return record;
        }

        record.approved = true;

        record.mode =
            getApprovalMode() === "prompt"
                ? "auto (no tty)"
                : "auto";

        if (globalServer && serverName) {
            gatewayApprovals.set(serverName, {
                approved: true,
                at: Date.now()
            });
        }

        this.approvals.push(record);

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
    | The single enforcement point called by the tool graph.
    */

    async enforce(toolName, args, agent) {

        const evaluation =
            this.evaluate(toolName, args, agent);

        /* Additive project attribution only when a project is actually
           in scope. Stamping `project_id: null` would change the
           historical shape of every legacy policy:decision. */
        const projectId = currentProjectId();

        if (projectId) {
            evaluation.project_id = projectId;
        }

        if (evaluation.decision === DECISIONS.DENY) {

            this.onDecision(evaluation);

            throw new Error(
                `Tool "${toolName}" is denied by policy: ${evaluation.reason}`
            );
        }

        if (
            evaluation.decision ===
            DECISIONS.REQUIRE_APPROVAL
        ) {

            const approval =
                await this.requestApproval(evaluation, args);

            this.onDecision({
                ...evaluation,

                approved:
                    approval.approved,

                approval_mode:
                    approval.mode,

                gateway_cached:
                    approval.gateway_cached === true
            });

            return evaluation;
        }

        this.onDecision(evaluation);

        return evaluation;
    }


    summary() {

        return {
            mode:
                getApprovalMode(),

            default_action:
                this.policy.default_action,

            rules:
                (this.policy.rules || []).length,

            approvals:
                this.approvals.length
        };
    }
}


module.exports = {
    PolicyEngine,
    DECISIONS,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler,
    resetGatewayApprovals
};
