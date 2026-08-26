"use strict";

/*
|--------------------------------------------------------------------------
| Visualizer module boundary — EXECUTION_PLAN Phase 25
|--------------------------------------------------------------------------
|
| The renderer now lives beside the native ESM graph modules. This suite
| verifies pure graph state/model behavior, project URL scoping and
| worker/fallback seams.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const VIS_DIR = path.join(REPO, "web", "public", "visualizer");
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
  return fs.readFileSync(path.join(VIS_DIR, name), "utf8");
}


function runModuleScript(script) {
  return spawnSync(
    process.execPath,
    ["--experimental-default-type=module", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
}


async function main() {
  const required = [
    "main.js", "api-client.js", "graph-store.js", "graph-model.js",
    "graph-renderer.js", "layout-client.js", "selection-state.js",
    "node-details.js", "visualizer-events.js"
  ];

  await test("the visualizer module inventory and worker are present", () => {
    required.forEach(name => assert.equal(fs.existsSync(path.join(VIS_DIR, name)), true, name));
    assert.equal(fs.existsSync(path.join(REPO, "web", "public", "workers", "layout.worker.js")), true);
  });

  await test("visualizer.html loads the native ESM graph and canonical renderer", () => {
    const html = fs.readFileSync(path.join(REPO, "web", "public", "visualizer.html"), "utf8");
    assert.match(html, /<script type="module" src="\/visualizer\/main\.js"><\/script>/);
    assert.doesNotMatch(html, /<script src="\/visualizer\.js"><\/script>/);
    assert.equal(fs.existsSync(path.join(REPO, "web", "public", "visualizer", "renderer.js")), true);
  });

  await test("the visualizer API client scopes and encodes every graph request", () => {
    const api = source("api-client.js");
    assert.match(api, /projectIdFromLocation/);
    assert.match(api, /encodeURIComponent\(view\)/);
    assert.match(api, /params\.set\("projectId", projectId\)/);
    assert.match(api, /seedId/);
    assert.match(api, /symbol/);
    assert.doesNotMatch(api, /https?:\/\/(?:127\.0\.0\.1|localhost)/i);
  });

  await test("graph model focus, provenance filtering and layout remain deterministic", () => {
    const file = path.join(VIS_DIR, "graph-model.js").replace(/\\/g, "\\\\");
    const script = `
      import assert from "node:assert/strict";
      import { visibleEdges, nodesWithinFocus, layoutGrid, searchNodes } from "file://${file}";
      const nodes = [{id:"a",label:"Auth"},{id:"b",label:"Users"},{id:"c",label:"Other"}];
      const edges = [{source:"a",target:"b",metadata:{confidence:90}},{source:"b",target:"c",metadata:{confidence:40}}];
      assert.equal(visibleEdges(edges, true).length, 1);
      assert.deepEqual([...nodesWithinFocus(nodes, edges, "a", 1)].sort(), ["a","b"]);
      assert.equal(Object.keys(layoutGrid(nodes)).length, 3);
      assert.equal(searchNodes(nodes, "aut")[0].id, "a");
    `;
    const result = runModuleScript(script);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  await test("graph store keeps project identity while resetting graph selection", () => {
    const file = path.join(VIS_DIR, "graph-store.js").replace(/\\/g, "\\\\");
    const script = `
      import assert from "node:assert/strict";
      import { createGraphStore } from "file://${file}";
      const store = createGraphStore("project-a");
      store.setGraph([{id:"a"}], []);
      store.select("a");
      assert.equal(store.getState().selectedNodeId, "a");
      store.reset();
      assert.equal(store.getState().projectId, "project-a");
      assert.equal(store.getState().selectedNodeId, null);
      assert.equal(store.getState().nodes.length, 0);
    `;
    const result = runModuleScript(script);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  await test("selection state computes bounded neighborhood focus without mutating graph data", () => {
    const file = path.join(VIS_DIR, "selection-state.js").replace(/\\/g, "\\\\");
    const script = `
      import assert from "node:assert/strict";
      import { SelectionState } from "file://${file}";
      const selection = new SelectionState(2);
      const nodes = [{id:"a"},{id:"b"},{id:"c"},{id:"d"}];
      const edges = [{source:"a",target:"b"},{source:"b",target:"c"},{source:"c",target:"d"}];
      selection.select("a");
      assert.deepEqual([...selection.focusedIds(nodes, edges)].sort(), ["a","b","c"]);
      assert.equal(nodes[0].x, undefined);
      selection.reset();
      assert.equal(selection.selectedNodeId, null);
    `;
    const result = runModuleScript(script);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  await test("layout client has a deterministic fallback and worker failure path", () => {
    const layout = source("layout-client.js");
    assert.match(layout, /layoutGrid/);
    assert.match(layout, /workerUrl = "\/workers\/layout\.worker\.js"/);
    assert.match(layout, /worker\.onerror/);
    assert.match(layout, /worker\.terminate/);
    const worker = fs.readFileSync(path.join(REPO, "web", "public", "workers", "layout.worker.js"), "utf8");
    assert.doesNotMatch(worker, /Math\.random/);
    assert.match(worker, /requestId/);
  });

  await test("renderer and node inspector use safe text boundaries and preserve graph shapes", () => {
    assert.match(source("graph-renderer.js"), /createElementNS/);
    assert.match(source("graph-renderer.js"), /graph-node/);
    assert.match(source("node-details.js"), /textContent/);
    assert.doesNotMatch(source("node-details.js"), /innerHTML/);
    assert.doesNotMatch(source("graph-renderer.js"), /innerHTML/);
  });

  await test("main.js exposes the independent visualizer graph and canonical bootstrap", () => {
    const main = source("main.js");
    required.filter(name => name !== "main.js").forEach(name => {
      assert.match(main, new RegExp(name.replace(".", "\\.")), name);
    });
    assert.match(main, /import "\.\/renderer\.js"/);
    assert.match(main, /StructuredAIVisualizer/);
  });

  const failed = results.filter(item => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
