/* Runtime-facing MCP tool discovery, kept independent of the agent loop. */

const budgeter = require("./McpToolBudget");


function createMcpRuntime({ settings, tools, logLine }) {

    /* every tool the agent may reach, before any budget (explicit grants) */
    function allMcpToolDeclarations(options = {}) {

        if (settings.get("MCP_EXPOSE_TOOLS") === "gateway") {
            return [];
        }

        try {
            return tools.mcpToolDeclarations(options).slice(0, settings.get("MCP_MAX_TOOLS"));
        } catch {
            return [];
        }
    }


    /*
    | P4-06: what one request declares and what it only lists. gateway mode
    | declares nothing and lists everything, like lazy loading.
    */
    function mcpToolSelection(options = {}) {

        if (settings.get("MCP_EXPOSE_TOOLS") === "gateway") {

            let all = [];

            try {
                all = tools.mcpToolDeclarations(options).slice(0, settings.get("MCP_MAX_TOOLS"));
            } catch {
                all = [];
            }

            return budgeter.select(all, { mode: "lazy", budget: settings.get("MCP_TOOL_DEFINITIONS_BUDGET") });
        }

        return budgeter.select(allMcpToolDeclarations(options), {
            mode: settings.get("MCP_TOOL_LOADING") || "auto",
            budget: settings.get("MCP_TOOL_DEFINITIONS_BUDGET") || 24000
        });
    }


    function mcpToolDeclarations(options = {}) {

        return mcpToolSelection(options).declared;
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

    return { mcpToolDeclarations, allMcpToolDeclarations, mcpToolSelection, discoverMcpTools };
}


module.exports = { createMcpRuntime };
