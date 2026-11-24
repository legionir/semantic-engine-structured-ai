"use strict";

/* P1-6 load benchmark: 10 concurrent runtime agents, event-loop lag p99 <100ms. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { monitorEventLoopDelay } = require("perf_hooks");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p1-lag-benchmark-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "p1-lag-data-"));
process.env.WORKSPACE_ROOT = ROOT;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_PROVIDER = "openai-compatible";

const finalAction = content => ({
    version: "1.0",
    action: "final",
    tool_calls: null,
    delegations: null,
    response: { type: "text", content },
    data: null,
    error: null,
    performed: null
});


async function main() {

    let activeRequests = 0;
    let peakRequests = 0;
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            activeRequests += 1;
            peakRequests = Math.max(peakRequests, activeRequests);
            const payload = JSON.stringify({
                choices: [{
                    message: {
                        role: "assistant",
                        content: JSON.stringify(finalAction("benchmark-complete"))
                    }
                }]
            });
            setTimeout(() => {
                activeRequests -= 1;
                res.setHeader("content-type", "application/json");
                res.end(payload);
            }, 250);
        });
    });

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    process.env.AGENT_MODEL = "p1-lag-benchmark";

    const runtime = require("../../agent/agent");
    const histogram = monitorEventLoopDelay({ resolution: 10 });

    try {
        runtime.settings.set("AGENT_BASE_URL", process.env.AGENT_BASE_URL);
        runtime.settings.set("AGENT_MODEL", process.env.AGENT_MODEL);
        runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 10);
        runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);
        runtime.settings.set("MAX_WORKERS_PER_USER", 16);
        runtime.settings.set("RUN_QUEUE_LIMIT", 10);

        const registry = runtime.projects.registry();
        const projects = [];
        for (let index = 0; index < 10; index += 1) {
            const rootPath = path.join(ROOT, `agent-${index}`);
            fs.mkdirSync(rootPath, { recursive: true });
            projects.push(registry.register({
                id: `p1-lag-${index}`,
                name: `P1 lag benchmark ${index}`,
                rootPath
            }));
        }

        histogram.enable();
        const startedAt = Date.now();
        const answers = await Promise.all(projects.map((project, index) =>
            runtime.runAgent({ projectId: project.id, task: `benchmark task ${index}` })
        ));
        const elapsedMs = Date.now() - startedAt;
        histogram.disable();

        const p99Ms = histogram.percentile(99) / 1e6;
        assert.equal(answers.length, 10);
        answers.forEach(answer => assert.match(answer.response.content, /benchmark-complete/));
        assert.equal(peakRequests, 10, `only ${peakRequests}/10 provider calls overlapped`);
        assert.ok(Number.isFinite(p99Ms) && p99Ms < 100,
            `event-loop lag p99 ${p99Ms.toFixed(1)}ms exceeded 100ms`);

        console.log(`  ok   10 concurrent agents completed in ${elapsedMs}ms`);
        console.log(`  ok   event-loop lag p99 ${p99Ms.toFixed(1)}ms (<100ms)`);
        console.log("  ok   all 10 provider requests overlapped");
        console.log("\n3/3 passed");
    } finally {
        histogram.disable();
        await new Promise(resolve => server.close(resolve));
        await runtime.eventstore.flush();
        await runtime.journal.flush();
        fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        fs.rmSync(DATA_HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
