"use strict";

const { COLOURS } = require("./OutputRenderer");

/*
|--------------------------------------------------------------------------
| Interactive Approval Prompt — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Answers approval requests using the interactive session's input reader
| so the prompt and the question never race over stdin.
|--------------------------------------------------------------------------
*/

class ApprovalPrompt {

    static install(runtime, inputReader, out = process.stdout) {

        runtime.setApprovalHandler((evaluation, args) => {

            return ApprovalPrompt.promptApproval(
                evaluation,
                args,
                inputReader,
                out
            );
        });
    }

    static async promptApproval(evaluation, args, inputReader, out = process.stdout) {

        const summary =
            JSON.stringify(args || {}).slice(0, 200);

        out.write(
            `\n${COLOURS.yellow("approval required")}\n` +
            `  agent : ${evaluation.agent}\n` +
            `  tool  : ${COLOURS.bold(evaluation.tool)}\n` +
            `  reason: ${evaluation.reason}\n` +
            `  args  : ${summary}\n` +
            `  allow? [y/N] `
        );

        const answer =
            await inputReader.readAnswer();

        const allowed =
            /^y(es)?$/i.test((answer || "").trim());

        out.write(
            allowed
                ? COLOURS.green("  approved\n")
                : COLOURS.red("  refused\n")
        );

        return allowed;
    }
}

module.exports = {
    ApprovalPrompt
};
