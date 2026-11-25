"use strict";

/*
|--------------------------------------------------------------------------
| MCP tools and agent profiles
|--------------------------------------------------------------------------
|
| MCP tool discovery, tool and skill resolution, agent profiles and the
| system prompt and request body of one agent.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const toolRuntime = require("../tools");
const settings = require("../config");
const { createMcpRuntime } = require("../mcp/McpRuntime");
const { createAgentProfileResolver } = require("../runtime/AgentProfileResolver");


module.exports = function createProfiles(host) {

    const {
        AGENT_REGISTRY_OF,
        PERSONA_REGISTRY_OF,
        SKILL_REGISTRY_OF,
        TOOL_REGISTRY_OF,
        logLine
    } = host;

    /* set up by a later factory, so looked up when called */
    const promptFacade = (...args) => host.promptFacade(...args);
    const skillResolver = (...args) => host.skillResolver(...args);
    const toolResolver = (...args) => host.toolResolver(...args);

    /*
    |--------------------------------------------------------------------------
    | Tool Resolution
    |--------------------------------------------------------------------------
    */

    const mcpRuntime = createMcpRuntime({
        settings,
        tools: toolRuntime,
        logLine
    });

    const { mcpToolDeclarations, discoverMcpTools } = mcpRuntime;


    function mcpToolRegistry() {

        /* Moved to agent/prompt/ToolResolver.js (Phase 5). */
        return toolResolver().mcpRegistry();
    }




    function resolveTools(toolNames) {

        /* Moved to agent/prompt/ToolResolver.js (Phase 5); the wrapper keeps
           every call site and the live-registry behavior identical. */
        return toolResolver().resolve(toolNames);
    }


    /*
    |--------------------------------------------------------------------------
    | Skill Resolution
    |--------------------------------------------------------------------------
    */

    function resolveSkills(skillNames) {

        /* Moved to agent/prompt/SkillResolver.js (Phase 5). */
        return skillResolver().resolve(skillNames);
    }


    /*
    |--------------------------------------------------------------------------
    | Persona Resolution
    |--------------------------------------------------------------------------
    */

    const profileResolver = createAgentProfileResolver({
        personaRegistry: PERSONA_REGISTRY_OF,
        agentRegistry: AGENT_REGISTRY_OF,
        toolRegistry: TOOL_REGISTRY_OF,
        skillRegistry: SKILL_REGISTRY_OF,
        hasDiscoveredTool: name => toolRuntime.mcp._hasDiscoveredTool(name),
        discoveredToolNames: () => toolRuntime.mcp._discoveredToolNames(),
        resolveTools,
        resolveSkills
    });

    const {
        resolvePersona,
        resolveAgentProfile,
        buildAdHocProfile,
        resolveDelegationProfile,
        resolveAgentCapabilities
    } = profileResolver;


    /*
    |--------------------------------------------------------------------------
    | Agent System Prompt
    |--------------------------------------------------------------------------
    */

    function buildAgentSystemPrompt(
        agentDefinition
    ) {
        return promptFacade().subAgentSystemPrompt(agentDefinition);
    }


    /*
    |--------------------------------------------------------------------------
    | Agent Request Builder
    |--------------------------------------------------------------------------
    */

    function buildAgentRequest(options) {
        return promptFacade().request(options);
    }


    return {
        buildAgentRequest,
        buildAgentSystemPrompt,
        discoverMcpTools,
        mcpToolDeclarations,
        resolveAgentCapabilities,
        resolveAgentProfile,
        resolveDelegationProfile,
        resolveTools
    };
};
