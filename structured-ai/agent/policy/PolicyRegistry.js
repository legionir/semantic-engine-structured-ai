"use strict";

const { DECISIONS } = require("./PolicyMatcher");


const VALID_ACTIONS = Object.freeze([
    DECISIONS.ALLOW,
    DECISIONS.DENY,
    DECISIONS.REQUIRE_APPROVAL
]);


function toolNamesOf(tools) {

    if (tools instanceof Map) {
        return new Set(tools.keys());
    }

    return new Set(
        (tools || [])
            .filter(item => item?.type === "function")
            .map(item => item.function.name)
    );
}


/*
| Policy-specific validation belongs beside the policy registry. The generic
| registry validator can include these messages without knowing policy
| matching details, while the historical "Registry validation failed"
| envelope remains unchanged.
*/
function policyProblems({ policy, toolGroups, tools } = {}) {

    const problems = [];
    const knownTools = toolNamesOf(tools);
    const groups = toolGroups || {};

    for (const rule of policy?.rules || []) {

        for (const name of rule.tools || []) {

            if (!String(name).includes("*") && !knownTools.has(name)) {

                problems.push(
                    `Policy rule "${rule.id}" references unknown tool "${name}".`
                );
            }
        }

        for (const group of rule.groups || []) {

            if (!groups[group]) {

                problems.push(
                    `Policy rule "${rule.id}" references unknown tool group "${group}".`
                );
            }
        }

        if (!VALID_ACTIONS.includes(rule.action)) {

            problems.push(
                `Policy rule "${rule.id}" has an unknown action "${rule.action}".`
            );
        }
    }

    return problems;
}


class PolicyRegistry {

    constructor({ policy, toolGroups } = {}) {
        this.reload({ policy, toolGroups });
    }


    reload({ policy, toolGroups } = {}) {

        this.policy =
            policy === undefined
                ? (this.policy || {
                    default_action: DECISIONS.ALLOW,
                    rules: []
                })
                : (policy || {
                    default_action: DECISIONS.ALLOW,
                    rules: []
                });

        this.toolGroups =
            toolGroups === undefined
                ? (this.toolGroups || {})
                : (toolGroups || {});

        this.groupsByTool = new Map();

        for (
            const [group, definition]
            of Object.entries(this.toolGroups)
        ) {

            for (const tool of definition?.tools || []) {

                this.groupsByTool.set(
                    tool,
                    [
                        ...(this.groupsByTool.get(tool) || []),
                        group
                    ]
                );
            }
        }

        return this;
    }


    groupsFor(toolName) {
        return this.groupsByTool.get(toolName) || [];
    }


    rules() {
        return this.policy.rules || [];
    }


    defaultAction() {
        return this.policy.default_action || DECISIONS.ALLOW;
    }


    snapshot() {

        return {
            default_action: this.defaultAction(),
            rules: this.rules().length
        };
    }


    problems(tools) {

        return policyProblems({
            policy: this.policy,
            toolGroups: this.toolGroups,
            tools
        });
    }


    validate(tools) {

        const problems = this.problems(tools);

        if (problems.length > 0) {

            throw new Error(
                `Registry validation failed:\n- ${problems.join("\n- ")}`
            );
        }

        return true;
    }
}


module.exports = {
    PolicyRegistry,
    VALID_ACTIONS,
    policyProblems,
    toolNamesOf
};
