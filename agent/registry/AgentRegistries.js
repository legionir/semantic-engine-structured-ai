/* Live registry loading and the named views consumed throughout the runtime. */

function createAgentRegistries({
    fs,
    path,
    settings,
    registryLoader,
    AgentRegistry,
    ToolRegistry,
    SkillRegistry,
    events,
    policyEngineHolder,
    registryDir,
    schemaDir,
    runtimeDir
}) {
    const state = { loaded_at: 0, signature: null, data: {} };

    function schemaFileName() {
        return settings.get("AGENT_SCHEMA") === "strict"
            ? "response_format.strict.json"
            : "response_format.json";
    }

    const baseFiles = {
        PERSONAS: path.join(registryDir, "personas.json"),
        SKILLS: path.join(registryDir, "skills.json"),
        TOOLS: path.join(registryDir, "tools.json"),
        TOOL_GROUPS: path.join(registryDir, "tool_groups.json"),
        POLICY: path.join(registryDir, "policy.json"),
        AGENTS: path.join(registryDir, "agents.json"),
        CONFIGURED_RUNTIME: path.join(runtimeDir, "runtime_context.json")
    };

    function registryFiles() {
        return {
            ...baseFiles,
            RESPONSE_FORMAT: path.join(schemaDir, schemaFileName())
        };
    }

    function registrySignature() {
        return registryLoader.signatureOf(schemaFileName());
    }

    function loadRegistries(force) {
        const signature = registrySignature();
        if (!force && state.signature === signature) {
            return state.data;
        }

        const data = registryLoader.load(schemaFileName());
        data.PERSONA_REGISTRY = new Map(data.PERSONAS.map(persona => [persona.name, persona]));
        data.SKILL_REGISTRY = SkillRegistry.fromList(data.SKILLS);
        data.TOOL_REGISTRY = ToolRegistry.fromList(data.TOOLS);
        data.AGENT_REGISTRY = AgentRegistry.fromList(data.AGENTS);

        state.data = data;
        state.signature = signature;
        state.loaded_at = Date.now();

        if (policyEngineHolder.engine) {
            policyEngineHolder.engine.reload({
                policy: data.POLICY,
                toolGroups: data.TOOL_GROUPS
            });
        }

        events.emit("registry:loaded", {
            at: state.loaded_at,
            forced: Boolean(force)
        });
        return data;
    }

    const registry = () => loadRegistries(false);
    return {
        schemaFileName,
        registryFiles,
        registrySignature,
        loadRegistries,
        registry,
        PERSONAS_OF: () => registry().PERSONAS,
        SKILLS_OF: () => registry().SKILLS,
        TOOLS_OF: () => registry().TOOLS,
        TOOL_GROUPS_OF: () => registry().TOOL_GROUPS,
        POLICY_OF: () => registry().POLICY,
        AGENTS_OF: () => registry().AGENTS,
        RESPONSE_FORMAT_OF: () => registry().RESPONSE_FORMAT,
        CONFIGURED_RUNTIME_OF: () => registry().CONFIGURED_RUNTIME,
        PERSONA_REGISTRY_OF: () => registry().PERSONA_REGISTRY,
        SKILL_REGISTRY_OF: () => registry().SKILL_REGISTRY,
        TOOL_REGISTRY_OF: () => registry().TOOL_REGISTRY,
        AGENT_REGISTRY_OF: () => registry().AGENT_REGISTRY
    };
}


module.exports = { createAgentRegistries };
