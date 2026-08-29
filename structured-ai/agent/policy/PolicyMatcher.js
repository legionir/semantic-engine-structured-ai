"use strict";

const DECISIONS = Object.freeze({
    ALLOW: "allow",
    DENY: "deny",
    REQUIRE_APPROVAL: "require_approval"
});


/*
| Match a policy tool glob without giving regular-expression syntax to the
| policy author. The old policy language supports only `*` and `?`.
*/
function matchesGlob(pattern, value) {

    const escaped =
        String(pattern)
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`, "i").test(String(value));
}


function valueAtPath(source, pathExpression) {

    return String(pathExpression)
        .split(".")
        .reduce(
            (current, segment) =>
                current === null || current === undefined
                    ? current
                    : current[segment],
            source
        );
}


function conditionMatches(condition, context) {

    if (!condition) {
        return true;
    }

    if (
        condition.agents &&
        !condition.agents.some(
            pattern => matchesGlob(pattern, context.agent)
        )
    ) {
        return false;
    }

    if (condition.argument_matches) {

        for (
            const [argumentPath, patterns]
            of Object.entries(condition.argument_matches)
        ) {

            const value =
                valueAtPath(context.args, argumentPath);

            const text =
                value === undefined || value === null
                    ? ""
                    : String(value);

            const matched =
                patterns.some(
                    pattern => new RegExp(pattern, "i").test(text)
                );

            if (!matched) {
                return false;
            }
        }
    }

    if (condition.argument_absent) {

        for (const argumentPath of condition.argument_absent) {

            const value =
                valueAtPath(context.args, argumentPath);

            if (
                value !== undefined &&
                value !== null &&
                value !== false
            ) {
                return false;
            }
        }
    }

    return true;
}


function ruleTargets(rule, toolName, groupsForTool) {

    if (rule.tools) {

        return rule.tools.some(
            pattern => matchesGlob(pattern, toolName)
        );
    }

    if (rule.groups) {

        return rule.groups.some(
            group => groupsForTool.includes(group)
        );
    }

    return false;
}


class PolicyMatcher {

    constructor({ mcpEscalation } = {}) {

        this.mcpEscalation =
            typeof mcpEscalation === "function"
                ? mcpEscalation
                : () => null;
    }


    match({ toolName, args, agent, registry }) {

        const context = {
            args: args || {},
            agent: agent || "main_agent"
        };

        const groups =
            registry.groupsFor(toolName);

        let decision = {
            decision:
                registry.defaultAction() || DECISIONS.ALLOW,
            reason: "default policy",
            rule: null
        };

        for (const rule of registry.rules()) {

            if (!ruleTargets(rule, toolName, groups)) {
                continue;
            }

            if (!conditionMatches(rule.when, context)) {
                continue;
            }

            decision = {
                decision: rule.action,
                reason:
                    rule.reason ||
                    `rule "${rule.id || rule.action}"`,
                rule: rule.id || null
            };
        }

        /* A deny is terminal; trust settings can only make an allow stricter. */
        if (decision.decision !== DECISIONS.DENY) {

            const escalation =
                this.mcpEscalation(toolName, {
                    args: context.args,
                    agent: context.agent,
                    decision
                });

            if (escalation) {
                decision = escalation;
            }
        }

        return {
            tool: toolName,
            agent: context.agent,
            groups,
            ...decision
        };
    }


    evaluate(toolName, args, agent, registry) {

        return this.match({
            toolName,
            args,
            agent,
            registry
        });
    }
}


module.exports = {
    DECISIONS,
    PolicyMatcher,
    matchesGlob,
    valueAtPath,
    conditionMatches,
    ruleTargets
};
