/*
| Role-based endpoint configuration shared by the agent and prompt layer.
| Keep provider-independent model selection here; transport-specific
| request construction belongs to the provider adapters.
*/

const ROLES = ["MAIN", "L1", "L2", "L3", "SUMMARY"];


function createEndpointProfiles({ settings, schemaAllowed, defaultBaseUrl, getRunEffort = () => null }) {

    function currentBaseUrl() {
        return settings.get("AGENT_BASE_URL") || defaultBaseUrl;
    }

    function currentEndpoint() {
        return `${currentBaseUrl()}/chat/completions`;
    }

    function currentApiKey() {
        return settings.get("AGENT_API_KEY");
    }

    function roleForDepth(depth) {
        if (!depth || depth < 1) {
            return "MAIN";
        }
        return depth >= 3 ? "L3" : `L${depth}`;
    }

    function activeTemperature(agentDefinition) {
        if (settings.sourceOf("AGENT_TEMPERATURE") === "override") {
            return settings.get("AGENT_TEMPERATURE");
        }
        return agentDefinition && agentDefinition.temperature !== undefined &&
            agentDefinition.temperature !== null
            ? agentDefinition.temperature
            : settings.get("AGENT_TEMPERATURE");
    }

    function activeModel(agentDefinition) {
        if (settings.sourceOf("AGENT_MODEL") === "override") {
            return settings.get("AGENT_MODEL");
        }
        return (agentDefinition && agentDefinition.model) ||
            settings.get("AGENT_MODEL");
    }

    function endpointFor(role, agentDefinition) {
        const name = ROLES.includes(role) ? role : "MAIN";
        const baseUrl = settings.get(`ENDPOINT_${name}_BASE_URL`) || currentBaseUrl();
        const apiKey = settings.get(`ENDPOINT_${name}_API_KEY`) || currentApiKey();
        const roleModel = settings.get(`ENDPOINT_${name}_MODEL`);
        const roleTemperature = settings.get(`ENDPOINT_${name}_TEMPERATURE`);
        const runEffort = getRunEffort();
        const roleEffort = settings.get(`ENDPOINT_${name}_REASONING_EFFORT`);
        const agentEffort = agentDefinition?.reasoning_effort || settings.get("AGENT_REASONING_EFFORT");
        const reasoningEffort = ["low", "medium", "high", "xhigh"].includes(runEffort)
            ? runEffort
            : ["low", "medium", "high", "xhigh"].includes(roleEffort)
                ? roleEffort
                : ["low", "medium", "high", "xhigh"].includes(agentEffort)
                    ? agentEffort
                    : undefined;

        return {
            role: name,
            base_url: baseUrl,
            endpoint: `${baseUrl}/chat/completions`,
            api_key: apiKey,
            model: roleModel || activeModel(agentDefinition),
            temperature: roleTemperature >= 0
                ? roleTemperature
                : activeTemperature(agentDefinition),
            reasoning_effort: reasoningEffort
        };
    }

    function endpointOverview() {
        return ROLES.map(role => {
            const resolved = endpointFor(role, null);
            return {
                role,
                model: resolved.model,
                temperature: resolved.temperature,
                reasoning_effort: resolved.reasoning_effort,
                base_url: resolved.base_url,
                inherits: settings.get(`ENDPOINT_${role}_BASE_URL`) === "",
                sends_schema: schemaAllowed(resolved, role)
            };
        });
    }

    function setModelOverride(model) {
        if (!model) {
            if (settings.sourceOf("AGENT_MODEL") === "override") {
                settings.reset("AGENT_MODEL");
            }
            return settings.get("AGENT_MODEL");
        }
        return settings.set("AGENT_MODEL", model);
    }

    return {
        currentBaseUrl,
        currentEndpoint,
        currentApiKey,
        roleForDepth,
        endpointFor,
        endpointOverview,
        setModelOverride,
        activeTemperature,
        activeModel
    };
}


module.exports = { createEndpointProfiles, ROLES };
