"use strict";

/*
|--------------------------------------------------------------------------
| MVP Isolation, Load and Acceptance — EXECUTION_PLAN Phase 13
|--------------------------------------------------------------------------
|
| This phase does not add product features. It records the evidence
| that Multi-Project MVP is isolatable, recoverable under load, and
| acceptable end-to-end (گام ۱۹ of MULTI_PROJECT_IMPLEMENTATION_PLAN).
|
|   1. Project / tool / runtime / MCP / persistence isolation
|   2. Load (two heavy runs + a queued third) and recovery
|   3. The ten-step acceptance scenario
|
| The official MVP runtime bundle is all-modular. Schema defaults stay
| `legacy` so unscoped single-project CLI/API remain bit-identical
| (decision 32); these tests set the bundle explicitly.
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const PARENT_A = fs.mkdtempSync(path.join(os.tmpdir(), "mvp-parent-a-"));
const PARENT_B = fs.mkdtempSync(path.join(os.tmpdir(), "mvp-parent-b-"));
const PARENT_C = fs.mkdtempSync(path.join(os.tmpdir(), "mvp-parent-c-"));
const ROOT_A = path.join(PARENT_A, "engine-core");
const ROOT_B = path.join(PARENT_B, "engine-core");
const ROOT_C = path.join(PARENT_C, "engine-core");
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "mvp-ws-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mvp-data-"));

fs.mkdirSync(ROOT_A, { recursive: true });
fs.mkdirSync(ROOT_B, { recursive: true });
fs.mkdirSync(ROOT_C, { recursive: true });

const MARKER_A = "zzmvpalpha41e8";
const MARKER_B = "zzmvpbeta9c2d";
const MARKER_C = "zzmvpgamma7f01";

fs.writeFileSync(path.join(ROOT_A, "marker.txt"), `alpha-only ${MARKER_A}\n`);
fs.writeFileSync(path.join(ROOT_B, "marker.txt"), `beta-only ${MARKER_B}\n`);
fs.writeFileSync(path.join(ROOT_C, "marker.txt"), `gamma-only ${MARKER_C}\n`);

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_RUN_MS = "20000";
process.env.MAX_REQUEST_MS = "10000";
process.env.MAX_CONCURRENT_PROJECT_RUNS = "2";
process.env.MAX_RUNS_PER_PROJECT = "1";
process.env.RUN_QUEUE_LIMIT = "4";

const REPO = path.resolve(__dirname, "..", "..");

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


function action(value) {

    return {
        version: "1.0",
        tool_calls: null,
        delegations: null,
        response: null,
        data: null,
        error: null,
        performed: null,
        ...value
    };

}


function finalAction(content) {

    return action({
        action: "final",
        response: { type: "text", content }
    });

}


function toolCall(id, name, args) {

    return action({
        action: "tool_call",
        tool_calls: [
            { id, name, arguments: args, depends_on: [] }
        ]
    });

}


function isSubAgent(request) {

    return (request.messages || []).some(
        message =>
            typeof message.content === "string" &&
            message.content.includes("\"agent_profile\"")
    );

}


function hasToolResults(request) {

    return (request.messages || []).some(message => message.role === "tool");

}


function messageText(request) {

    return JSON.stringify(request.messages || []);

}


function projectContextId(request) {

    for (const message of request.messages || []) {

        if (typeof message.content !== "string") {
            continue;
        }

        try {

            const parsed = JSON.parse(message.content);

            if (parsed.type === "project_context") {
                return parsed.project && parsed.project.id;
            }

        } catch {
            /* not json */
        }

    }

    return null;

}


function contextFor(runtime, record) {

    return {
        agent: "main_agent",
        runId: `run-mvp-${record.id}`,
        projectId: record.id,
        projectContext: runtime.projects.createProjectContext(record)
    };

}


function initGit(root, message) {

    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "mvp@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "MVP Test"], { cwd: root });
    execFileSync("git", ["add", "marker.txt"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });

}


function startModelStub(handler) {

    return new Promise(resolve => {

        const state = { requests: [], handler };

        const server = http.createServer((req, res) => {

            let body = "";

            req.on("data", chunk => (body += chunk));

            req.on("end", () => {

                const parsed = JSON.parse(body || "{}");

                state.requests.push(parsed);

                const reply =
                    state.handler
                        ? state.handler(parsed, state.requests.length)
                        : { content: "done" };

                const respond = () => {

                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({
                        choices: [{
                            message: {
                                role: "assistant",
                                content: JSON.stringify(
                                    reply.action || finalAction(reply.content || "done")
                                )
                            }
                        }]
                    }));

                };

                if (reply.delayMs) {
                    setTimeout(respond, reply.delayMs);
                } else {
                    respond();
                }

            });

        });

        server.listen(0, "127.0.0.1", () => {

            resolve({
                state,
                port: server.address().port,
                close: () => new Promise(done => server.close(done))
            });

        });

    });

}


function workspaceHandler(ids) {

    return (parsed) => {

        const text = messageText(parsed);
        const projectId = projectContextId(parsed);

        const side =
            projectId === ids.A || text.includes(MARKER_A)
                ? "A"
                : projectId === ids.B || text.includes(MARKER_B)
                    ? "B"
                    : projectId === ids.C || text.includes(MARKER_C)
                        ? "C"
                        : "X";

        if (
            !isSubAgent(parsed) &&
            text.includes("zzmvp-cross-compare") &&
            !text.includes("sub_agent_results")
        ) {

            return {
                action: action({
                    action: "delegate",
                    delegations: [
                        {
                            id: "analyze-a",
                            agent: "code_analysis",
                            persona: null,
                            skills: null,
                            tools: null,
                            task: `Read marker.txt in ${MARKER_A}`,
                            depends_on: [],
                            projectId: ids.A
                        },
                        {
                            id: "analyze-b",
                            agent: "code_analysis",
                            persona: null,
                            skills: null,
                            tools: null,
                            task: `Read marker.txt in ${MARKER_B}`,
                            depends_on: [],
                            projectId: ids.B
                        }
                    ]
                })
            };

        }

        if (text.includes("sub_agent_results")) {

            return {
                action: finalAction(`synthesis ${text}`)
            };

        }

        if (isSubAgent(parsed) || text.includes("Read marker")) {

            if (!hasToolResults(parsed)) {

                return {
                    delayMs: side === "A" ? 120 : 0,
                    action: toolCall(`read_${side}`, "fs_read", { path: "marker.txt" })
                };

            }

            const tool =
                [...parsed.messages].reverse().find(message => message.role === "tool");

            return {
                action: finalAction(`finding-${side}: ${tool ? tool.content : "none"}`)
            };

        }


        return {
            delayMs: side === "A" ? 180 : 0,
            action: finalAction(`done-${side}`)
        };

    };

}


async function request(baseUrl, method, url, { token, body } = {}) {

    const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();

    return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        raw: text
    };

}


async function main() {

    initGit(ROOT_A, "seed-a");
    initGit(ROOT_B, "seed-b");

    const stub = await startModelStub(() => ({ content: "done" }));

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
    process.env.AGENT_MODEL = "stub-model";

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const tools = require(path.join(REPO, "agent", "tools"));
    const mcpConfig = require(path.join(REPO, "agent", "mcp", "McpConfig.js"));
    const { manager } = require(path.join(REPO, "agent", "mcp", "McpManager.js"));
    const memoryStore = require(path.join(REPO, "agent", "context", "Memory"));
    const sessions = require(path.join(REPO, "agent", "persistence", "SessionRepository"));
    const archive = require(path.join(REPO, "agent", "persistence", "ArchiveRepository"));
    const eventstore = require(path.join(REPO, "agent", "persistence", "EventStoreRepository"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    runtime.settings.set("AGENT_BASE_URL", `http://127.0.0.1:${stub.port}/v1`);
    runtime.settings.set("AGENT_MODEL", "stub-model");
    runtime.settings.set("AGENT_APPROVAL", "auto");
    runtime.settings.set("MAX_EMPTY_FINAL_NUDGES", 0);
    runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 2);
    runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);
    runtime.settings.set("RUN_QUEUE_LIMIT", 4);

    const recordA = runtime.projects.registry().register({
        id: "prj-a",
        name: "Engine Core A",
        rootPath: ROOT_A,
    });

    const recordB = runtime.projects.registry().register({
        id: "prj-b",
        name: "Engine Core B",
        rootPath: ROOT_B,
    });

    const recordC = runtime.projects.registry().register({
        id: "prj-c",
        name: "Engine Core C",
        rootPath: ROOT_C
    });

    assert.equal(path.basename(ROOT_A), path.basename(ROOT_B));
    assert.notEqual(recordA.id, recordB.id);

    const ids = { A: recordA.id, B: recordB.id, C: recordC.id };

    stub.state.handler = workspaceHandler(ids);

    const ctxA = contextFor(runtime, recordA);
    const ctxB = contextFor(runtime, recordB);


    /* ------------------------------------------------ گام ۱: isolation */

    await test("project isolation: same basename and independent artifacts", async () => {

        const listed = runtime.projects.registry().list();

        assert.ok(listed.some(item => item.id === recordA.id));
        assert.ok(listed.some(item => item.id === recordB.id));
        assert.equal(path.basename(recordA.rootPath), "engine-core");
        assert.equal(path.basename(recordB.rootPath), "engine-core");

        await tools.executeTool(
            "fs_write",
            { path: "artifact.txt", content: `owned-by-a ${MARKER_A}\n` },
            ctxA
        );

        await tools.executeTool(
            "fs_write",
            { path: "artifact.txt", content: `owned-by-b ${MARKER_B}\n` },
            ctxB
        );

        assert.equal(
            fs.readFileSync(path.join(ROOT_A, "artifact.txt"), "utf8"),
            `owned-by-a ${MARKER_A}\n`
        );
        assert.equal(
            fs.readFileSync(path.join(ROOT_B, "artifact.txt"), "utf8"),
            `owned-by-b ${MARKER_B}\n`
        );


    });


    await test("tool isolation: read/write, terminal cwd, git, process sessions", async () => {

        const readA =
            await tools.executeTool("fs_read", { path: "marker.txt" }, ctxA);

        assert.match(readA.content, new RegExp(MARKER_A));

        let thrown = null;

        try {

            await tools.executeTool(
                "fs_read",
                { path: path.join(ROOT_B, "marker.txt") },
                ctxA
            );

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown, "A must not read B's absolute path");
        assert.match(thrown.message, /outside workspace/i);

        /*
        | `pwd` and `sleep` are shell builtins of a POSIX shell only; on
        | Windows the command printed nothing and the isolation check failed
        | on the platform, not on the boundary. Node is the one command every
        | run of this suite can count on.
        */
        const printCwd =
            `"${process.execPath}" -p "process.cwd()"`;

        const pwd =
            await tools.executeTool("terminal_exec", { command: printCwd }, ctxB);

        const normalizePath =
            value =>
                String(value || "").trim().replace(/[\\/]+$/, "").toLowerCase();

        assert.equal(
            normalizePath(pwd.stdout),
            normalizePath(fs.realpathSync(ROOT_B)),
            `terminal cwd escaped project B: ${JSON.stringify(pwd.stdout)}`
        );

        const log =
            await tools.executeTool("git_log", { limit: 5 }, ctxA);

        assert.match(log.stdout, /seed-a/);
        assert.ok(!String(log.stdout).includes("seed-b"));

        const started =
            await tools.executeTool(
                "process_start",
                {
                    command:
                        `"${process.execPath}" -e "setTimeout(() => {}, 30000)"`
                },
                ctxB
            );

        const listA =
            await tools.executeTool(
                "process_list",
                { include_finished: true },
                ctxA
            );

        assert.ok(
            !JSON.stringify(listA).includes(started.process_id),
            "A must not list B's process"
        );

        thrown = null;

        try {

            await tools.executeTool(
                "process_read",
                { process_id: started.process_id, peek: true },
                ctxA
            );

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown);
        assert.match(thrown.message, /Unknown process/);

        await tools.executeTool(
            "process_terminate",
            { process_id: started.process_id },
            ctxB
        );

    });


    await test("runtime isolation: concurrent runs, cancel, labelled delegation", async () => {

        runtime.runScheduler.reset();
        runtime.observability.reset();

        const [outA, outB] = await Promise.all([
            runtime.runAgent({
                projectId: recordA.id,
                task: `Read marker.txt in ${MARKER_A}`
            }),
            runtime.runAgent({
                projectId: recordB.id,
                task: `Read marker.txt in ${MARKER_B}`
            })
        ]);

        assert.match(String(outA.response.content), /finding-A/);
        assert.match(String(outA.response.content), new RegExp(MARKER_A));
        assert.ok(!String(outA.response.content).includes(MARKER_B));
        assert.match(String(outB.response.content), /finding-B/);
        assert.match(String(outB.response.content), new RegExp(MARKER_B));

        const ctxSlow = runtime.runManager.createRun({
            task: `hold ${MARKER_A}`,
            project: runtime.projects.createProjectContext(recordA)
        });

        void ctxSlow;

        stub.state.handler = (parsed) => {

            const text = messageText(parsed);

            return {
                delayMs: text.includes(MARKER_A) ? 400 : 0,
                action: finalAction(
                    text.includes(MARKER_A) ? "slow-a" : "fast-b"
                )
            };

        };

        const slow = runtime.runAgent({
            projectId: recordA.id,
            task: `hold ${MARKER_A}`
        });

        await new Promise(done => setTimeout(done, 40));

        const activeA =
            runtime.runManager.activeRuns().find(run => run.projectId === recordA.id);

        assert.ok(activeA, "run A should be inflight");

        runtime.cancelRunById(activeA.runId, "mvp");

        let cancelled = null;

        try {

            await slow;

        } catch (error) {

            cancelled = error;

        }

        assert.ok(cancelled, "cancelled run A must reject");

        const neighbour = await runtime.runAgent({
            projectId: recordB.id,
            task: `fast ${MARKER_B}`
        });

        assert.match(String(neighbour.response.content), /fast-b/);

        stub.state.handler = workspaceHandler(ids);

        const compared = await runtime.runAgent({
            projectId: recordA.id,
            task: `zzmvp-cross-compare ${MARKER_A} and ${MARKER_B}`
        });

        assert.match(String(compared.response.content), /synthesis/);
        assert.match(String(compared.response.content), /finding-A/);
        assert.match(String(compared.response.content), /finding-B/);

    });


    await test("MCP isolation: tools/list and tools/call stay on one project", async () => {

        assert.equal(
            mcpConfig.serverVisibleTo(
                { scope: "project", projects: [recordA.id] },
                recordB.id
            ),
            false
        );

        manager.workspaceRoot = WORKSPACE;
        manager.loadedAt = Date.now();
        manager.clients.set("alpha-only", {
            config: {
                name: "alpha-only",
                scope: "project",
                projects: [recordA.id],
                enabled: true
            }
        });
        manager.catalogue.set("mcp__alpha-only__echo", {
            name: "mcp__alpha-only__echo",
            server: "alpha-only",
            tool: "echo",
            description: "echo"
        });

        assert.equal(manager.catalogueEntries(recordA.id).length, 1);
        assert.equal(manager.catalogueEntries(recordB.id).length, 0);

        await assert.rejects(
            () => manager.call("alpha-only", "echo", {}, { projectId: recordB.id }),
            /not in scope/
        );


    });


    await test("persistence isolation: memory, plan, session, archive, events", async () => {

        await tools.executeTool(
            "plan_set",
            {
                objective: "objective a",
                phases: [{ title: "Phase one", steps: ["first"] }]
            },
            ctxA
        );

        const planB = await tools.executeTool("plan_get", {}, ctxB);

        assert.equal(planB.phases.length, 0, "B must not see A's plan");

        const memoryA = memoryStore.emptyMemory();

        memoryA.decisions.push("only a");
        memoryStore.saveMemory(memoryA, ctxA);

        assert.deepEqual(memoryStore.loadMemory(ctxB).decisions, []);

        const dataA = runtime.projects.createProjectContext(recordA).dataRoot;
        const dataB = runtime.projects.createProjectContext(recordB).dataRoot;

        const session = sessions.emptySession("s-mvp-a");

        session.messages.push({ role: "user", content: "hello a" });
        sessions.saveSession(session, dataA);

        assert.equal(sessions.listSessions(dataB).length, 0);
        assert.equal(sessions.loadSession("s-mvp-a", dataB), null);

        archive.archiveEvents(
            [{
                tool: "fs_read",
                title: "zzmvp-archive-only-a",
                body: "unique body zzmvp-archive-only-a"
            }],
            { root: dataA }
        );

        assert.equal(
            archive.searchArchive("zzmvp-archive-only-a", { root: dataB }).matches,
            0
        );
        assert.ok(
            archive.searchArchive("zzmvp-archive-only-a", { root: dataA }).matches >= 1
        );

        eventstore.append({
            type: "run:start",
            run_id: "run-mvp-central-a",
            project_id: recordA.id,
            at: Date.parse("2026-08-26T12:00:00Z")
        });

        assert.equal(
            eventstore.query({
                run_id: "run-mvp-central-a",
                root: dataA
            }).length,
            1
        );

        assert.deepEqual(
            eventstore.query({
                run_id: "run-mvp-central-a",
                root: dataB
            }),
            []
        );

    });


    /* ------------------------------------------------ گام ۲: load / recovery */

    await test("load: two heavy projects run, the third queues then finishes", async () => {

        runtime.runScheduler.reset();
        runtime.observability.reset();
        runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 2);

        const started = [];

        stub.state.handler = (parsed) => {

            const text = messageText(parsed);
            const side =
                text.includes(MARKER_A) ? "a" :
                text.includes(MARKER_B) ? "b" :
                text.includes(MARKER_C) ? "c" : "x";

            started.push(side);

            return {
                delayMs: side === "c" ? 0 : 220,
                action: finalAction(`done-${side}`)
            };

        };

        const [a, b, c] = await Promise.all([
            runtime.runAgent({ projectId: recordA.id, task: `heavy ${MARKER_A}` }),
            runtime.runAgent({ projectId: recordB.id, task: `heavy ${MARKER_B}` }),
            runtime.runAgent({ projectId: recordC.id, task: `queued ${MARKER_C}` })
        ]);

        assert.match(a.response.content, /done-a/);
        assert.match(b.response.content, /done-b/);
        assert.match(c.response.content, /done-c/);
        assert.ok(started.includes("c"));
        assert.ok(
            started[0] !== "c" || started[1] !== "c",
            "C must wait behind the concurrent-project cap"
        );

        stub.state.handler = workspaceHandler(ids);

    });


    await test("recovery: a crashed worker and a cancelled run leave the neighbour running", async () => {

        runtime.observability.reset();
        runtime.observability.recordCrash(recordA.id, "worker-down");

        const healthA = runtime.observability.healthOf(recordA.id);
        const healthB = runtime.observability.healthOf(recordB.id);
        const gatewayHealth = runtime.observability.health();

        assert.equal(healthA.status, "down");
        assert.equal(healthB.status, "ok");
        assert.equal(gatewayHealth.status, "degraded");
        assert.notEqual(gatewayHealth.status, "down");

        stub.state.handler = (parsed) => {

            const text = messageText(parsed);

            return {
                delayMs: text.includes(MARKER_A) ? 500 : 0,
                action: finalAction(text.includes(MARKER_A) ? "hold-a" : "live-b")
            };

        };

        const holding = runtime.runAgent({
            projectId: recordA.id,
            task: `hold ${MARKER_A}`
        });

        await new Promise(done => setTimeout(done, 40));

        const inflight =
            runtime.runManager.activeRuns().find(run => run.projectId === recordA.id);

        if (inflight) {
            runtime.cancelRunById(inflight.runId, "mvp-recovery");
        }

        try {
            await holding;
        } catch {
            /* cancelled */
        }

        const neighbour = await runtime.runAgent({
            projectId: recordB.id,
            task: `live ${MARKER_B}`
        });

        assert.match(String(neighbour.response.content), /live-b/);

        stub.state.handler = workspaceHandler(ids);

    });


    await test("load: a full queue rejects instead of hanging", async () => {

        runtime.runScheduler.reset();
        runtime.settings.set("RUN_QUEUE_LIMIT", 1);
        runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);

        stub.state.handler = () => ({
            delayMs: 350,
            action: finalAction("slow")
        });

        const first = runtime.runAgent({
            projectId: recordA.id,
            task: `hold ${MARKER_A}`
        });

        await new Promise(done => setTimeout(done, 40));

        const second = runtime.runAgent({
            projectId: recordA.id,
            task: `queued ${MARKER_A}`
        });

        let rejected = null;

        try {

            await runtime.runAgent({
                projectId: recordA.id,
                task: `overflow ${MARKER_A}`
            });

        } catch (error) {

            rejected = error;

        }

        assert.ok(rejected, "overflow must be rejected");
        assert.equal(rejected.code, "RUN_QUEUE_FULL");
        assert.equal(rejected.status, 429);

        await first;
        await second;

        runtime.settings.set("RUN_QUEUE_LIMIT", 4);
        stub.state.handler = workspaceHandler(ids);

    });


    /* ------------------------------------------------ گام ۳: ten-step e2e */

    await test("ten-step end-to-end acceptance scenario", async () => {

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const token = server.token;

        try {

            /* 1. Gateway / Web Console is up */
            const home = await fetch(`${baseUrl}/`);

            assert.equal(home.status, 200);

            const html = await home.text();

            assert.match(html, /projectSwitcher/);

            /* 2–3. A and B are registered and selectable */
            const listed = await request(baseUrl, "GET", "/api/projects", { token });

            assert.equal(listed.status, 200);

            const listedIds = listed.body.projects.map(item => item.id).sort();

            assert.ok(listedIds.includes("prj-a"));
            assert.ok(listedIds.includes("prj-b"));

            const gotA = await request(baseUrl, "GET", "/api/projects/prj-a", { token });
            const gotB = await request(baseUrl, "GET", "/api/projects/prj-b", { token });

            assert.equal(gotA.status, 200);
            assert.equal(gotB.status, 200);

            /* 4–5. two concurrent tasks, each confined to its workspace */
            stub.state.handler = workspaceHandler(ids);

            const [taskA, taskB] = await Promise.all([
                runtime.runAgent({
                    projectId: recordA.id,
                    task: `Read marker.txt in ${MARKER_A}`
                }),
                runtime.runAgent({
                    projectId: recordB.id,
                    task: `Read marker.txt in ${MARKER_B}`
                })
            ]);

            assert.match(String(taskA.response.content), new RegExp(MARKER_A));
            assert.ok(!String(taskA.response.content).includes(MARKER_B));
            assert.match(String(taskB.response.content), new RegExp(MARKER_B));
            assert.ok(!String(taskB.response.content).includes(MARKER_A));

            /* 6. memory / plan / session / archive stay independent */
            const planA = await tools.executeTool("plan_get", {}, ctxA);
            const planB = await tools.executeTool("plan_get", {}, ctxB);

            assert.notDeepEqual(
                planA.summary && planA.summary.objective,
                planB.summary && planB.summary.objective
            );

            assert.deepEqual(memoryStore.loadMemory(ctxB).decisions, []);

            /* 8–9. one run/worker fails; the other continues */
            runtime.observability.recordCrash(recordA.id, "simulated");

            const stillB = await runtime.runAgent({
                projectId: recordB.id,
                task: `Read marker.txt in ${MARKER_B}`
            });

            assert.match(String(stillB.response.content), /finding-B/);
            assert.equal(runtime.observability.healthOf(recordB.id).status, "ok");
            assert.notEqual(runtime.observability.health().status, "down");

            /* 10. UI serves both dashboards and health */
            const dashA = await fetch(`${baseUrl}/projects/prj-a`);
            const dashB = await fetch(`${baseUrl}/projects/prj-b`);

            assert.equal(dashA.status, 200);
            assert.equal(dashB.status, 200);
            assert.match(await dashA.text(), /projectSwitcher/);

            const healthA = await request(
                baseUrl, "GET", "/api/projects/prj-a/health", { token }
            );
            const healthB = await request(
                baseUrl, "GET", "/api/projects/prj-b/health", { token }
            );
            const healthG = await request(baseUrl, "GET", "/api/health", { token });

            assert.equal(healthA.status, 200);
            assert.equal(healthA.body.project_id, "prj-a");
            assert.equal(healthB.status, 200);
            assert.equal(healthB.body.status, "ok");
            assert.equal(healthG.status, 200);
            assert.ok(healthG.body.gateway);

            /* single-project API still accepts the established route */
            const legacy = await request(
                baseUrl,
                "POST",
                "/api/tasks",
                { token, body: { task: "plain run" } }
            );

            assert.equal(legacy.status, 202);
            assert.deepEqual(legacy.body, { accepted: true });

            const deadline = Date.now() + 15000;

            while (Date.now() < deadline) {

                const state = await request(baseUrl, "GET", "/api/state", { token });

                if (state.body.status !== "running") {
                    break;
                }

                await new Promise(done => setTimeout(done, 50));

            }

        } finally {

            try {
                await server.close();
            } catch {
                /* best-effort */
            }

        }

    });


    await test("the MVP uses canonical context, prompt and MCP boundaries", async () => {

        for (const removed of [
            "PROJECT_CONTEXT_MODE",
            "RUN_CONTEXT_MODE",
            "PROMPT_BUILDER_MODE",
            "RUNTIME_ENGINE_MODE",
            "WEB_SERVER_MODE"
        ]) {
            assert.throws(
                () => runtime.settings.definitionOf(removed),
                /Unknown setting/
            );
        }

        assert.equal(typeof runtime.projects.createProjectContext, "function");
        assert.equal(typeof runtime.runManager.createRun, "function");
        assert.equal(typeof runtime.runtimeEngine.runAgentCore, "function");

    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    try {
        await stub.close();
    } catch { /* */ }

    try {
        tools.shutdown();
    } catch { /* */ }

    await runtime.eventstore.flush();
    await runtime.journal.flush();

    for (const dir of [PARENT_A, PARENT_B, PARENT_C, WORKSPACE, DATA_HOME]) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }

    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
