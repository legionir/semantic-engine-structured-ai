"use strict";

/*
|--------------------------------------------------------------------------
| Project discussion contract — EXECUTION_PLAN Phase 28
|--------------------------------------------------------------------------
|
| Verifies the intentional Phase 28 product change: discussions retain a
| durable transcript in the active project's data root and project A can
| never list or replay project B's discussion.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "phase28-discussion-ws-"));
const PROJECT_A_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "phase28-discussion-a-"));
const PROJECT_B_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "phase28-discussion-b-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "phase28-discussion-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.SESSIONS_ENABLED = "false";

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


function startModelStub() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        const request = JSON.parse(body || "{}");
        const messages = request.messages || [];
        const observer = String(messages[0]?.content || "").includes("Observer Agent");
        const content = observer
          ? JSON.stringify({
              decision: "FINISH",
              agreements: ["the project transcript is attributable"],
              open_points: [],
              unaddressed: [],
              instructions: {},
              final_report: {
                summary: "The project-scoped discussion completed with an attributable result.",
                agreed_points: ["the project transcript is attributable"],
                unresolved: [],
                next_steps: [{ order: 1, layer: "project", action: "Review the discussion result" }]
              }
            })
          : "A project-local finding from the selected specialist.";
        const payload = JSON.stringify({ choices: [{ message: { role: "assistant", content } }] });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(payload);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}


async function request(base, method, route, token, payload) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "x-console-token": token,
      ...(payload === undefined ? {} : { "content-type": "application/json" })
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}


async function waitFor(fn, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for project discussion");
}


async function main() {
  const stub = await startModelStub();
  process.env.AGENT_BASE_URL = stub.url;
  process.env.AGENT_API_KEY = "phase28-test-key";

  const runtime = require(path.join(ROOT, "agent", "agent"));
  const { createServer } = require(path.join(ROOT, "web", "server"));
  const { TranscriptRepository } = require(path.join(ROOT, "agent", "discussion", "TranscriptRepository"));
  const { DiscussionService, resolveDiscussionContext } = {
    DiscussionService: require(path.join(ROOT, "agent", "discussion", "DiscussionService")).DiscussionService,
    resolveDiscussionContext: require(path.join(ROOT, "agent", "discussion", "DiscussionContext")).resolveDiscussionContext
  };

  const registry = runtime.projects.registry();
  const projectA = registry.register({ id: "phase28-a", name: "Alpha", rootPath: PROJECT_A_ROOT });
  const projectB = registry.register({ id: "phase28-b", name: "Beta", rootPath: PROJECT_B_ROOT });
  const contextA = runtime.projects.createProjectContext(projectA);
  const contextB = runtime.projects.createProjectContext(projectB);
  const repository = new TranscriptRepository();

  await test("TranscriptRepository saves and reloads complete round evidence atomically", async () => {
    const document = repository.save({
      id: "discussion-replay",
      project_id: projectA.id,
      task: "inspect alpha",
      personas: ["security"],
      max_rounds: 1,
      status: "done",
      rounds: [{ round: 1, messages: [{ persona: "security", content: "alpha finding" }] }],
      observer_decisions: [{ round: 1, decision: "FINISH" }],
      final_report: { summary: "alpha", agreed_points: [], unresolved: [], next_steps: [] },
      total_rounds: 1,
      hit_max_rounds: false
    }, contextA.dataRoot);
    const loaded = repository.load(document.id, contextA.dataRoot);
    assert.equal(loaded.project_id, projectA.id);
    assert.equal(loaded.rounds[0].messages[0].content, "alpha finding");
    assert.equal(fs.existsSync(repository.pathFor(document.id, contextA.dataRoot)), true);
  });

  await test("TranscriptRepository isolates lists by data root", async () => {
    repository.save({ id: "only-alpha", project_id: projectA.id, task: "a", rounds: [] }, contextA.dataRoot);
    repository.save({ id: "only-beta", project_id: projectB.id, task: "b", rounds: [] }, contextB.dataRoot);
    assert.ok(repository.list(contextA.dataRoot).some(item => item.id === "only-alpha"));
    assert.ok(!repository.list(contextA.dataRoot).some(item => item.id === "only-beta"));
    assert.ok(repository.list(contextB.dataRoot).some(item => item.id === "only-beta"));
  });

  await test("DiscussionContext ignores forged workspace arguments and uses the runtime project", async () => {
    const scoped = resolveDiscussionContext(runtime, { projectContext: contextA, projectId: projectA.id });
    assert.equal(scoped.projectId, projectA.id);
    assert.equal(scoped.workspaceRoot, PROJECT_A_ROOT);
    assert.equal(scoped.dataRoot, contextA.dataRoot);
    assert.notEqual(scoped.workspaceRoot, "/tmp/forged-workspace");
  });

  const server = createServer(runtime, { token: "phase28-token" });
  const address = await server.listen(0, "127.0.0.1");
  let endpointDiscussionId = null;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    await test("project discussion endpoint accepts a scoped discussion", async () => {
      const result = await request(
        base,
        "POST",
        `/api/projects/${projectA.id}/discussions`,
        "phase28-token",
        { task: "inspect alpha", personas: ["security", "backend"], max_rounds: 1 }
      );
      assert.equal(result.response.status, 202);
      assert.equal(result.body.accepted, true);
      assert.equal(result.body.project_id, projectA.id);
      assert.ok(result.body.id);
      endpointDiscussionId = result.body.id;
    });

    const listedA = await waitFor(async () => {
      const result = await request(base, "GET", `/api/projects/${projectA.id}/discussions`, "phase28-token");
      return result.body.discussions?.find(item => item.id === endpointDiscussionId && item.status === "done") || null;
    });

    await test("project discussion transcript is persisted and replayable through the API", async () => {
      assert.equal(listedA.project_id, projectA.id);
      const result = await request(
        base,
        "GET",
        `/api/projects/${projectA.id}/discussions/${encodeURIComponent(listedA.id)}`,
        "phase28-token"
      );
      assert.equal(result.response.status, 200);
      assert.equal(result.body.discussion.project_id, projectA.id);
      assert.equal(result.body.discussion.rounds.length, 1);
      assert.ok(result.body.discussion.final_report.summary);
    });

    await test("project B cannot see project A's transcript", async () => {
      const listB = await request(base, "GET", `/api/projects/${projectB.id}/discussions`, "phase28-token");
      assert.equal(listB.response.status, 200);
      assert.ok(!listB.body.discussions.some(item => item.id === listedA.id));
      const replayB = await request(
        base,
        "GET",
        `/api/projects/${projectB.id}/discussions/${encodeURIComponent(listedA.id)}`,
        "phase28-token"
      );
      assert.equal(replayB.response.status, 404);
    });

    await test("scoped discussion events carry the owning project id", async () => {
      const state = await request(base, "GET", `/api/projects/${projectA.id}/state`, "phase28-token");
      assert.equal(state.response.status, 200);
      const discussionEvents = state.body.events.filter(event => String(event.type).startsWith("discussion:"));
      assert.ok(discussionEvents.length > 0);
      assert.ok(discussionEvents.every(event => event.project_id === projectA.id));
    });

    await test("a scoped discussion requires project write permission", async () => {
      const denied = await request(
        base,
        "POST",
        `/api/projects/${projectB.id}/discussions`,
        "unknown-token",
        { task: "x", personas: ["security"], max_rounds: 1 }
      );
      assert.equal(denied.response.status, 401);
    });
  } finally {
    await server.close();
    await new Promise(resolve => stub.server.close(resolve));
    await runtime.eventstore.flush();
    await runtime.journal.flush();
    const removeTestDirectory = directory => fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
    removeTestDirectory(WORKSPACE);
    removeTestDirectory(PROJECT_A_ROOT);
    removeTestDirectory(PROJECT_B_ROOT);
    removeTestDirectory(DATA_HOME);
  }

  const failed = results.filter(item => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
