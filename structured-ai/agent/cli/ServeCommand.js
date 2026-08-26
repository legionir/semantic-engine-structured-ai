"use strict";

const crypto = require("crypto");
const path = require("path");

/* Web console command — EXECUTION_PLAN Phase 26. */

class ServeCommand {
    constructor({ repoRoot } = {}) {
        this.repoRoot = repoRoot || path.resolve(__dirname, "../..");
    }

    async execute(runtime, options = {}) {
        if (options.interactive) {
            const error = new Error("--serve cannot be combined with --interactive");
            error.exitCode = 2;
            throw error;
        }

        const { createServer } = require(path.join(this.repoRoot, "web", "server.js"));
        const console_ = createServer(runtime, {
            ...options,
            token: process.env.AGENT_CONSOLE_TOKEN || crypto.randomBytes(24).toString("base64url")
        });
        const host = options.host || "127.0.0.1";
        const port = options.port || 7777;
        const address = await console_.listen(port, host);
        const consoleUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${address.port}?token=${encodeURIComponent(console_.token)}`;

        process.stdout.write(
            `structured-ai console\n` +
            `  url       : ${consoleUrl}\n` +
            `  token     : ${console_.token}\n` +
            `  workspace : ${runtime.createRuntimeContext().runtime.workspace_root}\n` +
            `  approval  : ${runtime.getApprovalMode()}\n`
        );

        return console_;
    }
}


module.exports = {
    ServeCommand
};
