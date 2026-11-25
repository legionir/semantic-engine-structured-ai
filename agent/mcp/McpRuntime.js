/* Runtime-facing MCP tool discovery, kept independent of the agent loop. */

function createMcpRuntime({ settings, tools, logLine }) {

    function mcpToolDeclarations() {
        if (settings.get("MCP_EXPOSE_TOOLS") === "gateway") {
            return [];
        }

        try {
            return tools.mcpToolDeclarations().slice(0, settings.get("MCP_MAX_TOOLS"));
        } catch {
            return [];
        }
    }

    async function discoverMcpTools() {
        if (settings.get("MCP_ENABLED") === false ||
            settings.get("MCP_AUTO_DISCOVER") === false) {
            return [];
        }

        try {
            const discovered = await tools.discoverMcpTools();
            if (discovered.length > 0) {
                logLine(
                    "main_agent",
                    `${discovered.length} MCP tool(s) available from ${
                        new Set(discovered.map(entry => entry.server)).size
                    } server(s).`
                );
            }
            return discovered;
        } catch (error) {
            logLine("main_agent", `MCP discovery failed: ${error.message}`);
            return [];
        }
    }

    return { mcpToolDeclarations, discoverMcpTools };
}


module.exports = { createMcpRuntime };
