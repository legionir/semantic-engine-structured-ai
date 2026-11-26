"use strict";

/*
|--------------------------------------------------------------------------
| Project Run Tests — EXECUTION_PLAN Phase 7
|--------------------------------------------------------------------------
|
| End-to-end proof of the MVP chain:
|
|   task → projectId → ProjectContext → AgentRunContext → project prompt
|          → project-scoped tools (→ Semantic Worker of that project, Ph6)
|
| for ONE project per task, over BOTH entry points the phase promises:
|
|   1. CLI:  node bin/agent.js --project <id> "task"
|      (flag validation: unknown project, and a -w that disagrees with
|      the registered root, are clear failures — the root always comes
|      from the registry, never from arguments)
|   2. API:  POST /api/projects/:projectId/tasks
|      (legacy POST /api/tasks untouched; run events carry project_id
|      and run_id, visible via /api/state without breaking its contract)
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "agent.js");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "project-run-ws-"));

const OTHER_ROOT =
    fs.mkdtempSync(path.join(os.tmpdir(), "project-run-other-"));

const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "project-run-data-"));

fs.writeFileSync(path.join(WORKSPACE, "alpha.txt"), "alpha\n");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;

/* Deterministic final-answer runs: no unfinished-final nudges. */
process.env.MAX_EMPTY_FINAL_NUDGES = "0";


const results = [];

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


/* Distinctive marker so prompt constants can never collide with it. */
const MARKER = "zzprojrun7b21e9";


/* A stub OpenAI-compatible endpoint that always answers with a final
   action containing the marker, and remembers every request body — the
   prompt itself is inspected for the project_context message. */
function startModelStub() {

    return new Promise(resolve => {

        const state = { requests: [] };

        const server =

            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => (body += chunk));

                req.on("end", () => {

                    const parsed = JSON.parse(body || "{}");

                    state.requests.push(parsed);

                    res.setHeader("content-type", "application/json");
                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        role: "assistant",
                                        content: JSON.stringify({
                                            version: "1.0",
                                            action: "final",
                                            tool_calls: null,
                                            delegations: null,
                                            response: {
                                                type: "text",
                                                content: MARKER
                                            },
                                            data: null,
                                            error: null
                                        })
                                    }
                                }
                            ]
                        })
                    );

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


function registerProject(id, rootPath) {

    const projects = require(path.join(REPO_ROOT, "agent", "projects", "index.js"));

    return projects.registry().register({
        id,
        name: `Project ${id}`,
        rootPath
    });

}


/* Read every event a run left in the given event store directory.
   Phase 8: a REGISTERED project's events land in its central store
   (<DATA_HOME>/projects/<id>/eventstore); the workspace .agent store
   now only sees legacy (unscoped) runs. */
function readStoredEvents(dir) {

    if (!fs.existsSync(dir)) {
        return [];
    }

    const entries = [];

    for (const file of fs.readdirSync(dir).sort()) {

        if (!file.endsWith(".jsonl")) {
            continue;
        }

        const lines =

            fs.readFileSync(path.join(dir, file), "utf8")
                .split("\n")
                .filter(line => line.trim() !== "");

        for (const line of lines) {

            try {

                entries.push(JSON.parse(line));

            } catch {
                /* a torn final line is not what this assertion reads */
            }

        }

    }

    return entries;

}


function runCli(args, env = {}) {

    return new Promise((resolve, reject) => {

        const child =

            spawn(
                process.execPath,
                [BIN, ...args],
                {
                    env: {
                        ...process.env,
                        WORKSPACE_ROOT: WORKSPACE,
                        STRUCTURED_AI_DATA_HOME: DATA_HOME,
                        MAX_EMPTY_FINAL_NUDGES: "0",
                        AGENT_APPROVAL: "auto",
                        ...env
                    },
                    stdio: ["ignore", "pipe", "pipe"]
                }
            );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => (stdout += chunk));
        child.stderr.on("data", chunk => (stderr += chunk));

        child.on("error", reject);

        child.on("close", code => resolve({ code, stdout, stderr }));

    });

}


let consoleToken = null;

async function postJson(url, payload) {

    const response =

        await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(consoleToken
                    ? { authorization: `Bearer ${consoleToken}` }
                    : {})
            },
            body: JSON.stringify(payload)
        });

    return {
        status: response.status,
        body: await response.json()
    };

}


async function waitForTerminal(baseUrl, timeoutMs = 15000) {

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {

        const response =

            await fetch(`${baseUrl}/api/state`, {
                headers: {
                    ...(consoleToken
                        ? { authorization: `Bearer ${consoleToken}` }
                        : {})
                }
            });

        const state = await response.json();

        if (state.status !== "running") {
            return state;
        }

        await new Promise(done => setTimeout(done, 100));

    }

    throw new Error("the web task never left the running state");

}


async function main() {

    const stub = await startModelStub();

    registerProject("prj-a", WORKSPACE);
    registerProject("prj-other", OTHER_ROOT);

    /* ------------------------------------------------ CLI (گام ۱) --- */

    await test("CLI --project runs the task on the registered project", async () => {

        const before = stub.state.requests.length;

        const outcome =

            await runCli(
                ["--project", "prj-a", "summarize the project"],
                {
                    AGENT_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
                    AGENT_MODEL: "test-model"
                }
            );

          assert.equal(outcome.code, 0, `stderr was: ${outcome.stderr}`);
          assert.ok(
              outcome.stdout.includes(MARKER),
              "the run must reach the stub model and finish with its marker"
          );

        /* the chain reached the prompt: the project_context message was
           built for exactly this project (PROMPT_BUILDER modular comes
           with --project as one bundle) */

        const observed =

            stub.state.requests
                .slice(before)
                .some(request =>
                    (request.messages || []).some(message =>
                        typeof message.content === "string" &&
                        message.content.includes("\"type\":\"project_context\"") &&
                        message.content.includes("\"id\":\"prj-a\"")
                    )
                );

        assert.ok(
            observed,
            "the request sent to the model must carry the prj-a project_context"
        );

        /* the run's events are attributed to the project and run id;
           Phase 8 routes a registered project's events to its central
           store, so that is the store this test reads */

        const stored =

            readStoredEvents(
                path.join(DATA_HOME, "projects", "prj-a", "eventstore")
            );

        assert.ok(
            stored.some(
                event =>
                    event.project_id === "prj-a" &&
                    typeof event.run_id === "string" &&
                    event.run_id.startsWith("run-") &&
                    event.type === "run:start"
            ),
            "the event store must show a prj-a run with its run id"
        );

    });


    await test("CLI --project with an unknown id fails loudly", async () => {

        const outcome =
            await runCli(["--project", "prj-ghost", "x"]);

        assert.notEqual(outcome.code, 0);
        assert.match(outcome.stderr, /Unknown project: prj-ghost/);

    });


    await test("CLI --project with a contradicting -w is refused", async () => {

        const outcome =
            await runCli(
                ["--project", "prj-a", "-w", OTHER_ROOT, "x"]
            );

        assert.notEqual(outcome.code, 0);
        assert.match(outcome.stderr, /does not match/);
        assert.match(outcome.stderr, /registry/);

    });


    /* ------------------------------------------------ API (گام ۲) --- */

    const apiEnv = {
        AGENT_BASE_URL: () => `http://127.0.0.1:${stub.port}/v1`
    };

    for (const [key, value] of Object.entries(apiEnv)) {
        process.env[key] =
            typeof value === "function" ? value() : value;
    }
    process.env.AGENT_MODEL = "test-model";

    const runtime = require(path.join(REPO_ROOT, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO_ROOT, "web", "server.js"));

    const server = createServer(runtime, {});

    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    consoleToken = server.token;


    await test("POST /api/projects/:projectId/tasks runs scoped to that project", async () => {

        const before = stub.state.requests.length;

        const submitted =

            await postJson(
                `${baseUrl}/api/projects/prj-a/tasks`,
                { task: "run on project a" }
            );

        assert.equal(submitted.status, 202);
        assert.equal(submitted.body.accepted, true);
        assert.equal(submitted.body.project_id, "prj-a");

        const state = await waitForTerminal(baseUrl);

        assert.equal(state.status, "done");
        assert.equal(state.answer, MARKER);

        /* run events with project_id + run_id are visible in the
           CURRENT /api/state payload — additive, no contract change */

        const attributed =

            (state.events || []).filter(
                event =>
                    event.project_id === "prj-a" &&
                    typeof event.run_id === "string" &&
                    event.run_id.startsWith("run-")
            );

        assert.ok(
            attributed.length > 0,
            "/api/state events must attribute the run to prj-a"
        );

        /* the prompt carried exactly this project's context */

        const observed =

            stub.state.requests
                .slice(before)
                .some(request =>
                    (request.messages || []).some(message =>
                        typeof message.content === "string" &&
                        message.content.includes("\"type\":\"project_context\"") &&
                        message.content.includes("\"id\":\"prj-a\"")
                    )
                );

        assert.ok(observed, "the API run must prompt with project_context");

    });


    await test("legacy POST /api/tasks keeps working on the default project", async () => {

        const submitted =

            await postJson(
                `${baseUrl}/api/tasks`,
                { task: "plain run" }
            );

        assert.equal(submitted.status, 202);
        assert.deepEqual(submitted.body, { accepted: true });

        const state = await waitForTerminal(baseUrl);

        assert.equal(state.status, "done");
        assert.equal(state.answer, MARKER);

    });


    await test("unknown project on the project route is a 404", async () => {

        const response =

            await postJson(
                `${baseUrl}/api/projects/prj-ghost/tasks`,
                { task: "x" }
            );

        assert.equal(response.status, 404);
        assert.match(response.body.error, /Unknown project/);

    });


    await test("the project route is available without rollout flags", async () => {

        const response =
            await postJson(
                `${baseUrl}/api/projects/prj-a/tasks`,
                { task: "x" }
            );

        assert.equal(response.status, 202);
        assert.equal(response.body.accepted, true);
        assert.equal(response.body.project_id, "prj-a");
        const state = await waitForTerminal(baseUrl);
        assert.equal(state.status, "done");

    });


    await test("task validation mirrors the legacy route", async () => {

        const missing =

            await postJson(
                `${baseUrl}/api/projects/prj-a/tasks`,
                {}
            );

        assert.equal(missing.status, 400);
        assert.equal(missing.body.error, "task is required");

    });


    const failed = results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    try {

        if (server && typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
        }

        if (server && typeof server.close === "function") {
            await Promise.race([
                new Promise(done => server.close(done)),
                new Promise(done => setTimeout(done, 1000))
            ]);
        }

    } catch {
        /* shutdown is best-effort in tests */
    }

    try {

        await runtime.shutdown?.();

    } catch {
        /* idem */
    }

    await stub.close();

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(OTHER_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(DATA_HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed.length === 0 ? 0 : 1);

}

main();
