"use strict";

/*
|--------------------------------------------------------------------------
| Visualizer contract — EXECUTION_PLAN Phase 25
|--------------------------------------------------------------------------
|
| The phase asks for one thing beyond "still works": that the visualizer be
| *independent* of the chat console and of shared UI state. Both halves are
| measured here.
|
| Behaviour first. test/web/visualizer.snapshot.json holds a trace of the real
| client — every element text it wrote, the class on every node and edge, the
| viewport transform after each gesture, the URLs it fetched — recorded from the
| single-file implementation BEFORE the module split, over three data situations
| (a served graph, a failed fetch, an empty one). The trace must still match, and
| it must match from both entries, so the compatibility file cannot be a lie.
|
| Independence second, as structure rather than intent: the graph is closed inside
| web/public/visualizer/, it imports nothing from the console, no module but the
| store declares mutable state, and the client's fetches always carry the project
| the page asked for.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(REPO, "web", "public");
const VIS_DIR = path.join(PUBLIC_DIR, "visualizer");

const SNAPSHOT =
    JSON.parse(fs.readFileSync(path.join(__dirname, "visualizer.snapshot.json"), "utf8"));

const { inventory } = require(path.join(REPO, "tools", "frontend_inventory.js"));

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.message.split("\n")[0]}`);
    }
}

const scenario = path.join(__dirname, "visualizerScenario.js");

function trace(entry, caseName) {

    const out = execFileSync(
        process.execPath,
        [scenario, "--entry", entry, "--case", caseName],
        { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );

    return JSON.parse(out);
}

const moduleFiles = fs.existsSync(VIS_DIR)

    ? fs.readdirSync(VIS_DIR).filter(file => file.endsWith(".js")).sort()

    : [];

const sources = new Map(moduleFiles.map(file => [file, fs.readFileSync(path.join(VIS_DIR, file), "utf8")]));

const allSource = [...sources.values()].join("\n\n");

const clientSources = require("./visualizerHarness.js").clientSources;

const files = clientSources(REPO);

const combined = files.map(file => fs.readFileSync(file, "utf8")).join("\n\n");

function exportsOf(text) {

    const names = new Set();

    for (const match of text.matchAll(/^export (?:async function|function|const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
        names.add(match[1]);
    }

    for (const match of text.matchAll(/^export \{([^}]*)\}/gm)) {

        for (const part of match[1].split(",")) {

            const name = part.trim().split(/\s+as\s+/).pop().trim();

            if (name) names.add(name);
        }
    }

    return names;
}

async function main() {

    console.log(`visualizer contract (${files.length} source file(s), ${Object.keys(SNAPSHOT.cases).length} recorded cases)`);

    /* ------------------------------------------------------------- behaviour */

    for (const caseName of Object.keys(SNAPSHOT.cases)) {

        await test(`the ${caseName} case draws, focuses and zooms exactly as recorded`, () => {

            const entry = require("./visualizerHarness.js").entryFor(REPO);

            const now = trace(entry, caseName);

            assert.deepEqual(
                now,
                SNAPSHOT.cases[caseName],
                `trace drifted for ${caseName} (entry ${path.relative(REPO, entry)})`
            );

            assert.ok(Object.keys(now).length >= 12, "a trace with fewer than 12 steps measures nothing");
        });
    }

    await test("the compatibility entry loads the same client, not a copy of it", () => {

        const bridge = path.join(PUBLIC_DIR, "visualizer.js");

        if (!fs.existsSync(VIS_DIR)) {
            /* before the split the bridge *is* the client; nothing to compare yet */
            return;
        }

        for (const caseName of Object.keys(SNAPSHOT.cases)) {

            assert.deepEqual(
                trace(bridge, caseName),
                SNAPSHOT.cases[caseName],
                `web/public/visualizer.js no longer behaves like the module graph (case ${caseName})`
            );
        }
    });

    await test("the module tree is what the phase declared", () => {

        const declared = [
            "api-client.js",
            "graph-model.js",
            "graph-renderer.js",
            "graph-store.js",
            "layout-client.js",
            "main.js",
            "node-details.js",
            "page.js",
            "search.js",
            "selection-state.js",
            "viewport.js",
            "visualizer-events.js"
        ];

        assert.deepEqual(moduleFiles.slice().sort(), declared);

        assert.match(
            fs.readFileSync(path.join(PUBLIC_DIR, "visualizer.html"), "utf8"),
            /<script type="module" src="\/visualizer\/main\.js"><\/script>/,
            "the page must load the module entry"
        );
    });

    /* ------------------------------------------------------------ the graph */

    await test("every import resolves to a module that exports the name", () => {

        const broken = [];

        for (const [file, text] of sources) {

            for (const match of text.matchAll(/import \{([^}]*)\} from "\.\/([^"]+)"/g)) {

                const [, names, target] = match;

                if (!sources.has(target)) {

                    broken.push(`${file} → ./${target} does not exist`);

                    continue;
                }

                const provided = exportsOf(sources.get(target));

                for (const raw of names.split(",")) {

                    const name = raw.trim();

                    if (name && !provided.has(name)) {
                        broken.push(`${file} imports { ${name} }, ./${target} does not export it`);
                    }
                }
            }
        }

        assert.deepEqual(broken, [], `broken edges:\n${broken.join("\n")}`);
    });

    await test("the graph is closed — and nothing in it belongs to the chat console", () => {

        /*
        | Independence is the phase's subject, so it is asserted as a property of
        | the graph rather than as a comment: one relative specifier form, one
        | directory, and no path into the console's modules or its modal service.
        | "The visualizer is a separate page" is the excuse; a shared import would
        | make it a shared lifetime, and a shared store makes the two pages fail
        | together.
        */

        const outside = [];

        for (const [file, text] of sources) {

            for (const match of text.matchAll(/(?:^|\n)\s*import\s+[^;]*?from\s*["']([^"']+)["']/g)) {

                const spec = match[1];

                if (!spec.startsWith("./") || spec.includes("..")) {

                    outside.push(`${file}: ${spec}`);

                    continue;
                }

                if (/\.\.(\/|\\)/.test(spec)) outside.push(`${file}: ${spec}`);
            }

            for (const forbidden of ["../app/", "../modal.js", "app/store.js", "../visualizer.js"]) {

                if (text.includes(forbidden)) outside.push(`${file}: references ${forbidden}`);
            }
        }

        assert.deepEqual(outside, [], `edges leaving web/public/visualizer/:\n${outside.join("\n")}`);

        const consoleGlobals = /(^|[^.\w$])(Modal|escape|runtimeState|conversationState|executionState|approvalState|settingsState|mcpState|projectState)\b/;

        const touched = [...sources]
            .filter(([, text]) => consoleGlobals.test(stripComments(text)))
            .map(([file]) => file);

        assert.deepEqual(touched, [], `the visualizer reaches for console state: ${touched.join(", ")}`);
    });

    await test("only the store declares page state", () => {

        /*
        | Mutable state that hides in a view is how two views end up disagreeing
        | about which node is selected or which project is loaded. The store owns
        | the one object the trace reads, so a top-level `let`/`var` anywhere else
        | in this directory is the thing this test is for.
        */

        const offenders = [];

        for (const [file, text] of sources) {

            if (file === "graph-store.js") continue;

            const code = stripComments(text);

            for (const match of code.matchAll(/^(?:export\s+)?(let|var)\s+([A-Za-z0-9_$]+)/gm)) {
                offenders.push(`${file}: ${match[1]} ${match[2]}`);
            }
        }

        assert.deepEqual(offenders, [], `mutable module state outside the store:\n${offenders.join("\n")}`);

        const store = sources.get("graph-store.js") || "";

        assert.match(store, /^export const state = \{/m);
        assert.match(store, /^export function setGraphData\(nodes, edges\) \{/m, "the single writer of the graph");
    });

    function stripComments(text) {

        return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    }

    /* ------------------------------------------------------------ the project */

    await test("every request names the project the page asked for — no carry-over", () => {

        /*
        | `projectId` is the only thing that scopes this page, and the leak this
        | guards is the usual one: a module-level default captured at import time
        | and then reused after a "project switch". Each case boots with its own id
        | in a fresh process, so the recorded fetch list is the evidence.
        */

        const expected = { ok: "prj-a", fallback: "prj-b" };

        for (const [caseName, projectId] of Object.entries(expected)) {

            const fetched = SNAPSHOT.cases[caseName].fetchesAfterInit
                .concat(SNAPSHOT.cases[caseName].fetchesAfterModuleTab || []);

            assert.ok(fetched.length >= 2, `case ${caseName} fetched nothing — the scenario is broken`);

            for (const url of fetched) {

                assert.ok(
                    url.includes(`projectId=${projectId}`),
                    `case ${caseName} asked for the wrong project: ${url}`
                );
            }
        }

        /* no project in the URL at all → the client must say `current`, not guess */

        assert.deepEqual(
            SNAPSHOT.cases.empty.fetchesAfterInit,
            ["/api/graph/architecture?projectId=current"],
            "the default project id is the page's fallback, not a stale value"
        );

        /* the empty case replaced rather than merged: 0 nodes, and still 0 after a tab */

        assert.equal(SNAPSHOT.cases.empty.afterInit.nodes.length, 0);
        assert.equal(SNAPSHOT.cases.empty.afterModuleTab.nodes.length, 0);
    });

    await test("a reloaded view replaces the graph instead of appending to it", () => {

        const before = SNAPSHOT.cases.ok.afterInit;
        const after = SNAPSHOT.cases.ok.afterModuleTab;

        assert.equal(before.nodes.length, 5);
        assert.equal(after.nodes.length, 5, "a second load must not double the nodes");
        assert.equal(after.nodeCount, before.nodeCount, "the counter is rewritten, not incremented");
        assert.deepEqual(
            after.nodes.map(node => node.id),
            before.nodes.map(node => node.id),
            "the same fixture graph is drawn again, cleanly"
        );
    });

    /* ------------------------------------------------------- the recorded gaps */

    await test("the layout worker stays unwired until a step decides to wire it", () => {

        /*
        | web/public/workers/layout.worker.js exists and implements a
        | spring-embedder, and nothing in this package instantiates it — no
        | `new Worker` in the visualizer, the console or the server. Recorded in
        | EXECUTION_PLAN as phase-25 work deliberately not done: wiring it would
        | change layout behaviour (the worker seeds with Math.random(), so
        | positions stop being reproducible) in a phase whose criterion is that
        | layout is unchanged. This test fails when someone wires it, which is the
        | moment the trace and this record must be rewritten on purpose.
        */

        assert.doesNotMatch(stripComments(allSource), /new Worker|layout\.worker/,
            "the client instantiates the worker — the recorded gap is closed, so rewrite the layout trace on purpose");
        assert.ok(
            fs.existsSync(path.join(PUBLIC_DIR, "workers", "layout.worker.js")),
            "the worker file itself is still served — the gap is the missing client, not a missing file"
        );
    });

    await test("the two markup sinks are the recorded defect, not an accident", () => {

        /*
        | The inspector's "covering tests" line and each search result are written
        | with innerHTML over values that come from the project index — a symbol or
        | file label is attacker-influenced data in a repo the operator pointed the
        | tool at. It is recorded here, with the exact sites, because fixing it
        | changes rendered markup and belongs in a step that can also add the
        | escaping tests; leaving it unmentioned would let the next reader assume
        | the visualizer is as careful as the console's markdown module, which
        | builds every node with createElement + textContent.
        */

        const sites = [
            ["node-details.js", /inspTests\.innerHTML = `<li>✓ Covered by \$\{node\.label\.toLowerCase\(\)\}\.test\.ts<\/li>`;/],
            ["search.js", /item\.innerHTML = `<span>\$\{node\.label\}<\/span><span class="search-item-kind">\$\{node\.type\}<\/span>`;/]
        ];

        for (const [file, pattern] of sites) {

            assert.match(sources.get(file) || "", pattern, `${file}: the recorded markup sink moved or was changed`);
        }

        /* everything else that takes index data still goes through textContent */

        const otherSinks = [...sources].flatMap(([file, text]) =>

            stripComments(text)
                .split("\n")
                .map(line => line.trim())
                /*
                | `x.innerHTML = ""` clears a container and constant markup like
                | "<li class='muted'>…" interpolates nothing: neither can carry index
                | data. Only an assignment whose value embeds `${…}` is a sink, and
                | only those are counted beyond the two already recorded.
                */
                .filter(line => /\.innerHTML\s*=[^;]*\$\{/.test(line))
                /*
                | The exclusion names the two recorded sinks by their exact markup,
                | not by the variable they assign to: excluding `item.innerHTML`
                | would also forgive a second sink on the same element, which is the
                | one thing this test exists to notice.
                */
                .filter(line => !/^inspTests\.innerHTML = `<li>✓ Covered by /.test(line))
                .filter(line => !/^item\.innerHTML = `<span>\$\{node\.label\}<\/span>/.test(line))
                .map(line => `${file}: ${line}`)
        );

        assert.deepEqual(otherSinks, [], `new markup sinks next to the recorded ones:\n${otherSinks.join("\n")}`);
    });

    /* ------------------------------------------------------------- inventory */

    await test("the recorded inventory is unchanged", () => {

        const now = inventory(combined);

        const differences = Object.entries(SNAPSHOT.inventory)
            .filter(([field, before]) => JSON.stringify(before) !== JSON.stringify(now[field]))
            .map(([field, before]) => `${field}: ${before.length} entries recorded`);

        assert.deepEqual(differences, [], `inventory fields that moved:\n${differences.join("\n")}`);

        assert.equal(now.domIds.length, 31);
        assert.equal(now.stateShape.length, 10);
        assert.equal(now.listeners.length, 17);
    });

    /* ---------------------------------------------------------------- served */

    await test("the server hands every module to the browser as a script", async () => {

        const runtime = require(path.join(REPO, "agent", "agent.js"));
        const { createServer } = require(path.join(REPO, "web", "server.js"));

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const get = urlPath => new Promise((resolve, reject) => {

            http.get(baseUrl + urlPath, { headers: { authorization: `Bearer ${server.token}` } }, response => {

                let body = "";

                response.setEncoding("utf8");
                response.on("data", chunk => { body += chunk; });
                response.on("end", () => resolve({ status: response.statusCode, type: response.headers["content-type"], body }));

            }).on("error", reject);
        });

        try {

            const failures = [];

            for (const file of moduleFiles) {

                const response = await get(`/visualizer/${file}`);

                if (response.status !== 200) failures.push(`/visualizer/${file} → ${response.status}`);
                else if (!String(response.type).includes("javascript")) failures.push(`/visualizer/${file} → ${response.type}`);
                else if (!response.body.trim()) failures.push(`/visualizer/${file} → empty`);
            }

            const page = await get("/visualizer.html");
            const bridge = await get("/visualizer.js");
            const worker = await get("/workers/layout.worker.js");

            assert.match(page.body, /type="module" src="\/visualizer\/main\.js"/);
            assert.equal(bridge.status, 200, "the compatibility entry is still served");
            assert.match(bridge.body, /require\("\.\/visualizer\/main\.js"\)/);
            assert.equal(worker.status, 200, "the orphaned worker is still reachable — it is a missing client, not a missing file");

            assert.deepEqual(failures, [], `modules the browser could not load:\n${failures.join("\n")}`);
        } finally {
            await server.close();
        }
    });

    /* ------------------------------------------------------------------ done */

    const failed = results.filter(entry => !entry.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        console.log("\n" + failed.map(f => `${f.name}\n   ${f.error && f.error.stack}`).join("\n\n"));
    }

    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
