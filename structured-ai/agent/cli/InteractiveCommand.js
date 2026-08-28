"use strict";

const path = require("path");
const { REPO_ROOT, fail, EXIT } = require("./ArgParser");

/*
|--------------------------------------------------------------------------
| CLI Interactive Command — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Launches an interactive agent REPL session where history is preserved
| across multiple tasks and approvals are answered inline.
|--------------------------------------------------------------------------
*/

class InteractiveCommand {

    static async execute(runtime, options) {

        if (options.json) {
            fail("--json cannot be combined with --interactive");
        }

        const { startSession } =
            require(path.join(REPO_ROOT, "agent", "interactive"));

        const code =
            await startSession(runtime, options);

        return typeof code === "number" ? code : EXIT.SUCCESS;
    }
}

module.exports = {
    InteractiveCommand
};
