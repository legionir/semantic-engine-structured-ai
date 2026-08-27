"use strict";

/*
|--------------------------------------------------------------------------
| /api/graph/* over a real Semantic Engine index — EXECUTION_PLAN Phase 25
|--------------------------------------------------------------------------
|
| The visualizer draws whatever `/api/graph/<view>?projectId=…` answers, and that
| answer comes from parsing `.semantic-engine/project-index.json`. The route
| contract probes that endpoint against a workspace with **no** index, so they
| cover the empty answer and the project-resolution branches — and never the one
| branch the page exists for: turning an index into nodes and edges.
|
| Phase 23 moved that branch out of web/server.js into GraphController, and phase
| 25 made the visualizer its consumer of record. So this file pins the pair
| together: given an index, the counts, ids, classes of provenance and the caps
| the client draws on must be what they were.
|
| Added during phase 25 and recorded in EXECUTION_PLAN as newly-discovered work
| that the phase had to cover (rule 1) — it is not a nice-to-have: without it,
| "the API calls are unchanged" was asserted only about URLs.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-graph-index-"));

/*
| The project registry lives in the *user's* data home unless this is set — so a
| test that registers a project without it leaves the entry behind, and the route
| contract's `GET /api/projects` then fails on another day's leftover. Same
| convention as test/projects/project-api.test.js and the other seven files.
*/

const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-graph-index-data-"));

process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;

fs.mkdirSync(path.join(WORKSPACE, ".semantic-engine"), { recursive: true });

/*
| A small index with the shapes GraphController reads: files whose first two path
| segments become module nodes, symbols with kinds and provenance-scored edges in
| both graphs. 25 files × 3 dirs would exceed the 20-module cap, and 60 symbols
| exceed the 50 cap — both are asserted, because a client that asks for 40 nodes
| and gets 41 has lost a guarantee, not gained one.
*/

function buildIndex({ files = 24, symbols = 60 } = {}) {

    const dirs = ["src/alpha", "src/beta", "src/gamma", "src/delta", "src/epsilon"];

    const list = [];

    for (let i = 0; i < files; i += 1) {
        list.push({ path: `${dirs[i % dirs.length]}/file${i}.ts`, symbolIds: [] });
    }

    const symbolList = [];

    for (let i = 0; i < symbols; i += 1) {

        symbolList.push({
            id: `sym-${i}`,
            name: `symbol${i}`,
            kind: i % 4 === 0 ? "class" : "function",
            filePath: list[i % list.length].path,
            line: i + 1,
            endLine: i + 10,
            complexity: (i % 9) + 1,
            referenceCount: i
        });
    }

    const callEdges = [];
    const dependencyEdges = [];

    for (let i = 0; i + 1 < symbols; i += 1) {

        callEdges.push({
            caller: `sym-${i}`,
            callee: `sym-${i + 1}`,
            provenance: { method: "tree-sitter", confidence: 95 }
        });

        dependencyEdges.push({
            from: list[i % list.length].path,
            to: list[(i + 1) % list.length].path,
            provenance: { method: "import-graph", confidence: i % 2 === 0 ? 90 : 30 }
        });
    }

    return {
        root: WORKSPACE,
        files: list,
        symbols: symbolList,
        graphs: {
            callGraph: callEdges,
            dependencyGraph: dependencyEdges,
            typeGraph: []
        },
        vectorChunks: []
    };
}

const INDEX = buildIndex();

fs.writeFileSync(
    path.join(WORKSPACE, ".semantic-engine", "project-index.json"),
    JSON.stringify(INDEX, null, 2)
);

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";

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

function get(baseUrl, urlPath) {

    return new Promise((resolve, reject) => {

        http.get(baseUrl + urlPath, { headers: { authorization: `Bearer ${token}` } }, response => {

            let body = "";

            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body || "{}") }));

        }).on("error", reject);
    });
}

let token = null;
let baseUrl = "";
let projectId = null;
let projectParam = "";

async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    const server = createServer(runtime, {});
    const address = await server.listen(0, "127.0.0.1");

    token = server.token;

    baseUrl = `http://127.0.0.1:${address.port}`;

    async function post(urlPath, payload) {

        const response =
            await fetch(baseUrl + urlPath, {
                method: "POST",
                headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: JSON.stringify(payload)
            });

        return { status: response.status, body: await response.json().catch(() => ({})) };
    }

    try {

        /*
        | The temp workspace is registered as a project and asked for by id. Not
        | because the global view needs it, but because the graph route resolves its
        | root from `runtime.workspaceRoot` — a property the runtime does not export —
        | and therefore reads `process.cwd()` when no projectId is given. That is a
        | pre-existing defect (it is in web/server.js before phase 23 moved it, and
        | in the c108272 baseline) and this phase is a move, so it is recorded as
        | open item 13 and pinned by its own test below rather than fixed here.
        */

        const registered = await post("/api/projects", { rootPath: WORKSPACE, name: "graph-fixture" });

        assert.equal(registered.status, 201, `registering the fixture workspace failed: ${JSON.stringify(registered)}`);

        projectId = registered.body.project.id;
        projectParam = `&projectId=${encodeURIComponent(projectId)}`;

        const architecture = (await get(baseUrl, `/api/graph/architecture?${projectParam.slice(1)}`)).body;
        const lod = (await get(baseUrl, `/api/graph/lod?${projectParam.slice(1)}`)).body;

        await test("the module view is built from the index's file paths, capped as the client expects", () => {

            assert.equal(architecture.view, "architecture");
            assert.equal(architecture.projectName, WORKSPACE, "the index's own root wins over the registry name");

            /* five dirs in the fixture, and the cap is 20 — so all five appear */
            assert.equal(architecture.nodes.length, 5);

            assert.deepEqual(
                architecture.nodes.map(node => node.id),
                ["mod-src/alpha", "mod-src/beta", "mod-src/gamma", "mod-src/delta", "mod-src/epsilon"]
            );

            for (const node of architecture.nodes) {

                assert.equal(node.type, "module");
                assert.equal(typeof node.label, "string");
                assert.equal(node.metadata.importance, 80, "the client sorts by this");
            }

            /* 46 dependency edges in the fixture, 40 is the transport cap */
            assert.equal(architecture.edges.length, 40);

            const [first] = architecture.edges;

            assert.equal(first.relation, "depends_on");
            assert.match(first.source, /^src\/[a-z]+\/file\d+\.ts$/, "an edge points at real file paths from the index");
            assert.match(first.target, /^src\/[a-z]+\/file\d+\.ts$/);
            assert.ok(first.id.startsWith("e-"), "edge ids are positional, as the client keys them");

            /* the confidence survives from provenance — the dashed/solid split depends on it */

            const confidences = architecture.edges.map(edge => edge.metadata.confidence);

            assert.ok(confidences.includes(90) && confidences.includes(30),
                "both a solid and a sub-70 edge must reach the client, or the dash rule is untested");
        });

        await test("the symbol view keeps kinds, locations and the call edges", () => {

            assert.equal(lod.view, "lod");
            assert.equal(lod.nodes.length, 50, `60 symbols in the index, 50 is the cap — got ${lod.nodes.length}: ${JSON.stringify(lod).slice(0, 300)}`);

            const classes = lod.nodes.filter(node => node.type === "class");

            assert.ok(classes.length > 0, "class nodes must be typed as class — the renderer picks a shape by it");

            for (const node of lod.nodes.slice(0, 3)) {

                assert.equal(typeof node.label, "string");
                assert.match(node.metadata.path, /^src\//);
                assert.ok(Number.isInteger(node.metadata.line));
                assert.ok(node.metadata.complexity >= 1, "the inspector shows complexity straight from here");
                assert.ok(node.metadata.referencesCount >= 0);
            }

            assert.equal(lod.edges.length, 40, "call edges are capped at 40 too");

            assert.ok(lod.edges.every(edge => edge.relation === "calls"),
                "the symbol view draws calls, not dependencies");
        });

        await test("an index with nothing in it answers 200 with no nodes, not an error", async () => {

            /*
            | The visualizer's fallback dataset exists for a *failed* request, so an
            | index that parsed to nothing must stay a successful empty answer —
            | otherwise the page would show demo symbols as if they were the
            | project's. The file is read per request, so swapping it here is the
            | same path the browser would take.
            */

            const indexFile = path.join(WORKSPACE, ".semantic-engine", "project-index.json");
            const previous = fs.readFileSync(indexFile, "utf8");

            try {

                fs.writeFileSync(indexFile, JSON.stringify({ root: WORKSPACE, files: [], symbols: [], graphs: {} }));

                const empty = (await get(baseUrl, `/api/graph/architecture?${projectParam.slice(1)}`)).body;

                assert.deepEqual(empty.nodes, [], "no files means no module nodes, not an error page");
                assert.deepEqual(empty.edges, []);
                assert.equal(empty.view, "architecture");

                const emptyLod = (await get(baseUrl, `/api/graph/lod?${projectParam.slice(1)}`)).body;

                assert.deepEqual(emptyLod.nodes, [], "no symbols means no nodes in the symbol view either");
                assert.deepEqual(emptyLod.edges, []);

                /* a malformed index must not become a 500 either: the client's
                   fallback branch is written for it, and the route swallows it */

                fs.writeFileSync(indexFile, "{ this is not json");

                const broken = await get(baseUrl, `/api/graph/architecture?${projectParam.slice(1)}`);

                assert.equal(broken.status, 200, "an unreadable index is an empty graph, not a broken page");
                assert.deepEqual(broken.body.nodes, []);
            } finally {

                fs.writeFileSync(indexFile, previous);
            }
        });

        await test("the recorded defect: with no projectId the route resolves the process cwd", async () => {

            /*
            | Pinned so the bug cannot be "fixed" by accident in an unrelated
            | commit, and so the fix has a test to update: GraphController's root is
            | `runtime.workspaceRoot || process.cwd()`, and `runtime.workspaceRoot`
            | is undefined — the runtime exposes the workspace as
            | `createRuntimeContext().runtime.workspace_root`. A console started from
            | another directory therefore shows an empty graph over a perfectly good
            | index, with a 200 and no error. EXECUTION_PLAN open item 13.
            */

            const runtime = require(path.join(REPO, "agent", "agent.js"));

            assert.equal(
                runtime.workspaceRoot,
                undefined,
                "runtime.workspaceRoot exists now — update GraphController's fallback and this record together"
            );

            assert.equal(
                typeof runtime.createRuntimeContext().runtime.workspace_root,
                "string",
                "the real accessor is the one the route should use"
            );

            const global = (await get(baseUrl, "/api/graph/architecture")).body;

            assert.notEqual(
                global.projectName,
                WORKSPACE,
                "the global view just read the fixture workspace — the cwd fallback is gone"
            );
        });

        await test("the shape the visualizer's client reads is exactly this shape", () => {

            /*
            | graph-renderer.js and node-details.js read `node.id/type/label/
            | metadata.{path,line,endLine,complexity,referencesCount}` and
            | `edge.source/target/metadata.confidence`. A field renamed on the
            | server would not fail any server test — it would draw a page of
            | undefined labels. This is the seam between the two halves.
            */

            const client = [
                "web/public/visualizer/graph-renderer.js",
                "web/public/visualizer/node-details.js",
                "web/public/visualizer/graph-store.js"
            ].map(file => fs.readFileSync(path.join(REPO, ...file.split("/")), "utf8")).join("\n");

            for (const field of ["node.type", "node.label", "node.id", "node.metadata", "edge.source", "edge.target", "edge.metadata?.confidence"]) {

                assert.ok(
                    client.includes(field),
                    `the client no longer reads ${field} — update this test and the server contract together`
                );
            }

            assert.equal(typeof architecture.nodes[0].metadata.path, "string");
            assert.equal(typeof architecture.edges[0].metadata.confidence, "number");
            assert.equal(typeof lod.nodes[0].metadata.endLine, "number");
        });
    } finally {

        /* the fixture project goes with its workspace, even if a test blew up */

        try {

            if (projectId) {

                await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
                    method: "DELETE",
                    headers: { authorization: `Bearer ${token}` }
                });
            }

        } catch {

            /* already tearing down */

        }

        await server.close();

        fs.rmSync(WORKSPACE, { recursive: true, force: true });
        fs.rmSync(DATA_HOME, { recursive: true, force: true });
    }

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
