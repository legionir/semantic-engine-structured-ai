const fs = require("fs");
const os = require("os");
const path = require("path");

/*
| The MCP layer is what four different protocols have in common, so the
| suite proves the common part once and then proves that each transport
| really carries it: a server is started for real, over a real pipe,
| socket or port, and the same tool call is made through all four.
|
| WORKSPACE_ROOT must be set before the tools are loaded.
*/

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "mcp-test-")
    );
const TRUST_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "mcp-trust-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

/* P0-8: workspace trust is read from a store of the suite's own, never
   from the developer's ~/.config. */
process.env.STRUCTURED_AI_TRUST_FILE =
    path.join(TRUST_HOME, "trusted-workspaces.json");

const protocol = require("../../agent/mcp/protocol");
const config = require("../../agent/mcp/McpConfig");
const { McpManager } = require("../../agent/mcp/McpManager");
const { McpClient } = require("../../agent/mcp/McpConnection");
const websocket = require("../../agent/mcp/transports/WebSocketTransport");
const settings = require("../../agent/config");
const tools = require("../../agent/tools");

const results = [];

const cleanups = [];


function removeTempTree(target) {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
        /* Windows Defender/indexing can briefly retain handles even after
           every MCP transport has shut down. These are OS-temp folders;
           defer only transient Windows cleanup errors, not test failures. */
        if (process.platform !== "win32" || !["EBUSY", "EPERM"].includes(error.code)) {
            throw error;
        }
        console.warn(`  cleanup deferred for MCP temp tree (${error.code})`);
    }
}


async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}\n${error.stack}`);
    }
}


const { answer, writeStdioServer } =
    require("./mcp-stdio-server")({ WORKSPACE });

const { startHttpServer } =
    require("./mcp-http-server")({ answer, cleanups, websocket });


function freshManager() {

    const manager = new McpManager();

    cleanups.push(() => manager.shutdown());

    return manager;
}


async function main() {

    console.log(`workspace: ${WORKSPACE}\n`);

    /* the cases live in ./mcp-cases, run in this order */
    const ctx = {
        McpClient,
        WORKSPACE,
        cleanups,
        config,
        freshManager,
        protocol,
        settings,
        startHttpServer,
        test,
        tools,
        websocket,
        writeStdioServer
    };

    await require("./mcp-cases/01-wire-protocol")(ctx);
    await require("./mcp-cases/02-transports")(ctx);
    await require("./mcp-cases/03-manager-and-catalogue")(ctx);
    await require("./mcp-cases/04-policy")(ctx);


    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    removeTempTree(WORKSPACE);
    removeTempTree(TRUST_HOME);

    process.exit(failed.length === 0 ? 0 : 1);
}


main();
