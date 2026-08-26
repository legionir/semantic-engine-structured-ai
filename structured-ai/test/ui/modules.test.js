"use strict";

/*
|--------------------------------------------------------------------------
| Frontend module boundary — EXECUTION_PLAN Phase 24
|--------------------------------------------------------------------------
|
| ui.test.js keeps the browser-facing compatibility behaviour. This suite
| verifies the native ESM graph, domain module inventory and relative API
| discipline without requiring a browser or a build step.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const APP_DIR = path.join(REPO, "web", "public", "app");
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


function source(name) {
  return fs.readFileSync(path.join(APP_DIR, name), "utf8");
}


async function main() {
  const required = [
    "main.js", "store.js", "api.js", "event-stream.js", "task-runner.js",
    "chat.js", "execution-view.js", "event-view.js", "settings-view.js",
    "mcp-view.js", "history-view.js", "plan-view.js", "modal-manager.js",
    "markdown.js", "direction.js", "dom.js", "formatters.js",
    "project-state.js", "project-view.js", "runtime-state.js", "approval-state.js"
  ];

  await test("the frontend domain module inventory is present", () => {
    required.forEach(name => assert.equal(fs.existsSync(path.join(APP_DIR, name)), true, name));
  });

  await test("index.html loads the native ESM bootstrap after Modal", () => {
    const html = fs.readFileSync(path.join(REPO, "web", "public", "index.html"), "utf8");
    assert.match(html, /<script src="\/modal\.js"><\/script>/);
    assert.match(html, /<script type="module" src="\/app\/main\.js"><\/script>/);
    assert.ok(html.indexOf("/modal.js") < html.indexOf("/app/main.js"));
  });

  await test("main.js imports the explicit domain graph and compatibility renderer", () => {
    const main = source("main.js");
    required.filter(name => name !== "main.js")
      .forEach(name => assert.match(main, new RegExp(`(?:\\./|\\.\\./).*${name.replace(".", "\\.")}`), name));
    assert.match(main, /import "\.\.\/app\.js"/);
    assert.match(main, /globalThis\.StructuredAIApp/);
  });

  await test("native frontend modules pass syntax checking without a bundler", () => {
    const checked = spawnSync(
      process.execPath,
      ["--experimental-default-type=module", "--check", path.join(APP_DIR, "main.js")],
      { encoding: "utf8" }
    );
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  });

  await test("store.js declares isolated domain state and additive event reducers", () => {
    const store = source("store.js");
    [
      "runtimeState", "conversationState", "executionState", "eventState",
      "approvalState", "settingsState", "mcpState", "historyState",
      "planState", "projectState", "approval:request", "approval:resolved"
    ].forEach(value => assert.match(store, new RegExp(value.replace(":", "\\:")), value));
  });

  await test("api.js uses relative URLs and encodes project routes", () => {
    const api = source("api.js");
    assert.doesNotMatch(api, /https?:\/\/(?:127\.0\.0\.1|localhost)/i);
    assert.match(api, /encodeURIComponent\(projectId\)/);
    assert.match(api, /\/api\/projects\//);
    assert.match(api, /export async function request/);
  });

  await test("event-stream.js keeps project filtering in the URL", () => {
    const stream = source("event-stream.js");
    assert.match(stream, /\/api\/events\?projectId=/);
    assert.match(stream, /encodeURIComponent\(projectId\)/);
    assert.match(stream, /source\.onmessage/);
    assert.doesNotMatch(stream, /fetch\("(?:https?:)?\/\//);
  });

  await test("security-sensitive frontend helpers keep safe markdown and direction boundaries", () => {
    assert.match(source("markdown.js"), /textContent/);
    assert.match(source("markdown.js"), /https:\/\/structured-ai\.invalid/);
    assert.match(source("direction.js"), /RTL_TEXT/);
    assert.match(source("dom.js"), /textContent/);
    assert.doesNotMatch(source("api.js"), /innerHTML/);
  });

  const failed = results.filter(item => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
