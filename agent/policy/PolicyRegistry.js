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

        /*
        | SA-POL-001/SA-POL-005: `argument_matches` patterns are compiled
        | with `new RegExp` at evaluation time. A malformed pattern like
        | "[" used to pass validation and then throw SyntaxError inside a
        | running tool decision — a policy authoring typo became a runtime
        | crash far from its cause. Validate them where they are written.
        */
        const when = rule.when || rule.condition;
        for (
            const [argumentPath, patterns]
            of Object.entries(when?.argument_matches || {})
        ) {

            if (!Array.isArray(patterns)) {

                problems.push(
                    `Policy rule "${rule.id}" argument_matches."${argumentPath}" must be an array of regex sources.`
                );
                continue;
            }

            for (const pattern of patterns) {

                try {

                    new RegExp(String(pattern), "i");

                } catch (error) {

                    problems.push(
                        `Policy rule "${rule.id}" argument_matches."${argumentPath}" has an invalid regex (${error.message}).`
                    );
                }
            }
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
