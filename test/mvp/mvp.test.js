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

    /* the cases live in ./mvp-cases, run in this order */
    const ctx = {
        MARKER_A,
        MARKER_B,
        MARKER_C,
        ROOT_A,
        ROOT_B,
        WORKSPACE,
        archive,
        createServer,
        ctxA,
        ctxB,
        eventstore,
        finalAction,
        ids,
        manager,
        mcpConfig,
        memoryStore,
        messageText,
        recordA,
        recordB,
        recordC,
        request,
        runtime,
        sessions,
        stub,
        test,
        tools,
        workspaceHandler
    };

    await require("./mvp-cases/01-project-isolation-same-basename-and-independent")(ctx);
    await require("./mvp-cases/02-recovery-a-crashed-worker-and-a")(ctx);



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
