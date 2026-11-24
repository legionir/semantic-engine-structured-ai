"use strict";

/* One-shot run command — EXECUTION_PLAN Phase 26. */

class RunCommand {
    constructor({ runtime, lifecycle, tools } = {}) {
        this.runtime = runtime;
        this.lifecycle = lifecycle;
        this.tools = tools;
    }

    async execute(options = {}, task) {
        const runtime = this.runtime;
        const action = await runtime.runAgent(
            options.project ? { projectId: options.project } : undefined
        );
        if (this.lifecycle?.shutdown) {
            await this.lifecycle.shutdown({
                tools: this.tools,
                eventstore: runtime.eventstore
            });
        }
        return { action, task };
    }
}


module.exports = {
    RunCommand
};
