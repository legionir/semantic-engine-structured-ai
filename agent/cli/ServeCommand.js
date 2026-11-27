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

        /* the served console keeps a persistent application log and
           records crashes; plain CLI runs and tests do not write it */
        const { logs } = require("../runtime/LogStore");
        const { resolveDataHome } = require("../projects/ProjectStore");
        try {
            logs.persistTo(path.join(resolveDataHome(), "logs"));
        } catch (error) {
            process.stderr.write(`agent: application log file disabled (${error.message})\n`);
        }
        logs.installProcessHooks();

        const { createServer } = require(path.join(this.repoRoot, "web", "server.js"));
        const console_ = createServer(runtime, {
            ...options,
            token: process.env.AGENT_CONSOLE_TOKEN || crypto.randomBytes(24).toString("base64url")
        });
        const host = options.host || "127.0.0.1";
        const port = options.port || 7777;
        const address = await console_.listen(port, host);
        const passwordRequired = runtime.settings.get("AGENT_CONSOLE_PASSWORD_REQUIRED") === true;
        const consoleUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${address.port}${passwordRequired ? "" : `?token=${encodeURIComponent(console_.token)}`}`;

        process.stdout.write(
            `structured-ai console\n` +
            `  url       : ${consoleUrl}\n` +
            (passwordRequired ? "  auth      : password required\n" : `  token     : ${console_.token}\n`) +
            `  workspace : ${runtime.createRuntimeContext().runtime.workspace_root}\n` +
            `  approval  : ${runtime.getApprovalMode()}\n` +
            (logs.file() ? `  log file  : ${logs.file()}\n` : "")
        );
        logs.info("server", `Console listening on ${host}:${address.port}`);

        return console_;
    }
}


module.exports = {
    ServeCommand
};
