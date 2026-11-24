/* Resolve registered and composed profiles without coupling them to the agent loop. */

function createAgentProfileResolver({
    personaRegistry,
    agentRegistry,
    toolRegistry,
    skillRegistry,
    hasDiscoveredTool,
    discoveredToolNames,
    resolveTools,
    resolveSkills
}) {

    function resolvePersona(personaName) {
        if (!personaName) {
            return null;
        }
        const persona = personaRegistry().get(personaName);
        if (!persona) {
            throw new Error(`Unknown persona: ${personaName}`);
        }
        return persona;
    }

    function resolveAgentProfile(agentName) {
        const agent = agentRegistry().get(agentName);
        if (!agent) {
            throw new Error(`Unknown agent profile: ${agentName}`);
        }
        return agent;
    }

    function buildAdHocProfile(delegation, parentAllowedTools) {
        const persona = resolvePersona(delegation.persona);
        if (!persona) {
            throw new Error(
                `An ad-hoc delegation requires either an agent profile or a persona. Personas: ${
                    [...personaRegistry().keys()].sort().join(", ")
                }.`
            );
        }

        const requestedTools = Array.isArray(delegation.tools) ? delegation.tools : [];
        for (const toolName of requestedTools) {
            if (!toolRegistry().has(toolName) && !hasDiscoveredTool(toolName)) {
                throw new Error(
                    `Tool is not available: ${toolName}. The tools that exist are: ${
                        [...toolRegistry().keys(), ...discoveredToolNames()].sort().join(", ")
                    }.`
                );
            }
            if (!parentAllowedTools.has(toolName)) {
                throw new Error(
                    `Ad-hoc agent cannot be granted "${toolName}" because the delegating agent does not have it. It may be given any of: ${
                        [...parentAllowedTools].sort().join(", ")
                    }.`
                );
            }
        }

        const requestedSkills = Array.isArray(delegation.skills) ? delegation.skills : [];
        for (const skillName of requestedSkills) {
            if (!skillRegistry().has(skillName)) {
                throw new Error(
                    `Unknown skill: ${skillName}. The skills that exist are: ${
                        [...skillRegistry().keys()].sort().join(", ")
                    }.`
                );
            }
        }

        return {
            name: `adhoc:${persona.name}`,
            description: `Ad-hoc agent composed from persona "${persona.name}".`,
            persona: persona.name,
            skills: requestedSkills,
            tools: requestedTools,
            output_contract: ["Report only results confirmed by runtime execution."],
            delegation: { enabled: false, max_depth: 0, max_children: 0 }
        };
    }

    function resolveDelegationProfile(delegation, parentAllowedTools) {
        if (delegation.agent) {
            return resolveAgentProfile(delegation.agent);
        }
        return buildAdHocProfile(delegation, parentAllowedTools);
    }

    function resolveAgentCapabilities(agentDefinition) {
        return {
            persona: resolvePersona(agentDefinition.persona),
            skills: resolveSkills(agentDefinition.skills),
            tools: resolveTools(agentDefinition.tools)
        };
    }

    return {
        resolvePersona,
        resolveAgentProfile,
        buildAdHocProfile,
        resolveDelegationProfile,
        resolveAgentCapabilities
    };
}


module.exports = { createAgentProfileResolver };
