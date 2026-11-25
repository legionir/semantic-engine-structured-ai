"use strict";

/*
| Reactive console — static invariants of the app modules and the vendored renderer
|
| Runs inside reactive.test.js. It reads the sources only; no console is booted.
*/

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const harness = require("../harness");

const APP = path.join(harness.PUBLIC_DIR, "app");
const VENDOR = path.join(harness.PUBLIC_DIR, "vendor");


module.exports = async function StaticInvariants({ test }) {

    const VIEWS = [
        "chat.js", "execution-view.js", "event-view.js", "plan-view.js",
        "discussion-view.js", "composer-view.js", "approval-state.js",
        "markdown.js", "dom.js", "store.js", "runtime-state.js",
        "execution-model.js", "conversation-model.js", "discussion-model.js"
    ];

    await test("no app module builds markup from strings", () => {
        for (const file of fs.readdirSync(APP).filter(name => name.endsWith(".js"))) {
            const source = fs.readFileSync(path.join(APP, file), "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, "");
            assert.doesNotMatch(
                source,
                /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write/,
                file
            );
        }
        assert.ok(VIEWS.every(file => fs.existsSync(path.join(APP, file))), "the view and model modules exist");
    });

    await test("models and the store do not touch the DOM", () => {
        for (const file of ["store.js", "runtime-state.js", "execution-model.js", "conversation-model.js", "discussion-model.js"]) {
            const source = fs.readFileSync(path.join(APP, file), "utf8");
            assert.doesNotMatch(source, /\bdocument\.|\bwindow\./, file);
        }
    });

    await test("the browser modules import the vendored renderer by relative URL only", () => {
        for (const file of fs.readdirSync(APP).filter(name => name.endsWith(".js"))) {
            const source = fs.readFileSync(path.join(APP, file), "utf8");
            for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
                assert.match(match[1], /^\.{1,2}\//, `${file} imports ${match[1]}`);
            }
        }
    });

    await test("the controller modules import each other without a cycle", () => {
        const edges = new Map();
        for (const file of fs.readdirSync(APP).filter(name => name.endsWith(".js"))) {
            const source = fs.readFileSync(path.join(APP, file), "utf8");
            edges.set(file, [...source.matchAll(/from\s+"\.\/([^"]+)"/g)].map(match => match[1]));
        }
        const done = new Set();
        const visit = (file, trail) => {
            assert.ok(!trail.includes(file), `import cycle: ${[...trail, file].join(" -> ")}`);
            if (done.has(file)) return;
            for (const next of edges.get(file) || []) visit(next, [...trail, file]);
            done.add(file);
        };
        for (const file of edges.keys()) visit(file, []);
    });

    await test("the vendored files are the ones the manifest pins", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(VENDOR, "manifest.json"), "utf8"));
        const entries = Object.entries(manifest.files || {});
        assert.ok(entries.length >= 3, "preact, htm and signals-core are pinned");
        for (const [file, meta] of entries) {
            const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(VENDOR, file))).digest("hex");
            assert.equal(digest, meta.sha256, file);
        }
    });

    await test("every app module stays under the 500-line limit", () => {
        for (const file of fs.readdirSync(APP).filter(name => name.endsWith(".js"))) {
            const lines = fs.readFileSync(path.join(APP, file), "utf8").split("\n").length;
            assert.ok(lines <= 500, `${file} has ${lines} lines`);
        }
    });
};
