"use strict";

/*
|--------------------------------------------------------------------------
| MCP search, resources and prompts as tools (roadmap P4-06, P4-10)
|--------------------------------------------------------------------------
|
|   mcp_search_tools   loads the definitions of tools that were left out of
|                      the request (lazy loading): by query, by name, or by
|                      server; the answer stays under the definitions budget
|   mcp_resources      a server's resources and resource templates, or the
|                      contents of one (uri)
|   mcp_prompts        a server's prompts, or one prompt rendered with its
|                      arguments (the messages it expands to)
|
| Every server use goes through manager.usableClient(), the same checks a
| tool call makes: switched on, trusted, in scope for the project and
| the agent.
|--------------------------------------------------------------------------
*/

const settings = require("../../config");
const { manager } = require("../../mcp/McpManager");
const budgeter = require("../../mcp/McpToolBudget");


function activeProjectId() {

    try {
        return require("../../runtime/ProjectOverride").effectiveProjectId() || null;
    } catch {
        return null;
    }
}


function unavailable(reason) {

    return { ok: false, available: false, error: reason };
}


function truncate(text, limit) {

    const value = String(text ?? "");

    return value.length > limit ? `${value.slice(0, limit)}… (${value.length - limit} more characters)` : value;
}


async function mcpSearchTools(args = {}) {

    if (!manager.enabled()) {
        return unavailable("MCP is disabled (MCP_ENABLED=false).");
    }

    await manager.discover({ force: Boolean(args.refresh) });

    const entries =
        manager.catalogueEntries(activeProjectId(), { agent: args._agent });

    const limit =
        Math.min(Math.max(Number(args.limit) || 5, 1), 25);

    const found =
        budgeter.search(entries, {
            query: args.query,
            names: Array.isArray(args.names) ? args.names : null,
            server: args.server ? String(args.server) : null,
            limit
        });

    const budget =
        settings.get("MCP_TOOL_DEFINITIONS_BUDGET") || 24000;

    const tools = [];
    let used = 0;
    let omitted = 0;

    for (const entry of found) {

        const definition = {
            name: entry.name,
            server: entry.server,
            tool: entry.tool,
            description: truncate(entry.description, 2000),
            input_schema: entry.input_schema || { type: "object", properties: {} },
            ...(entry.annotations ? { annotations: entry.annotations } : {})
        };

        const cost = JSON.stringify(definition).length;

        if (used + cost > budget && tools.length > 0) {
            omitted++;
            continue;
        }

        tools.push(definition);
        used += cost;
    }

    return {
        ok: true,
        query: args.query || null,
        total_tools: entries.length,
        returned: tools.length,
        omitted_over_budget: omitted || undefined,
        how_to_call: "mcp_call {tool: \"<name>\", arguments: {…}} with arguments matching input_schema",
        tools
    };
}


function requireServer(args) {

    const server = args.server ? String(args.server) : "";

    if (!server) {
        throw new Error("name the MCP server (server)");
    }

    return manager.usableClient(server, { projectId: activeProjectId(), agent: args._agent });
}


function contentsOf(contents) {

    const limit = settings.get("MCP_EXCERPT_CHARS") ? Math.max(settings.get("MCP_EXCERPT_CHARS") * 40, 4000) : 12000;

    return (contents || []).map(item => {
        if (typeof item.text === "string") {
            return { uri: item.uri, mimeType: item.mimeType, text: truncate(item.text, limit) };
        }
        if (typeof item.blob === "string") {
            return { uri: item.uri, mimeType: item.mimeType, blob_bytes: Math.floor(item.blob.length * 3 / 4), note: "binary content is not shown" };
        }
        return item;
    });
}


async function mcpResources(args = {}) {

    if (!manager.enabled()) {
        return unavailable("MCP is disabled (MCP_ENABLED=false).");
    }

    const client = requireServer(args);

    if (args.uri) {

        const contents = await client.readResource(String(args.uri));

        return { ok: true, server: client.name, uri: String(args.uri), contents: contentsOf(contents) };
    }

    const [resources, templates] = await Promise.all([client.listResources(), client.listResourceTemplates()]);
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);

    return {
        ok: true,
        server: client.name,
        total: resources.length,
        resources: resources.slice(0, limit).map(item => ({
            uri: item.uri,
            name: item.name,
            description: item.description ? truncate(item.description, 300) : undefined,
            mimeType: item.mimeType
        })),
        templates: templates.slice(0, limit).map(item => ({
            uriTemplate: item.uriTemplate,
            name: item.name,
            description: item.description ? truncate(item.description, 300) : undefined
        })),
        how_to_read: "mcp_resources {server, uri}"
    };
}


/* the text a prompt expands to, one message per entry */
function renderPrompt(result) {

    return ((result && result.messages) || []).map(message => {
        const content = message.content || {};
        if (content.type === "text") return { role: message.role, text: content.text };
        if (content.type === "resource" && content.resource) {
            return { role: message.role, resource: content.resource.uri, text: content.resource.text };
        }
        return { role: message.role, content: content.type || "unknown" };
    });
}


async function mcpPrompts(args = {}) {

    if (!manager.enabled()) {
        return unavailable("MCP is disabled (MCP_ENABLED=false).");
    }

    const client = requireServer(args);

    if (args.name) {

        const values = args.arguments && typeof args.arguments === "object" ? args.arguments : {};
        const stringified = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
        const result = await client.getPrompt(String(args.name), stringified);

        return {
            ok: true,
            server: client.name,
            prompt: String(args.name),
            description: result && result.description,
            messages: renderPrompt(result)
        };
    }

    const prompts = await client.listPrompts();

    return {
        ok: true,
        server: client.name,
        total: prompts.length,
        prompts: prompts.map(item => ({
            name: item.name,
            description: item.description ? truncate(item.description, 300) : undefined,
            arguments: (item.arguments || []).map(argument => ({ name: argument.name, required: Boolean(argument.required), description: argument.description }))
        })),
        how_to_use: "mcp_prompts {server, name, arguments}"
    };
}


module.exports = {
    mcp_search_tools: mcpSearchTools,
    mcp_resources: mcpResources,
    mcp_prompts: mcpPrompts,
    renderPrompt
};
