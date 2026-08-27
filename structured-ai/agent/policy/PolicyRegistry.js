/*
|--------------------------------------------------------------------------\
| Policy registry
|--------------------------------------------------------------------------\
|
| Owns the declarative half of the decision: the rule document from
| `registry/policy.json` and the tool→group map from
| `registry/tool_groups.json`. The rules come from files, so the engine has
| to be able to take a new version of them without the process restarting —
| that is what `reload` is for, and why the document is never read at
| import time by anyone else.
|
| Semantics kept exactly as they were:
|   • the LAST matching rule wins, so a specific rule may follow a broad one;
|   • `default_action` answers when nothing matched;
|   • an MCP escalation may tighten a non-denial, never a denial.
|--------------------------------------------------------------------------*/

const {
    conditionMatches,
    ruleTargets,
    mcpEscalation
} = require("./PolicyMatcher");

const { DECISIONS } = require("./PolicyErrors");

const settings = require("../lib/storage");


const EMPTY_POLICY = Object.freeze({
    default_action: DECISIONS.ALLOW,
    rules: []
});


class PolicyRegistry {

    constructor({ policy, toolGroups } = {}) {

        this.groupsByTool =
            new Map();

        this.reload({ policy, toolGroups });
    }


    /*
    | A malformed or missing document degrades to "allow everything", which
    | is the historical default_action with no rules — not an exception at
    | startup. Silent, but see `isEmpty`: the console shows it as such.
    */

    reload({ policy, toolGroups } = {}) {

        this.policy =
            policy && typeof policy === "object"
                ? policy
                : EMPTY_POLICY;

        this.groupsByTool =
            new Map();

        for (
            const [group, definition]
            of Object.entries(toolGroups || {})
        ) {

            for (const tool of definition.tools || []) {

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


    get document() {

        return this.policy;
    }

    get ruleCount() {

        return (this.policy.rules || []).length;
    }

    get isEmpty() {

        return this.ruleCount === 0;
    }


    groupsFor(toolName) {

        return this.groupsByTool.get(toolName) || [];
    }


    /*
    | Which rule, if any, governs this call — after the argument resolution
    | that happened upstream, on the arguments the tool will receive.
    */

    decide(toolName, context) {

        const groups =
            this.groupsFor(toolName);

        let decision = {
            decision:
                this.policy.default_action ||
                DECISIONS.ALLOW,

            reason:
                "default policy",

            rule:
                null
        };

        for (const rule of this.policy.rules || []) {

            if (!ruleTargets(rule, toolName, groups)) {
                continue;
            }

            if (!conditionMatches(rule.when, context)) {
                continue;
            }

            decision = {
                decision:
                    rule.action,

                reason:
                    rule.reason ||
                    `rule "${rule.id || rule.action}"`,

                rule:
                    rule.id || null
            };
        }

        /*
        | A denial stands; anything softer may still be escalated by the
        | server's own trust setting.
        */

        if (decision.decision !== DECISIONS.DENY) {

            const escalation =
                mcpEscalation(toolName, { settings, DECISIONS });

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
}


module.exports = { PolicyRegistry, DECISIONS };
