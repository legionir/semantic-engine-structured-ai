"use strict";

/* Help/version command — EXECUTION_PLAN Phase 26. */

class HelpCommand {
    constructor({ usage, version } = {}) {
        this.usage = usage || "";
        this.version = version || "";
    }

    execute(kind = "help", stream = process.stdout) {
        if (kind === "version") {
            stream.write(`${this.version}\n`);
            return 0;
        }
        stream.write(`${this.usage}\n`);
        return 0;
    }
}


module.exports = {
    HelpCommand
};
