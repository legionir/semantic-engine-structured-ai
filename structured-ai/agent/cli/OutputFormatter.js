"use strict";

/*
|--------------------------------------------------------------------------
| CLI Output Formatter — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Output formatting helpers for catalogue listings (--list-tools,
| --list-agents, --list-policy), task durations, JSON responses, and
| reports.
|--------------------------------------------------------------------------
*/

function formatDuration(ms) {

    return ms < 1000
        ? `${ms} ms`
        : `${(ms / 1000).toFixed(1)} s`;
}


function formatJsonAction(action) {

    return `${JSON.stringify(action, null, 2)}\n`;
}


function formatErrorAction(error) {

    return `${
        JSON.stringify(
            {
                version: "1.0",
                action: "final",
                tool_calls: null,
                delegations: null,
                response: null,
                data: null,
                error: {
                    code: error?.name || "RUNTIME_ERROR",
                    message: error?.message || String(error),
                    retryable: false
                }
            },
            null,
            2
        )
    }\n`;
}


function printCatalogue(runtime, options, out = process.stdout) {

    const {
        TOOLS,
        TOOL_GROUPS,
        AGENTS,
        POLICY
    } = runtime.registries;

    if (options.listTools) {

        for (
            const [group, definition]
            of Object.entries(TOOL_GROUPS)
        ) {

            out.write(
                `\n${group}${
                    definition.destructive
                        ? " (destructive)"
                        : ""
                }\n  ${definition.description}\n`
            );

            for (const name of definition.tools) {

                const tool =
                    TOOLS.find(
                        item => item.function.name === name
                    );

                out.write(
                    `    ${name.padEnd(18)} ${
                        tool
                            ? tool.function.description.split(".")[0]
                            : ""
                    }\n`
                );
            }
        }

        out.write(
            `\n${TOOLS.length} tools in ${
                Object.keys(TOOL_GROUPS).length
            } groups\n`
        );
    }

    if (options.listAgents) {

        for (const agent of AGENTS) {

            out.write(
                `\n${agent.name}\n  ${agent.description}\n` +
                `    persona    : ${agent.persona || "-"}\n` +
                `    skills     : ${(agent.skills || []).join(", ") || "-"}\n` +
                `    tools      : ${
                    agent.tools === "*"
                        ? "all"
                        : (agent.tools || []).join(", ")
                }\n` +
                `    delegation : ${
                    agent.delegation && agent.delegation.enabled
                        ? `depth ${agent.delegation.max_depth}, children ${agent.delegation.max_children}`
                        : "not allowed"
                }\n`
            );
        }
    }

    if (options.listPolicy) {

        out.write(
            `\ndefault action: ${POLICY.default_action}\n` +
            `approval mode : ${runtime.policyEngine.summary().mode}\n\n`
        );

        for (const rule of POLICY.rules) {

            out.write(
                `  ${rule.action.padEnd(17)} ${
                    (rule.tools || rule.groups || []).join(", ")
                }\n      ${rule.reason}\n`
            );
        }
    }
}


function formatDiscussionReport(result) {

    const report = result.final_report || {};

    let output =
        `\nDiscussion complete: ${result.total_rounds} round${result.total_rounds === 1 ? "" : "s"}${
            result.stopped_reason
                ? ` (stopped: ${result.stopped_reason})`
                : result.hit_max_rounds
                    ? " (max rounds reached)"
                    : ""
        }\n\n`;

    if (report.summary) {
        output += `Summary\n  ${report.summary}\n\n`;
    }

    if (report.agreed_points?.length) {
        output += "Agreed\n";

        for (const point of report.agreed_points) {
            output += `  - ${point}\n`;
        }

        output += "\n";
    }

    if (report.unresolved?.length) {
        output += "Unresolved\n";

        for (const item of report.unresolved) {
            output += `  - ${item.topic}\n`;

            for (const side of item.sides || []) {
                output += `      ${side.persona}: ${side.reasoning}\n`;
            }
        }

        output += "\n";
    }

    if (report.next_steps?.length) {
        output += "Next steps\n";

        for (const step of report.next_steps) {
            output += `  ${step.order}. [${step.layer}] ${step.action}\n`;
        }
    }

    return output;
}


module.exports = {
    formatDuration,
    formatJsonAction,
    formatErrorAction,
    printCatalogue,
    formatDiscussionReport
};
