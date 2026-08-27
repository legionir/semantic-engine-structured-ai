/*
|--------------------------------------------------------------------------\
| Policy matcher
|--------------------------------------------------------------------------\
|
| The pure half of the decision: does this rule target this tool, and does
| its condition hold for these already-resolved arguments. No settings, no
| I/O, no mutation — which is what makes it testable without a runtime.
|
| Arguments arrive resolved on purpose: a rule about `path` must see the
| path the tool will actually write, not the string the model typed, or
| `./secrets/../../.git/config` would match nothing and pass.
|--------------------------------------------------------------------------*/


function matchesGlob(pattern, value) {

    const escaped =
        pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`, "i").test(value);
}


function valueAtPath(source, pathExpression) {

    return pathExpression
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

    /*
    | A rule without conditions matches every call to its target.
    */

    if (!condition) {
        return true;
    }

    if (
        condition.agents &&
        !condition.agents.some(
            pattern =>
                matchesGlob(pattern, context.agent)
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
                    pattern =>
                        new RegExp(pattern, "i").test(text)
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
            pattern =>
                matchesGlob(pattern, toolName)
        );
    }

    if (rule.groups) {

        return rule.groups.some(
            group =>
                groupsForTool.includes(group)
        );
    }

    return false;
}


/*
| Which MCP server a call reaches. Through the gateway the server is an
| argument (`mcp_call` with `{ server }`, or a tool named by string); as a
| namespaced tool it is encoded in the name itself.
*/

function mcpServerOf(toolName, args) {

    if (toolName === "mcp_call") {

        if (args && args.server) {
            return String(args.server);
        }

        const requested =
            args && (args.tool || args.name);

        if (typeof requested === "string") {

            try {

                const { parseToolName } = require("../mcp/manager");

                const parsed = parseToolName(requested);

                return parsed ? parsed.server : null;

            } catch {

                return null;
            }
        }

        return null;
    }

    try {

        const { parseToolName } = require("../mcp/manager");

        const parsed = parseToolName(toolName);

        return parsed ? parsed.server : null;

    } catch {

        return null;
    }
}


/*
| An MCP tool runs outside this runtime, so the workspace boundary and the
| argument guards that protect a built-in tool do not apply to it. What is
| left is the operator's own judgement, recorded per server as its trust
| setting, and MCP_APPROVAL as a blanket override. Neither can make a call
| more permissive than the rules already decided, so this is an escalation
| and never a downgrade.
*/

function mcpEscalation(toolName, { settings, DECISIONS }) {

    const isGatewayCall =
        toolName === "mcp_call";

    const isNamespaced =
        toolName.startsWith("mcp__");

    if (!isGatewayCall && !isNamespaced) {
        return null;
    }

    const mode =
        settings.get("MCP_APPROVAL");

    if (mode === "never") {
        return null;
    }

    if (mode === "always") {

        return {
            decision: DECISIONS.REQUIRE_APPROVAL,
            reason: "every MCP call needs approval (MCP_APPROVAL=always)",
            rule: "mcp_approval_always"
        };
    }

    if (!isNamespaced) {

        /*
        | Through the gateway the server is an argument, and it is
        | resolved where the call is made rather than guessed here.
        */

        return null;
    }

    let manager;

    try {

        ({ manager } = require("../mcp/manager"));

    } catch {

        return null;
    }

    const entry =
        manager.catalogueEntry(toolName);

    if (!entry || entry.trust !== "restricted") {
        return null;
    }

    return {
        decision: DECISIONS.REQUIRE_APPROVAL,
        reason: `the MCP server "${entry.server}" is configured as restricted`,
        rule: "mcp_restricted_server"
    };
}


module.exports = {
    matchesGlob,
    valueAtPath,
    conditionMatches,
    ruleTargets,
    mcpServerOf,
    mcpEscalation
};
