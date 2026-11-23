"use strict";

/* Interactive approval prompt — EXECUTION_PLAN Phase 26. */

/*
| P0-8: an approval needs a person at a terminal. When the session reads a
| pipe (no TTY), a "y" in the input is not an operator's answer: it may be
| a script, or text a task copied in. Such a session refuses every
| approval instead of reading one from the stream.
*/
function createApprovalHandler({
    readAnswer,
    colours,
    output = process.stdout,
    interactive = true
} = {}) {
    return (evaluation, args) => {
        const summary = JSON.stringify(args || {}).slice(0, 200);
        output.write(
            `\n${colours.yellow("approval required")}\n` +
            `  agent : ${evaluation.agent}\n` +
            `  tool  : ${colours.bold(evaluation.tool)}\n` +
            `  reason: ${evaluation.reason}\n` +
            `  args  : ${summary}\n`
        );
        if (!interactive) {
            output.write(colours.red("  refused (no terminal to ask: AGENT_APPROVAL=prompt needs a TTY)\n"));
            return Promise.resolve(false);
        }
        output.write(`  allow? [y/N] `);
        return readAnswer().then(answer => {
            const allowed = /^y(es)?$/i.test(String(answer || "").trim());
            output.write(allowed ? colours.green("  approved\n") : colours.red("  refused\n"));
            return allowed;
        });
    };
}

module.exports = {
    createApprovalHandler
};
