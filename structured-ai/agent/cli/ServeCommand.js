"use strict";

const path = require("path");
const crypto = require("crypto");
const { REPO_ROOT, fail, EXIT } = require("./ArgParser");

/*
|--------------------------------------------------------------------------
| CLI Serve Command — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Launches the structured-ai web console server.
|--------------------------------------------------------------------------
*/

class ServeCommand {

    static async execute(runtime, options, out = process.stdout) {

        if (options.interactive) {
            fail("--serve cannot be combined with --interactive");
        }

        const { createServer } =
            require(path.join(REPO_ROOT, "web", "server.js"));

        const console_ =
            createServer(runtime, {
                ...options,
                token:
                    process.env.AGENT_CONSOLE_TOKEN ||
                    crypto.randomBytes(24).toString("base64url")
            });

        const host =
            options.host || "127.0.0.1";

        const port =
            options.port || 7777;

        const address =
            await console_.listen(port, host);

        const consoleUrl =
            `http://${
                host === "0.0.0.0"
                    ? "localhost"
                    : host
            }:${address.port}?token=${encodeURIComponent(console_.token)}`;

        out.write(
            `structured-ai console\n` +
            `  url       : ${consoleUrl}\n` +
            `  token     : ${console_.token}\n` +
            `  workspace : ${runtime.createRuntimeContext().runtime.workspace_root}\n` +
            `  approval  : ${runtime.getApprovalMode()}\n`
        );

        return {
            server: console_,
            address,
            url: consoleUrl,
            token: console_.token
        };
    }
}

module.exports = {
    ServeCommand
};
