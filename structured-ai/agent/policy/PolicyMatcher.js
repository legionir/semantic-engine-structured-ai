"use strict";

const CommandRisk = require("./CommandRisk");

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


/*
| Path arguments are matched in their forward-slash form as well, so a
| Windows path such as src\.git\hooks\pre-commit meets the same rules as
| src/.git/hooks/pre-commit (P0-3); the patterns are already case
| insensitive. A rule about "path" also judges both ends of a tool that
| has no path argument but a source and a destination (fs_move): moving a
| file out of or into a protected place writes there. A rule that makes
| the answer stricter applies when either end matches; an allow only
| when both do.
*/

function isPathArgument(argumentPath) {

    const last =
        String(argumentPath)
            .split(".")
            .pop();

    return /^(path|paths|source|destination|target|file|files|cwd|from|to|dir|directory)$|_path$/i.test(last);
}


function argumentValues(args, argumentPath) {

    const value =
        valueAtPath(args, argumentPath);

    if (
        String(argumentPath) === "path" &&
        (value === undefined || value === null) &&
        args &&
        (args.source !== undefined || args.destination !== undefined)
    ) {

        return [args.source, args.destination]
            .filter(item => item !== undefined && item !== null);
    }

    return [value];
}


function textForms(value, pathLike) {

    const text =
        value === undefined || value === null
            ? ""
            : String(value);

    return pathLike && text.includes("\\")
        ? [text, text.replace(/\\/g, "/")]
        : [text];
}


function conditionMatches(condition, context, action) {

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

            const pathLike =
                isPathArgument(argumentPath);

            const valueMatches = value =>
                textForms(value, pathLike).some(
                    text =>
                        patterns.some(
                            pattern => new RegExp(pattern, "i").test(text)
                        )
                );

            const values =
                argumentValues(context.args, argumentPath);

            const matched =
                action === DECISIONS.ALLOW
                    ? values.every(valueMatches)
                    : values.some(valueMatches);

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


/*
| P0-2: tools whose argument is fed to a shell line by line, and the tool
| whose command rules each line is checked against.
*/
const commandInputTools = Object.freeze({
    process_write: Object.freeze({
        argument: "input",
        evaluateAs: "process_start",
        as: "command"
    })
});


/*
| P1-4: the argument of each shell tool that holds the command line, and
| the shell a tool may name. The command is parsed (CommandRisk) and its
| risk is attached to the evaluation.
*/
const commandRiskTools = Object.freeze({
    terminal_exec: "command",
    process_start: "command",
    process_write: "input"
});


function dialectOfShell(shell) {

    const name = CommandRisk.commandName(shell);

    if (name === "powershell" || name === "pwsh") {
        return "powershell";
    }

    if (name === "cmd") {
        return "cmd";
    }

    return /^(sh|bash|zsh|dash|ksh|fish|ash)$/.test(name)
        ? "posix"
        : undefined;
}


function commandRisk(toolName, args) {

    const argument = commandRiskTools[toolName];

    if (!argument) {
        return null;
    }

    const text = valueAtPath(args, argument);

    if (typeof text !== "string" || text.trim() === "") {
        return null;
    }

    try {

        return CommandRisk.classify(text, {
            dialect: args && typeof args.shell === "string"
                ? dialectOfShell(args.shell)
                : undefined
        });

    } catch {

        /* a parser failure must never make a command look safe */
        return { risk: CommandRisk.RISK.HIGH, reason: "the command could not be parsed" };
    }
}


class PolicyMatcher {

    constructor({ mcpEscalation } = {}) {

        this.mcpEscalation =
            typeof mcpEscalation === "function"
                ? mcpEscalation
                : () => null;
    }


    /* The last matching rule wins; no rule leaves the registry default. */
    rulesDecision(toolName, context, registry) {

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

            if (!conditionMatches(rule.when, context, rule.action)) {
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

        return decision;
    }


    /*
    | P0-2: input written to a running shell is a command. Each line goes
    | through the rules of the tool that would run it as one: a line those
    | rules deny denies the whole write, and a line that needs approval
    | makes an allowed write need it too. Returns null when nothing is
    | stricter than the decision already reached.
    */
    commandInputDecision(toolName, context, registry, current) {

        const spec = commandInputTools[toolName];

        if (!spec) {
            return null;
        }

        const input =
            valueAtPath(context.args, spec.argument);

        if (typeof input !== "string" || input.length === 0) {
            return null;
        }

        const lines = input.split(/\r\n|\r|\n/);
        let stricter = null;

        for (let index = 0; index < lines.length; index += 1) {

            const line = lines[index].trim();

            if (!line) {
                continue;
            }

            const verdict =
                this.rulesDecision(
                    spec.evaluateAs,
                    {
                        args: { [spec.as]: line },
                        agent: context.agent
                    },
                    registry
                );

            if (verdict.decision === DECISIONS.DENY) {

                return {
                    decision: DECISIONS.DENY,
                    reason: `line ${index + 1} of the input: ${verdict.reason}`,
                    rule: verdict.rule
                };
            }

            if (
                !stricter &&
                verdict.decision === DECISIONS.REQUIRE_APPROVAL &&
                current.decision === DECISIONS.ALLOW
            ) {

                stricter = {
                    decision: DECISIONS.REQUIRE_APPROVAL,
                    reason: `line ${index + 1} of the input: ${verdict.reason}`,
                    rule: verdict.rule
                };
            }
        }

        return stricter;
    }


    match({ toolName, args, agent, registry }) {

        const context = {
            args: args || {},
            agent: agent || "main_agent"
        };

        const groups =
            registry.groupsFor(toolName);

        let decision =
            this.rulesDecision(toolName, context, registry);

        if (decision.decision !== DECISIONS.DENY) {

            const lineDecision =
                this.commandInputDecision(
                    toolName,
                    context,
                    registry,
                    decision
                );

            if (lineDecision) {
                decision = lineDecision;
            }
        }

        /*
        | P1-4: a high-risk command (recursive deletion of a root or drive,
        | disk tools, shutdown, a download piped into a shell, ...) is never
        | allowed without a person, whatever rule allowed it.
        */
        const risk =
            commandRisk(toolName, context.args);

        if (
            risk &&
            risk.risk === CommandRisk.RISK.HIGH &&
            decision.decision === DECISIONS.ALLOW
        ) {

            decision = {
                decision: DECISIONS.REQUIRE_APPROVAL,
                reason: `high-risk command: ${risk.reason}`,
                rule: "high_risk_command"
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
            ...decision,
            ...(risk
                ? { risk: risk.risk, risk_reason: risk.reason }
                : {})
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
    ruleTargets,
    commandInputTools,
    commandRiskTools,
    commandRisk,
    isPathArgument
};
