const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/*
| Every test runs against a throwaway workspace so the repository is
| never touched. WORKSPACE_ROOT must be set before the tools are loaded.
*/

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_TOOL_RESULT_CHARS = "20000";
process.env.PROCESS_SANDBOX_MODE = "test";

const tools = require("../../agent/tools");
const { WORKSPACE_ROOT } = require("../../agent/context/WorkspaceBoundary");

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}

const run = (name, args) =>
    tools.executeTool(name, args, { agent: "test" });

async function rejects(promise, pattern) {

    try {

        await promise;

    } catch (error) {

        assert.match(error.message, pattern);

        return error;
    }

    throw new Error(
        `Expected rejection matching ${pattern}`
    );
}


const PROCESS_TREE_HELPER =
    path.join(__dirname, "../helpers/process-tree-worker.js");

function processTreeCommand(pidFile) {

    const quote = value => `"${value}"`;

    return [
        quote(process.execPath),
        quote(PROCESS_TREE_HELPER),
        quote(pidFile)
    ].join(" ");
}

function readTreePids(pidFile) {

    if (!fs.existsSync(pidFile)) {
        return [];
    }

    return fs.readFileSync(pidFile, "utf8")
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter(Number.isInteger);
}

function isProcessAlive(pid) {

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

async function waitForTreeStopped(pidFile) {

    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {

        const pids = readTreePids(pidFile);

        if (pids.length === 2 && !pids.some(isProcessAlive)) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`process tree is still alive: ${readTreePids(pidFile).join(", ")}`);
}

function cleanupTree(pidFile) {

    const pids = readTreePids(pidFile).reverse();

    if (process.platform === "win32" && pids.length) {

        try {
            execFileSync("taskkill", ["/pid", String(pids[pids.length - 1]), "/T", "/F"], { stdio: "ignore" });
        } catch {}

        return;
    }

    for (const pid of pids) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {}
    }
}


async function main() {

    console.log(`workspace: ${WORKSPACE_ROOT}\n`);

    /* the cases live in ./tools-cases, run in this order */
    const ctx = {
        WORKSPACE,
        cleanupTree,
        processTreeCommand,
        readTreePids,
        rejects,
        run,
        test,
        tools,
        waitForTreeStopped
    };

    await require("./tools-cases/01-filesystem")(ctx);
    await require("./tools-cases/02-workspace-boundary")(ctx);
    await require("./tools-cases/03-process")(ctx);
    await require("./tools-cases/04-git")(ctx);
    await require("./tools-cases/05-friction-found-in-a-real-run")(ctx);


    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
