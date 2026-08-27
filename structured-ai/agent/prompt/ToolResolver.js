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
    mcpToolDeclarations
}) {

    function mcpRegistry() {

        return new Map(
            mcpToolDeclarations().map(
                tool => [tool.function.name, tool]
            )
        );

    }


    function resolve(toolNames) {

        /*
        | "*" grants every registered tool. Used by the root orchestrator
        | profile; sub-agent profiles should list tools explicitly.
        */

        if (toolNames === "*") {

            return [
                ...TOOL_REGISTRY_OF().values(),
                ...mcpToolDeclarations()
            ];

        }

        if (!Array.isArray(toolNames)) {
            return [];
        }

        const fromMcp =
            mcpRegistry();

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
