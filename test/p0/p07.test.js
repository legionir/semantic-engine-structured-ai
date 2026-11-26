"use strict";

/*
|--------------------------------------------------------------------------
| P0-7 — Runtime reliability regression tests
|--------------------------------------------------------------------------
|
|   1. a dependent tool call must not execute when its depends_on failed
|      (agent/runtime/ToolGraphExecutor.js, executeDependencyGraph isReady)
|   2. a cancel requested before startRun attaches a controller must not
|      be lost (agent/runtime/RunCancellation.js abort())
|   3. invalid CLI values (--temperature 3, --max-iterations 5000) are
|      rejected up front with a usage error (exit 2) (agent/cli/Cli.js)
|   4. a failing REPL /command must not wedge the session
|      (agent/interactive/Repl.js drain/handleCommand)
|
| Never talks to a real LLM or the network; every child is spawned with
| process.execPath and killed on timeout.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BIN = path.join(REPO, "bin", "agent.js");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p07-ws-"));

const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p07-data-"));

const SCRATCH =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p07-scratch-"));

/* Set before agent.js is ever required (in-process or in a child). */
process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_RUN_MS = process.env.MAX_RUN_MS || "15000";

const GLOBAL_TIMEOUT_MS = 180000;

setTimeout(() => {
    console.error(`p07: global timeout of ${GLOBAL_TIMEOUT_MS} ms exceeded`);
    process.exit(1);
}, GLOBAL_TIMEOUT_MS).unref();

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


function runNode(args, { env = {}, stdin = null, timeoutMs = 60000 } = {}) {

    return new Promise(resolve => {

        const child =
            spawn(
                process.execPath,
                args,
                {
                    cwd: REPO,
                    env: {
                        ...process.env,
                        WORKSPACE_ROOT: WORKSPACE,
                        STRUCTURED_AI_DATA_HOME: DATA_HOME,
                        /* never a real endpoint: refused immediately */
                        AGENT_BASE_URL: "http://127.0.0.1:1/v1",
                        AGENT_API_KEY: "p07-test-key",
                        NO_COLOR: "1",
                        ...env
                    },
                    stdio: [
                        stdin === null ? "ignore" : "pipe",
                        "pipe",
                        "pipe"
                    ]
                }
            );

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);

        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });

        if (stdin !== null) {
            child.stdin.on("error", () => {});
            child.stdin.write(stdin);
            child.stdin.end();
        }

        child.on("close", code => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, timedOut });
        });

        child.on("error", error => {
            clearTimeout(timer);
            resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
        });
    });
}


function runCli(args, options) {

    return runNode([BIN, ...args], options);
}


async function main() {

    console.log("p0-7 runtime reliability");

    /* ------------------------------------------------------------------ */
    /* 1. dependency graph                                                 */
    /* ------------------------------------------------------------------ */

    await test("P0-7: a dependent call does not execute when its depends_on failed", async () => {

        const { executeDependencyGraph } =
            require(path.join(REPO, "agent", "runtime", "ToolGraphExecutor.js"));

        const executed = [];

        const output =
            await executeDependencyGraph({
                items: [
                    { id: "a", depends_on: [] },
                    { id: "b", depends_on: ["a"] },
                    { id: "c", depends_on: ["b"] },
                    { id: "free", depends_on: [] }
                ],
                maxParallel: 4,
                executor: async item => {

                    executed.push(item.id);

                    if (item.id === "a") {
                        throw new Error("a failed on purpose");
                    }

                    return { ran: item.id };
                }
            });

        assert.ok(executed.includes("a"), "the root call must run");
        assert.ok(executed.includes("free"), "an independent sibling must still run");

        assert.ok(
            !executed.includes("b"),
            `call "b" ran although its dependency "a" failed (executed: ${executed.join(", ")})`
        );

        assert.ok(
            !executed.includes("c"),
            `call "c" ran although its transitive dependency "a" failed (executed: ${executed.join(", ")})`
        );

        const byId = new Map(output.map(entry => [entry && entry.id, entry]));

        assert.equal(output.length, 4, "every item must get a result");

        assert.equal(byId.get("a").success, false);
        assert.equal(byId.get("free").success, true);

        assert.ok(byId.get("b"), "the skipped dependent must still get a result");
        assert.equal(byId.get("b").success, false, "a dependent of a failed call must not report success");

        assert.ok(byId.get("c"), "the transitive dependent must still get a result");
        assert.equal(byId.get("c").success, false, "a transitive dependent of a failed call must not report success");
    });

    /* ------------------------------------------------------------------ */
    /* 2. cancellation before startRun                                     */
    /* ------------------------------------------------------------------ */

    await test("P0-7: RunCancellation keeps a cancel requested before a controller is attached", async () => {

        const RunCancellation =
            require(path.join(REPO, "agent", "runtime", "RunCancellation.js"));

        const cancellation = new RunCancellation();

        assert.equal(cancellation.controller, null);

        cancellation.abort();

        /* startRun attaches the controller afterwards (a plain property
           write through AgentRunContext.controller). */
        const controller = new AbortController();

        cancellation.controller = controller;

        assert.equal(
            cancellation.isCancelled,
            true,
            "a cancel requested before the controller existed was lost"
        );
    });

    await test("P0-7: cancelRunById before startRun is not lost once the run starts", async () => {

        const runtime =
            require(path.join(REPO, "agent", "agent.js"));

        assert.equal(typeof runtime.runManager.createRun, "function");
        assert.equal(typeof runtime.runManager.execute, "function");
        assert.equal(typeof runtime.cancelRunById, "function");
        assert.equal(typeof runtime.startRun, "function");
        assert.equal(typeof runtime.isRunCancelled, "function");

        const context =
            runtime.runManager.createRun({ task: "p07 early cancel probe" });

        let cancelledAfterStart = null;
        let startError = null;
        let innerError = null;

        await runtime.runManager.execute(context, async () => {

            /* The run is tracked (status running) but startRun has not
               attached its AbortController yet. */
            assert.equal(context.controller, null, "precondition: no controller before startRun");

            assert.equal(
                runtime.cancelRunById(context.runId, "user"),
                true,
                "the run is tracked, so the cancel must be accepted"
            );

            /* A fix may either refuse to start (throw a cancel error) or
               start already-aborted; both keep the cancel. */
            try {
                runtime.startRun();
            } catch (error) {
                startError = error;
            }

            cancelledAfterStart = runtime.isRunCancelled();
        }).catch(error => {
            innerError = error;
        });

        if (innerError) {
            throw innerError;
        }

        const refusedToStart =
            Boolean(
                startError &&
                /cancel|abort/i.test(`${startError.code || ""} ${startError.message || ""}`)
            );

        if (startError && !refusedToStart) {
            throw startError;
        }

        assert.ok(
            cancelledAfterStart === true || refusedToStart,
            "the cancel requested before startRun was silently dropped: the run went on as active"
        );

        assert.equal(
            context.cancellation.isCancelled,
            true,
            "the run's own cancellation state must report cancelled"
        );
    });

    /* ------------------------------------------------------------------ */
    /* 3. CLI value validation                                             */
    /* ------------------------------------------------------------------ */

    await test("P0-7: --temperature 3 is rejected up front with a usage error", async () => {

        const run = await runCli(["--temperature", "3", "--list-tools"]);

        assert.ok(!run.timedOut, "the CLI did not exit in time");

        assert.equal(
            run.code,
            2,
            `expected usage exit 2 for --temperature 3, got ${run.code}\n${run.stderr.slice(0, 400)}`
        );

        assert.match(run.stderr, /temperature/i, "the usage error must name the temperature option");
    });

    await test("P0-7: --max-iterations 5000 is rejected up front with a usage error", async () => {

        const run = await runCli(["--max-iterations", "5000", "--list-tools"]);

        assert.ok(!run.timedOut, "the CLI did not exit in time");

        assert.equal(
            run.code,
            2,
            `expected usage exit 2 for --max-iterations 5000, got ${run.code}\n${run.stderr.slice(0, 400)}`
        );

        assert.match(run.stderr, /max.?iterations/i, "the usage error must name the max-iterations option");
    });

    await test("P0-7: in-range CLI values are still accepted (control)", async () => {

        const run = await runCli(["--temperature", "1", "--max-iterations", "10", "--list-tools"]);

        assert.ok(!run.timedOut, "the CLI did not exit in time");

        assert.equal(
            run.code,
            0,
            `valid values must not be rejected, got ${run.code}\n${run.stderr.slice(0, 400)}`
        );
    });

    /* ------------------------------------------------------------------ */
    /* 4. REPL resilience                                                  */
    /* ------------------------------------------------------------------ */

    await test("P0-7: a failing REPL /command does not wedge the session", async () => {

        const harness = path.join(SCRATCH, "repl-harness.js");

        const missingTarget =
            path.join(SCRATCH, "no-such-dir", "nested", "answer.txt");

        fs.writeFileSync(
            harness,
            [
                "\"use strict\";",
                `const { startSession } = require(${JSON.stringify(path.join(REPO, "agent", "interactive", "Repl.js"))});`,
                "process.on(\"unhandledRejection\", error => {",
                "    process.stdout.write(`\\nUNHANDLED_REJECTION ${error && error.message}\\n`);",
                "    process.exit(3);",
                "});",
                "const runtime = {",
                "    settings: { get: key => (key === \"SESSION_HISTORY_SIZE\" ? 100 : undefined) },",
                "    setApprovalHandler() {},",
                `    createRuntimeContext: () => ({ runtime: { workspace_root: ${JSON.stringify(WORKSPACE)} } }),`,
                "    activeModel: () => \"stub-model\",",
                "    getApprovalMode: () => \"deny\",",
                "    setApprovalMode() {},",
                "    setModelOverride() {},",
                "    isRunCancelled: () => false,",
                "    cancelRun() {},",
                "    cancelRunById: () => false,",
                "    runManager: { activeRuns: () => [] },",
                "    registries: { TOOL_GROUPS: {}, AGENTS: [], POLICY: { rules: [] } },",
                "    runAgent: async () => ({ response: { type: \"text\", content: \"stub-answer\" }, error: null })",
                "};",
                "startSession(runtime, { verbose: false }).then(",
                "    code => { process.stdout.write(`\\nSESSION_END ${code}\\n`); process.exit(code); },",
                "    error => { process.stdout.write(`\\nSESSION_REJECTED ${error && error.message}\\n`); process.exit(4); }",
                ");",
                ""
            ].join("\n")
        );

        /* task -> answer exists; /save into a missing directory throws
           inside the command handler; /help must still be served. */
        const input =
            [
                "hello",
                `/save ${missingTarget}`,
                "/help",
                ""
            ].join("\n");

        const run = await runNode([harness], { stdin: input, timeoutMs: 30000 });

        assert.ok(
            !run.timedOut,
            "the session hung after a failing /command (wedged)"
        );

        assert.doesNotMatch(
            run.stdout,
            /UNHANDLED_REJECTION/,
            "a failing /command escaped as an unhandled rejection"
        );

        assert.match(
            run.stdout,
            /stub-answer/,
            "precondition: the stub task answer was printed"
        );

        assert.match(
            run.stdout,
            /ENOENT|no such file/i,
            "the failing /save must be reported to the user"
        );

        assert.match(
            run.stdout,
            /Commands\s*\n\s*\/help/,
            "the /help typed after the failing command was never handled"
        );

        assert.match(run.stdout, /SESSION_END 0/, `session did not end cleanly (exit ${run.code})`);

        assert.equal(run.code, 0);

        assert.ok(!fs.existsSync(missingTarget));
    });

    /* ------------------------------------------------------------------ */

    try {
        const tools = require(path.join(REPO, "agent", "tools"));
        if (tools && typeof tools.shutdown === "function") {
            tools.shutdown();
        }
    } catch {
        /* best effort */
    }

    for (const dir of [WORKSPACE, DATA_HOME, SCRATCH]) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
            /* best effort on Windows file locks */
        }
    }

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}


main().catch(error => {

    console.error(error);

    process.exitCode = 1;
});
