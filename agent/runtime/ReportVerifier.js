"use strict";

/*
|--------------------------------------------------------------------------
| Report Verifier (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Compares a final action's `performed` claim with what the runtime
| actually executed. A mismatch is reported, never silently corrected.
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");


function checkPerformedClaim(action, progress, scope) {

    const h = host();

    const claim = action?.performed;

    if (!claim || typeof claim !== "object") {
        return null;
    }

    const executed =
        h.toolRuntime.executedToolNames
            ? h.toolRuntime.executedToolNames(
                  h.currentRun() instanceof h.AgentRunContext
                      ? h.currentRun().runId
                      : undefined
              )
            : [];

    const problems = [];

    for (const tool of claim.tools || []) {

        if (!executed.includes(tool)) {

            problems.push(
                `claimed ${tool}, which the runtime never executed`
            );
        }
    }

    if (
        (claim.agents || []).length > 0 &&
        progress.delegations === 0
    ) {

        problems.push(
            `claimed ${
                (claim.agents || []).join(", ")
            }, but nothing was delegated`
        );
    }

    if (
        (claim.files_changed || []).length > 0 &&
        !executed.some(
            name => h.FILE_MUTATING_TOOLS.includes(name)
        )
    ) {

        problems.push(
            `claimed ${
                claim.files_changed.length
            } changed file(s), but no write ran`
        );
    }

    if (problems.length === 0) {
        return null;
    }

    h.logLine(
        scope || "main_agent",
        `The answer claims work the runtime did not do: ${
            problems.join("; ")
        }`
    );

    h.events.emit("report:mismatch", {
        agent: scope || "main_agent",
        problems,
        claimed: claim,
        executed
    });

    return problems;
}


module.exports = {
    checkPerformedClaim
};
