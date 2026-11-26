"use strict";

/*
|--------------------------------------------------------------------------
| mcp_build (roadmap P4-09)
|--------------------------------------------------------------------------
|
| The agent writes a small MCP server into the workspace and uses it in
| the same conversation:
|
|   {action: "create", name, language, tools: [{name, description,
|    input_schema, body}]}    a server from the node or python template
|   {action: "create", name, openapi: "<path or JSON>", base_url}
|                             a node server with one tool per operation
|   {action: "reload", name}  restart it after its tools file was edited
|
| The server is registered with the manager straight away (hot loaded);
| its tools are reachable at once through mcp_call — the request's own
| declarations were fixed when the run started — and declared directly
| from the next run on. persist: true keeps it for later runs in the
| operator's user file, scoped to this project.
|
| Writing and starting a program is a new capability, so the tool is in
| the mcp.manage group, which needs approval by default.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const ToolContext = require("../ToolContext");
const builder = require("../../mcp/McpServerBuilder");
const { manager, toolName } = require("../../mcp/McpManager");


function readOpenApi(source, ctx) {

    const text = String(source).trim();

    if (text.startsWith("{")) {
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(`openapi is not valid JSON: ${error.message}`);
        }
    }

    const file = ctx.resolvePath(text);
    ctx.assertSafe(file);

    if (!fs.existsSync(file)) {
        throw new Error(`openapi: no file at ${text}`);
    }

    const raw = fs.readFileSync(file, "utf8");

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`openapi: ${text} is not JSON (${error.message}); YAML documents need converting to JSON first`);
    }
}


async function register({ name, written, description, persist, projectId }) {

    const definition = builder.definitionFor({ ...written, name, description });

    if (persist && projectId) {
        definition.scope = "project";
        definition.projects = [projectId];
    }

    const added =
        await manager.add(name, definition, {
            persist: Boolean(persist),
            target: "user",
            secrets: false
        });

    const tools =
        manager.catalogueEntries().filter(entry => entry.server === name).map(entry => entry.name);

    return { added, tools };
}


async function mcpBuild(args = {}, context) {

    if (!manager.enabled()) {
        return { ok: false, error: "MCP is disabled (MCP_ENABLED=false)." };
    }

    const ctx = ToolContext.from(context);
    const root = ctx.root;
    const name = String(args.name || "").trim();
    const action = args.action || "create";

    if (!root) {
        throw new Error("mcp_build needs a workspace");
    }

    if (action === "reload") {

        const found = builder.existing(root, name);

        if (!found) {
            throw new Error(`there is no server called "${name}" in ${path.join(".agent", "mcp-servers")}; create it first`);
        }

        const { tools } = await register({ name, written: found, description: args.description, persist: args.persist, projectId: ctx.projectId });

        return {
            ok: true,
            action,
            server: name,
            tools,
            how_to_call: tools.length ? `mcp_call {tool: "${tools[0]}", arguments: {…}}` : undefined
        };
    }

    if (action !== "create") {
        throw new Error("action must be create or reload");
    }

    const openapi =
        args.openapi
            ? builder.fromOpenApi(readOpenApi(args.openapi, ctx), { baseUrl: args.base_url || null })
            : null;

    const written =
        builder.scaffold({
            workspaceRoot: root,
            name,
            language: openapi ? "node" : (args.language || "node"),
            tools: args.tools,
            openapi,
            overwrite: args.overwrite === true
        });

    if (args.register === false) {
        return {
            ok: true,
            action,
            server: name,
            registered: false,
            files: [written.serverFile, written.toolsFile].map(file => path.relative(root, file)),
            tools: written.tools.map(tool => toolName(name, tool))
        };
    }

    let registered;

    try {
        registered = await register({ name, written, description: args.description, persist: args.persist, projectId: ctx.projectId });
    } catch (error) {
        return {
            ok: false,
            action,
            server: name,
            files: [written.serverFile, written.toolsFile].map(file => path.relative(root, file)),
            error: `${error.message}. Fix ${path.relative(root, written.toolsFile)} and call mcp_build {action: "reload", name: "${name}"}.`
        };
    }

    return {
        ok: true,
        action,
        server: name,
        language: written.language,
        registered: true,
        persisted_to: registered.added.persisted_to || null,
        files: [written.serverFile, written.toolsFile].map(file => path.relative(root, file)),
        tools: registered.tools,
        how_to_call: registered.tools.length
            ? `mcp_call {tool: "${registered.tools[0]}", arguments: {…}} — usable now, in this conversation`
            : undefined
    };
}


module.exports = { mcp_build: mcpBuild };
