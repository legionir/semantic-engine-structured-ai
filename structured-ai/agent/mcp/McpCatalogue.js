"use strict";

/*
|--------------------------------------------------------------------------
| MCP tool catalogue — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| Tool names are namespaced as mcp__<server>__<tool>, so two servers can
| both offer "search" without one shadowing the other.
|--------------------------------------------------------------------------
*/

const NAMESPACE_PREFIX = "mcp__";

const NAMESPACE_SEPARATOR = "__";


function toolName(serverName, tool) {

    return `${NAMESPACE_PREFIX}${serverName}${NAMESPACE_SEPARATOR}${tool}`;
}


function parseToolName(name) {

    if (
        typeof name !== "string" ||
        !name.startsWith(NAMESPACE_PREFIX)
    ) {
        return null;
    }

    const rest =
        name.slice(NAMESPACE_PREFIX.length);

    const separator =
        rest.indexOf(NAMESPACE_SEPARATOR);

    if (separator <= 0) {
        return null;
    }

    return {
        server:
            rest.slice(0, separator),

        tool:
            rest.slice(separator + NAMESPACE_SEPARATOR.length)
    };
}


function matchesFilter(name, include, exclude) {

    if (exclude && exclude.includes(name)) {
        return false;
    }

    if (include && include.length > 0) {
        return include.includes(name);
    }

    return true;
}


/*
| The JSON schema a server publishes is not always one the endpoint
| will accept, so it is reduced to the subset every OpenAI
| compatible endpoint understands, and an absent one becomes an open
| object rather than a missing field.
*/

function toolDeclaration(entry) {

    const schema =
        entry.input_schema && typeof entry.input_schema === "object"
            ? entry.input_schema
            : null;

    const parameters =
        schema && schema.type === "object"
            ? {
                type: "object",
                properties: schema.properties || {},
                required:
                    Array.isArray(schema.required) ? schema.required : []
            }
            : {
                type: "object",
                properties: {},
                required: []
            };

    const description =
        `[MCP ${entry.server}] ${
            entry.description || `Call "${entry.tool}" on the ${entry.server} MCP server.`
        }`;

    return {
        type: "function",
        function: {
            name: entry.name,
            description: description.slice(0, 1024),
            parameters
        }
    };
}


function entryFromTool(client, tool) {

    const namespaced =
        toolName(client.name, tool.name);

    return {
        name: namespaced,
        server: client.name,
        tool: tool.name,
        description: tool.description || "",
        input_schema:
            tool.inputSchema || tool.input_schema || null,
        annotations: tool.annotations || null,
        trust: client.config.trust,
        builtin: Boolean(client.config.builtin)
    };
}


module.exports = {
    NAMESPACE_PREFIX,
    NAMESPACE_SEPARATOR,
    toolName,
    parseToolName,
    matchesFilter,
    toolDeclaration,
    entryFromTool
};
