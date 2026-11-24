"use strict";

/* P1-6: user-provided regex evaluation must not block the main event loop. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p1-regex-worker-"));
process.env.WORKSPACE_ROOT = workspace;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_VERBOSE = "0";

const tools = require("../../agent/tools");
const { RepositoryDetector } = require("../../agent/runtime/RepositoryDetector");
const run = (name, args) => tools.executeTool(name, args, { agent: "p1-regex-worker-test" });


async function main() {

    let heartbeat = 0;
    const tick = setInterval(() => heartbeat++, 20);

    try {
        const detector = new RepositoryDetector({
            execFileImpl: (_command, args, _options, callback) => {
                setTimeout(() => {
                    const value = args[0] === "rev-parse" && args[1] === "--show-toplevel" ? workspace
                        : args[0] === "status" ? ""
                            : args[1] === "--abbrev-ref" ? "main"
                                : "abc123";
                    callback(null, `${value}\n`);
                }, 15);
            }
        });
        const detectStarted = Date.now();
        const initialRepository = detector.detect(workspace);
        assert.ok(Date.now() - detectStarted < 10, "repository detection blocked the caller");
        assert.equal(initialRepository.available, false, "uncached repository state should not block prompt construction");
        const refreshedRepository = await detector.refresh(workspace);
        assert.equal(refreshedRepository.type, "git");
        assert.equal(refreshedRepository.branch, "main");
        assert.equal(refreshedRepository.clean, true);
        console.log("  ok   git status and repository metadata refresh asynchronously into a cache");

        await fs.promises.writeFile(
            path.join(workspace, "catastrophic.txt"),
            `${"a".repeat(10 * 1024 * 1024)}!`
        );

        const startedAt = Date.now();
        const started = await run("search_start", {
            path: ".",
            query: "(a+)+$",
            is_regex: true,
            wait_ms: 100,
            max_results: 10
        });

        let current = started;
        const deadline = Date.now() + 4500;

        while (current.status === "running" && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
            current = await run("search_get", { search_id: started.search_id });
        }

        assert.equal(current.status, "failed", `search status was ${current.status}`);
        assert.match(current.error, /exceeded 2000 ms/);
        assert.ok(heartbeat >= 5, `main event loop only ticked ${heartbeat} times`);
        assert.ok(Date.now() - startedAt < 4000, "the regex was not stopped near its two-second budget");

        console.log("  ok   a catastrophic regex over a 10 MiB line is stopped in a worker while the event loop stays responsive");
        console.log("\n1/1 passed");
    } finally {
        clearInterval(tick);
        tools.shutdown();
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    tools.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
    process.exit(1);
});
