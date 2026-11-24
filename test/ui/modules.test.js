"use strict";

/*
|--------------------------------------------------------------------------
| Frontend module boundary — EXECUTION_PLAN Phase 24
|--------------------------------------------------------------------------
|
| ui.test.js keeps the browser-facing renderer behaviour. This suite
| verifies the native ESM graph, domain module inventory and relative API
| discipline without requiring a browser or a build step.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
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


function idsRead(text) {

  return new Set(
    [...text.matchAll(/(?:\bel\(|getElementById\()"([A-Za-z0-9_-]+)"/g)].map(m => m[1])
  );
}


function idsDeclaredTextually(text) {

  return new Set([
    ...[...text.matchAll(/\.id = "([A-Za-z0-9_-]+)"/g)].map(m => m[1]),
    ...[...text.matchAll(/setAttribute\("id", "([A-Za-z0-9_-]+)"\)/g)].map(m => m[1]),
    ...[...text.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1])
  ]);
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

  await test("main.js imports the explicit domain graph and canonical renderer", () => {
    const main = source("main.js");
    required.filter(name => name !== "main.js")
      .forEach(name => assert.match(main, new RegExp(`(?:\\./|\\.\\./).*${name.replace(".", "\\.")}`), name));
    assert.match(main, /import "\.\/console\.js"/);
    assert.match(main, /globalThis\.StructuredAIApp/);
  });

  await test("native frontend modules pass syntax checking without a bundler", () => {
    /*
    | `node --check` reads a .js file as CommonJS, and the flag that used to
    | change that default is gone from the Node that runs this app: the test
    | was failing on the option, never on the module. A .mjs copy means the
    | same thing on every version, so the check is a check again.
    */
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ui-syntax-"));

    try {
      for (const name of required) {

        const target = path.join(scratch, name.replace(/\.js$/, ".mjs"));

        fs.copyFileSync(path.join(APP_DIR, name), target);

        const checked = spawnSync(
          process.execPath,
          ["--check", target],
          { encoding: "utf8" }
        );

        assert.equal(
          checked.status,
          0,
          `${name}: ${(checked.stderr || checked.stdout || "").trim()}`
        );
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  await test("a page declares every id its script reads back", () => {

    /*
    | The console reaches the DOM almost entirely by id, and index.html is
    | redesigned on its own. This is the contract that survives both edits:
    | no id read by a script may vanish from the page it runs on, and no id
    | may be declared twice, because then getElementById picks arbitrarily.
    */
    for (const [script, page] of [
      [path.join("app", "console.js"), "index.html"],
    ]) {

      const text = fs.readFileSync(path.join(REPO, "web", "public", script), "utf8");
      const html = fs.readFileSync(path.join(REPO, "web", "public", page), "utf8");
      const declared = idsDeclaredTextually(html);
      const built = idsDeclaredTextually(text);

      const missing =
        [...idsRead(text)].filter(id => !declared.has(id) && !built.has(id));

      assert.deepEqual(
        missing,
        [],
        `${script} reads ids ${page} does not declare: ${missing.join(", ")}`
      );
    }
  });

  await test("neither page declares an id twice", () => {

    for (const page of ["index.html"]) {

      const html = fs.readFileSync(path.join(REPO, "web", "public", page), "utf8");
      const seen = new Map();

      for (const id of [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])) {
        seen.set(id, (seen.get(id) || 0) + 1);
      }

      assert.deepEqual(
        [...seen].filter(([, count]) => count > 1).map(([id]) => id),
        [],
        `${page} declares these ids more than once`
      );
    }
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
