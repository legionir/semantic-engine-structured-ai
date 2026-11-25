"use strict";

/* P1-3: interactive terminal sessions through PTY/ConPTY. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p1-pty-"));
process.env.WORKSPACE_ROOT = workspace;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_VERBOSE = "0";

const tools = require("../../agent/tools");
const ProcessOutputBus = require("../../agent/tools/process/ProcessOutputBus");
const run = (name, args) => tools.executeTool(name, args, { agent: "p1-pty-test" });
const quote = value => `"${String(value).replace(/"/g, "\\\"")}"`;


async function main() {

    let started;
    const results = [];

    async function test(name, fn) {
        try {
            await fn();
            results.push(true);
            console.log(`  ok   ${name}`);
        } catch (error) {
            results.push(false);
            console.log(`  FAIL ${name}`);
            console.log(`       ${error.message}`);
        }
    }

    try {
        await test("an interactive terminal streams input, handles Ctrl-C, and stays alive", async () => {

            const program = "process.stdin.setEncoding('utf8'); process.stdin.on('data', value => console.log('PTY_INPUT:' + value.trim())); process.on('SIGINT', () => console.log('PTY_INTERRUPT')); console.log('PTY_READY'); setInterval(() => {}, 1000)";

            started = await run("process_start", {
                command: `${quote(process.execPath)} -e "${program}"`,
                interactive: true,
                cols: 100,
                rows: 30,
                wait_ms: 300
            });

            assert.equal(started.status, "running");
            assert.equal(started.interactive, true);

            await run("process_resize", {
                process_id: started.process_id,
                cols: 120,
                rows: 40
            });

            /* Node 24 can take longer to initialize the child than the
               process_start grace period. Wait for an explicit child-ready
               marker so PTY line echo cannot be mistaken for delivered input. */
            let startupOutput = started.stdout || "";
            const startupDeadline = Date.now() + 5000;
            while (!startupOutput.includes("PTY_READY") && Date.now() < startupDeadline) {
                const readiness = await run("process_read", {
                    process_id: started.process_id,
                    wait_ms: Math.min(250, Math.max(1, startupDeadline - Date.now()))
                });
                startupOutput += readiness.stdout || "";
                assert.equal(readiness.status, "running");
            }
            assert.match(startupOutput, /PTY_READY/);

            const outputStartedAt = Date.now();
            let removeLiveListener;
            const liveOutput = new Promise(resolve => {
                const listener = event => {
                    if (event.process_id === started.process_id && event.text.includes("PTY_INPUT:first")) {
                        resolve(Date.now() - outputStartedAt);
                    }
                };
                ProcessOutputBus.on("output", listener);
                removeLiveListener = () => ProcessOutputBus.removeListener("output", listener);
            });

            await run("process_write", {
                process_id: started.process_id,
                input: "first"
            });

            const first = await run("process_read", {
                process_id: started.process_id,
                wait_ms: 2000
            });

            assert.match(first.stdout, /PTY_INPUT:first/);
            const streamLatency = await Promise.race([
                liveOutput,
                new Promise((_, reject) => setTimeout(() => reject(new Error("live PTY output timed out")), 1000))
            ]);
            removeLiveListener();
            assert.ok(streamLatency < 200, `live PTY output arrived after ${streamLatency} ms`);

            await run("process_write", {
                process_id: started.process_id,
                input: "\u0003",
                append_newline: false
            });

            const interrupted = await run("process_read", {
                process_id: started.process_id,
                wait_ms: 2000
            });

            assert.match(interrupted.stdout, /PTY_INTERRUPT/);

            await run("process_write", {
                process_id: started.process_id,
                input: "again"
            });

            const second = await run("process_read", {
                process_id: started.process_id,
                wait_ms: 2000
            });

            assert.match(second.stdout, /PTY_INPUT:again/);
            assert.equal(second.status, "running");
        });

        await test("non-PTY sessions reject terminal resize", async () => {

            const plain = await run("process_start", {
                command: `${quote(process.execPath)} -e "setInterval(() => {}, 1000)"`,
                wait_ms: 100
            });

            try {
                await assert.rejects(
                    run("process_resize", { process_id: plain.process_id, cols: 80, rows: 24 }),
                    /interactive PTY/
                );
            } finally {
                await run("process_terminate", { process_id: plain.process_id, grace_ms: 100 });
            }
        });

        await test("PTY dimensions are bounded", async () => {

            await assert.rejects(
                run("process_resize", { process_id: started.process_id, cols: 5, rows: 24 }),
                /dimensions/
            );
        });
    } finally {
        if (started && started.status === "running") {
            try {
                await run("process_terminate", { process_id: started.process_id, grace_ms: 200 });
            } catch {}
        }
        tools.shutdown();
        fs.rmSync(workspace, { recursive: true, force: true });
    }

    const failed = results.filter(ok => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    tools.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
    process.exit(1);
});
