/*
|--------------------------------------------------------------------------
| Tool Resolver
|--------------------------------------------------------------------------
|
| Which tool declarations a profile may see, moved out of agent.js
| (EXECUTION_PLAN Phase 5). The registry accessors are injected, so the
| resolution tracks the live registry exactly like the function it
| replaces, and this module knows nothing about the engine's globals.
|
| The body is the historical resolveTools() verbatim, including the
| "*" grant and the MCP catalogue fallback.
|--------------------------------------------------------------------------
*/

function createToolResolver({
    TOOL_REGISTRY_OF,
    mcpToolDeclarations,
    allMcpToolDeclarations = mcpToolDeclarations
}) {

    /*
    | Explicitly named MCP tools resolve against the whole catalogue (the
    | profile asked for them by name); "*" gets the budgeted declarations
    | (roadmap P4-06). Either way, a server limited to some agents is
    | left out for every other agent (P4-07).
    */

    function mcpRegistry(agentName) {

        return new Map(
            allMcpToolDeclarations(agentName ? { agent: agentName } : {}).map(
                tool => [tool.function.name, tool]
            )
        );

    }


    function resolve(toolNames, agentName) {

        /*
        | "*" grants every registered tool. Used by the root orchestrator
        | profile; sub-agent profiles should list tools explicitly.
        */

        if (toolNames === "*") {

            return [
                ...TOOL_REGISTRY_OF().values(),
                ...mcpToolDeclarations(agentName ? { agent: agentName } : {})
            ];

        }

        if (!Array.isArray(toolNames)) {
            return [];
        }

        const fromMcp =
            mcpRegistry(agentName);

        return toolNames
            .map(
                name =>
                    TOOL_REGISTRY_OF().get(name) ||
                    fromMcp.get(name)
            )
            .filter(Boolean);
    }


    return {
        resolve,
        mcpRegistry
    };

}


module.exports = {
    createToolResolver
};
