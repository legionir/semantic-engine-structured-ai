"use strict";

/*
|--------------------------------------------------------------------------
| Per-tool MCP rules (roadmap P4-07)
|--------------------------------------------------------------------------
|
| What a server's own configuration says about one call, before the
| trust escalations of PolicyEngine.mcpEscalation:
|
|   agents      the server's tools exist only for these agents: any other
|               agent's call is denied (and the tools are not declared to
|               it, see McpRuntime)
|   include /   a tool switched off in the console (exclude) is denied
|   exclude     even when called by name through mcp_call
|   approval    {read, write}: read is a tool annotated readOnlyHint,
|               write any other (an unannotated tool counts as write);
|               always asks every time, never lets it run without asking,
|               inherit leaves it to the policy rules and the trust level
|
| target() resolves both call shapes, mcp__server__tool and mcp_call
| {server, tool} / {tool: "mcp__server__tool"}.
|--------------------------------------------------------------------------
*/

const { DECISIONS } = require("./PolicyMatcher");


function target(manager, toolName, args = {}) {

    const { parseToolName } = require("../mcp/McpCatalogue");

    let server = null;
    let tool = null;

    if (toolName === "mcp_call") {

        const requested = args && (args.tool || args.name);

        if (typeof requested !== "string" || requested === "") return null;

        const parsed = parseToolName(requested);

        server = parsed ? parsed.server : (args.server ? String(args.server) : null);
        tool = parsed ? parsed.tool : requested;

    } else if (toolName.startsWith("mcp__")) {

        const entry = manager.catalogueEntry(toolName);
        const parsed = entry ? { server: entry.server, tool: entry.tool } : parseToolName(toolName);

        if (!parsed) return null;

        server = parsed.server;
        tool = parsed.tool;

    } else {
        return null;
    }

    if (!server) return null;

    let client = null;

    try {
        client = manager.client(server);
    } catch {
        client = null;
    }

    let entry = null;

    try {
        entry =
            (typeof manager.catalogueEntries === "function"
                ? manager.catalogueEntries().find(item => item.server === server && item.tool === tool)
                : null) ||
            (client && Array.isArray(client.tools) ? client.tools.find(item => item.name === tool) : null) ||
            null;
    } catch {
        entry = null;
    }

    return { server, tool, config: client ? client.config : null, entry };
}


function isReadOnly(entry) {

    return Boolean(entry && entry.annotations && entry.annotations.readOnlyHint === true);
}


/* the server's rule for this call, or null to go on with the trust checks */
function mcpToolRule(manager, toolName, { args, agent, globalMode } = {}) {

    if (!manager) return null;

    const found = target(manager, toolName, args || {});

    if (!found || !found.config) return null;

    const { server, tool, config, entry } = found;

    /* a sub-agent's scope is "<name>#<depth>" */
    const agentName = agent ? String(agent).replace(/#\d+$/, "") : null;

    if (Array.isArray(config.agents) && config.agents.length > 0 && agentName && agentName !== "web_console" && !config.agents.includes(agentName)) {
        return {
            decision: DECISIONS.DENY,
            reason: `the MCP server "${server}" is limited to ${config.agents.join(", ")}`,
            rule: "mcp_agent_scope"
        };
    }

    const { matchesFilter } = require("../mcp/McpCatalogue");

    if (!matchesFilter(tool, config.include, config.exclude)) {
        return {
            decision: DECISIONS.DENY,
            reason: `the tool "${tool}" of MCP server "${server}" is switched off`,
            rule: "mcp_tool_disabled"
        };
    }

    if (globalMode === "always" || globalMode === "never") {
        return null;
    }

    const kind = isReadOnly(entry) ? "read" : "write";
    const setting = config.approval ? config.approval[kind] : "inherit";

    if (setting === "always") {
        return {
            decision: DECISIONS.REQUIRE_APPROVAL,
            reason: `the MCP server "${server}" asks before every ${kind === "read" ? "read-only" : "writing"} tool`,
            rule: `mcp_approval_${kind}`
        };
    }

    if (setting === "never") {
        return {
            decision: DECISIONS.ALLOW,
            reason: `the MCP server "${server}" runs its ${kind === "read" ? "read-only" : "writing"} tools without asking`,
            rule: `mcp_approval_${kind}`
        };
    }

    return null;
}


module.exports = { target, isReadOnly, mcpToolRule };
