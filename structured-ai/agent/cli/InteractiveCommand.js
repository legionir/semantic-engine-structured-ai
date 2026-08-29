"use strict";

const path = require("path");

/* Interactive command — EXECUTION_PLAN Phase 26. */

class InteractiveCommand {
    constructor({ repoRoot } = {}) {
        this.repoRoot = repoRoot || path.resolve(__dirname, "../..");
    }

    async execute(runtime, options = {}) {
        if (options.json) {
            const error = new Error("--json cannot be combined with --interactive");
            error.exitCode = 2;
            throw error;
        }
        const { startSession } = require(path.join(this.repoRoot, "agent", "interactive"));
        return startSession(runtime, options);
    }
}


module.exports = {
    InteractiveCommand
};
