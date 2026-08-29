"use strict";

/* Interactive approval prompt — EXECUTION_PLAN Phase 26. */

function createApprovalHandler({ readAnswer, colours, output = process.stdout } = {}) {
    return (evaluation, args) => {
        const summary = JSON.stringify(args || {}).slice(0, 200);
        output.write(
            `\n${colours.yellow("approval required")}\n` +
            `  agent : ${evaluation.agent}\n` +
            `  tool  : ${colours.bold(evaluation.tool)}\n` +
            `  reason: ${evaluation.reason}\n` +
            `  args  : ${summary}\n` +
            `  allow? [y/N] `
        );
        return readAnswer().then(answer => {
            const allowed = /^y(es)?$/i.test(answer.trim());
            output.write(allowed ? colours.green("  approved\n") : colours.red("  refused\n"));
            return allowed;
        });
    };
}

module.exports = {
    createApprovalHandler
};
