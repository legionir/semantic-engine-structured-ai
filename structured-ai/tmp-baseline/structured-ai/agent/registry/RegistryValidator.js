"use strict";

const { policyProblems } = require("../policy/PolicyRegistry");

/*
|--------------------------------------------------------------------------
| Registry Validator — EXECUTION_PLAN Phase 14 / 21
|--------------------------------------------------------------------------
|
| Cross-checks the loaded registries against each other and against the
| implemented tool names. Policy-specific matching references are owned by
| PolicyRegistry; this module keeps the historical aggregate error surface.
|--------------------------------------------------------------------------
*/

function validate({
    tools,
    groups,
    skills,
    agents,
    personas,
    policy,
    hasTool,
    implementedToolNames
}) {

    const problems = [];

    const toolRegistry = new Map(
        (tools || [])
            .filter(item => item?.type === "function")
            .map(item => [item.function.name, item])
    );

    const personaRegistry = new Map(
        (personas || []).map(persona => [persona.name, persona])
    );

    const skillRegistry = new Map(
        (skills || []).map(skill => [skill.name, skill])
    );

    for (const tool of tools || []) {

        if (tool?.type !== "function") {

            problems.push(
                "tools.json contains an entry that is not a function tool."
            );

            continue;

        }

        if (!hasTool(tool.function.name)) {

            problems.push(
                `Tool "${tool.function.name}" is declared in tools.json but has no implementation.`
            );

        }

    }

    for (const name of implementedToolNames()) {

        if (!toolRegistry.has(name)) {

            problems.push(
                `Tool "${name}" is implemented but not declared in tools.json.`
            );

        }

    }

    for (const [group, definition] of Object.entries(groups || {})) {

        for (const name of definition.tools || []) {

            if (!toolRegistry.has(name)) {

                problems.push(
                    `Tool group "${group}" references unknown tool "${name}".`
                );

            }

        }

    }

    problems.push(
        ...policyProblems({
            policy,
            toolGroups: groups,
            tools: toolRegistry
        })
    );

    for (const skill of skills || []) {

        for (const name of skill.tools || []) {

            if (!toolRegistry.has(name)) {

                problems.push(
                    `Skill "${skill.name}" references unknown tool "${name}".`
                );

            }

        }

    }

    for (const agent of agents || []) {

        if (agent.persona && !personaRegistry.has(agent.persona)) {

            problems.push(
                `Agent "${agent.name}" references unknown persona "${agent.persona}".`
            );

        }

        for (const name of agent.skills || []) {

            if (!skillRegistry.has(name)) {

                problems.push(
                    `Agent "${agent.name}" references unknown skill "${name}".`
                );

            }

        }

        if (agent.tools !== "*") {

            for (const name of agent.tools || []) {

                if (!toolRegistry.has(name)) {

                    problems.push(
                        `Agent "${agent.name}" references unknown tool "${name}".`
                    );

                }

            }

        }

    }

    if (problems.length > 0) {

        throw new Error(
            `Registry validation failed:\n- ${problems.join("\n- ")}`
        );

    }

    return true;

}


module.exports = {
    validate
};
