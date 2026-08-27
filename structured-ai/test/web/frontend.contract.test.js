"use strict";

/*
|--------------------------------------------------------------------------
| Frontend module contract — EXECUTION_PLAN Phase 24, step 2
|--------------------------------------------------------------------------
|
| The console has no bundler and no type checker, so nothing normally verifies
| the things a bundler would: that every import points at a file that exists,
| that the name imported is a name exported, that the module graph is closed,
| and that the page actually loads the entry. A typo in any of those is a blank
| page for the operator and a green suite here.
|
| The other half of the job is the inventory `tools/frontend_inventory.js`
| recorded from the monolith before it was split (test/web/frontend.snapshot.json):
| the DOM ids the console reads, the endpoints it fetches, the event names it
| reduces, the classes it draws, the browser APIs it needs, the wiring it binds
| and the shape of its state. Those sets being *equal* after the move is what
| makes "no user-facing behaviour changed" a measurement instead of a promise.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const REPO = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(REPO, "web", "public");
const APP_DIR = path.join(PUBLIC_DIR, "app");

const SNAPSHOT =
    JSON.parse(fs.readFileSync(path.join(__dirname, "frontend.snapshot.json"), "utf8"));

/* the four handler names and eleven slices the split introduces, and nothing else */

const NEW_NAMES = [
    "submitTaskForm", "cancelCurrentRun", "clearConversation", "setAutoContinue",
    "runtimeState", "conversationState", "executionState", "planState", "eventState",
    "approvalState", "settingsState", "mcpState", "historyState", "discussionState",
    "projectState", "state", "Modal"
];

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

const moduleFiles = fs.readdirSync(APP_DIR).filter(file => file.endsWith(".js")).sort();

const sources = new Map(
    moduleFiles.map(file => [file, fs.readFileSync(path.join(APP_DIR, file), "utf8")])
);

const allSource = [...sources.values()].join("\n\n");

/* what each module exports, read off the declaration lines it was written with */

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

    console.log(`frontend module contract (${moduleFiles.length} modules, ${SNAPSHOT.topLevelNames.length} names / ${SNAPSHOT.stateShape.length} state keys recorded)`);

    /* ------------------------------------------------------------ the graph */

    await test("every import points at a module that exists and exports the name", () => {

        const broken = [];

        for (const [file, text] of sources) {

            for (const match of text.matchAll(/import \{([^}]*)\} from "\.\/([^"]+)"/g)) {

                const [, names, target] = match;

                if (!sources.has(target)) {

                    broken.push(`${file} imports from ./${target}, which is not in web/public/app/`);

                    continue;
                }

                const provided = exportsOf(sources.get(target));

                for (const raw of names.split(",")) {

                    const name = raw.trim();

                    if (name && !provided.has(name)) {
                        broken.push(`${file} imports { ${name} } but ./${target} does not export it`);
                    }
                }
            }
        }

        assert.deepEqual(broken, [], `broken edges in the module graph:\n${broken.join("\n")}`);
    });

    await test("the graph is closed: relative specifiers only, nothing to install", async () => {

        /*
        | "No heavy framework" is a requirement, not a preference. A bare specifier
        | would be the first sign of one, and the console would stop working without
        | an install step nobody told it about.
        */

        const bare = [];

        for (const [file, text] of sources) {

            for (const match of text.matchAll(/(?:^|\n)\s*import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g)) {

                if (!match[1].startsWith("./")) bare.push(`${file}: ${match[1]}`);
            }
        }

        assert.deepEqual(bare, [], `specifiers that leave web/public/app:\n${bare.join("\n")}`);

        const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"));

        assert.equal(pkg.type, "module", "the marker is what lets Node load these files as ESM");
    });

    await test("the page loads the module entry, and modal.js before it", () => {

        const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

        assert.match(html, /<script type="module" src="\/app\/main\.js"><\/script>/);
        assert.ok(
            html.indexOf('src="/modal.js"') < html.indexOf('src="/app/main.js"'),
            "modal.js must stay the earlier script: dom.js reads globalThis.Modal when it evaluates"
        );
        assert.doesNotMatch(
            html,
            /<script src="\/app\.js"><\/script>/,
            "the compatibility bridge is not the page's entry any more"
        );
    });

    await test("Modal reaches the modules, which is the one cost of going native", () => {

        const modal = fs.readFileSync(path.join(PUBLIC_DIR, "modal.js"), "utf8");

        assert.match(modal, /globalThis\.Modal = Modal;/);
        assert.match(modal, /module\.exports = Modal;/, "the classic-script and CJS faces are both kept");

        assert.match(sources.get("dom.js"), /const Modal = globalThis\.Modal;/);
        assert.match(sources.get("dom.js"), /export \{ Modal \};/);

        const relying = [...sources].filter(([, text]) => /(^|[^.\w$])Modal\./.test(text)).map(([file]) => file);

        assert.ok(relying.length >= 4, `only ${relying.length} modules use Modal — the scan is off`);

        for (const file of relying) {

            if (file === "dom.js") continue;

            assert.match(
                sources.get(file),
                /import \{[^}]*\bModal\b[^}]*\} from "\.\/dom\.js";/,
                `${file} uses Modal without importing it — in a module that is a ReferenceError, not a global lookup`
            );
        }
    });

    await test("every console function a module calls is one it declares or imports", () => {

        /*
        | A classic script could call anything a sibling defined, because they all
        | shared one global scope. A module cannot: a name that is neither declared
        | nor imported is a ReferenceError the moment that line runs, and the
        | console would break in exactly the path no test happened to click.
        |
        | The check is scoped to the names the console itself defines — every
        | function in the graph — rather than trying to lex arbitrary JavaScript.
        | A hand-rolled lexer would report `parseEnvInput()` (declared inside a
        | function) or swallow a declaration behind an apostrophe in a regex, and a
        | test that cries wolf gets ignored, which is worse than no test.
        */

        const consoleNames = new Set();

        for (const [, text] of sources) {

            for (const match of text.matchAll(/^export (?:async function|function|const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
                consoleNames.add(match[1]);
            }
        }

        assert.ok(consoleNames.size >= 120, `only ${consoleNames.size} exported names — the scan is off`);

        const problems = [];

        for (const [file, raw] of sources) {

            const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ");

            const declared = new Set();

            for (const match of code.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async function|function|const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
                declared.add(match[1]);
            }

            for (const match of code.matchAll(/\b([A-Za-z0-9_$]+)\s*=>/g)) declared.add(match[1]);
            for (const match of code.matchAll(/[{,(]\s*([A-Za-z0-9_$]+)\s*[,)=]/g)) declared.add(match[1]);

            const imported = new Set();

            for (const match of code.matchAll(/^import \{([^}]*)\} from/gm)) {

                for (const part of match[1].split(",")) imported.add(part.trim());
            }

            for (const name of consoleNames) {

                if (declared.has(name) || imported.has(name)) continue;

                const called = new RegExp(`(?:^|[^.\\w$])${name}\\s*\\(`).test(code);

                if (called) {
                    problems.push(`${file} calls ${name}() without importing it from ${moduleDefining(name)}`);
                }
            }
        }

        function moduleDefining(name) {

            for (const [file, text] of sources) {

                if (new RegExp(`^export (?:async function|function|const|let|var)\s+${name}\b`, "m").test(text)) return `./${file}`;
            }

            return "??";
        }

        assert.deepEqual(problems.sort(), [], `calls nothing can resolve:\n${problems.sort().join("\n")}`);
    });

    /* ----------------------------------------------------------- the inventory */

    const FIELD_MEANING = {
        domIds: "an element the console reads or creates",
        apiPaths: "an endpoint it talks to",
        classNames: "a class the stylesheet is written against",
        eventNames: "an event name it recognises",
        eventChecks: "an event the reducer branches on",
        constStrings: "a module-level constant, such as the storage key",
        domApis: "a browser API a shim must implement",
        listeners: "a control wired to a browser event"
    };

    for (const [field, meaning] of Object.entries(FIELD_MEANING)) {

        await test(`the recorded ${field} set is unchanged (${meaning})`, () => {

            /*
            | Same extractor the snapshot was recorded with — the tool is imported,
            | not restated, because a test that re-implements the measurement is a
            | test that can disagree with it and win.
            */

            const after = inventory(allSource);

            const before = SNAPSHOT[field];
            const now = after[field];

            const lost = before.filter(value => !now.includes(value));
            const gained = now.filter(value => !before.includes(value));

            assert.deepEqual(
                lost,
                [],
                `lost ${field} (${meaning}):\n${lost.join("\n")}`
            );

            assert.deepEqual(
                gained,
                [],
                `new ${field} (${meaning}) with no record in the snapshot:\n${gained.join("\n")}`
            );

            assert.equal(now.length, before.length, `${field} changed size: ${before.length} → ${now.length}`);
        });
    }

    await test("every name the monolith defined still exists, and only the declared ones are new", () => {

        const defined = new Set();
        const unexported = [];

        for (const [file, text] of sources) {

            /*
            | Only `export`ed top-level declarations count as a module's surface —
            | and a top-level declaration that is *not* exported would be invisible
            | to the rest of the console, so that case is reported too rather than
            | quietly missing from the graph.
            */

            const lines = text.split("\n");

            /* a name may also leave through `export { X };` on its own line */

            const reexported = new Set();

            for (const match of text.matchAll(/^export \{([^}]*)\}/gm)) {

                for (const part of match[1].split(",")) {

                    const name = part.trim().split(/\s+as\s+/).pop().trim();

                    if (name) reexported.add(name);
                }
            }

            lines.forEach((line, index) => {

                const exported = /^export (?:async function|function|const|let|var)\s+([A-Za-z0-9_$]+)/.exec(line);

                if (exported) {

                    defined.add(exported[1]);

                    return;
                }

                const bare = /^(?:async function|function|const|let|var)\s+([A-Za-z0-9_$]+)/.exec(line);

                if (bare && !/^\s/.test(line) && !reexported.has(bare[1])) unexported.push(`${file}: ${bare[1]}`);
            });
        }

        assert.deepEqual(
            unexported.filter(entry => !entry.includes("main.js")),
            [],
            `a top-level name nothing can import:\n${unexported.join("\n")}`
        );

        const gone = SNAPSHOT.topLevelNames.filter(name => name !== "state" && !defined.has(name));

        assert.deepEqual(gone, [], `names that vanished with the file:\n${gone.join("\n")}`);

        const added = [...defined].filter(name => !SNAPSHOT.topLevelNames.includes(name) && name !== "state").sort();

        assert.deepEqual(
            added.filter(name => !NEW_NAMES.includes(name)),
            [],
            `new top-level names the phase did not declare:\n${added.filter(n => !NEW_NAMES.includes(n)).join("\n")}`
        );

        assert.ok(added.length >= 15, `expected the handlers and slices to be new names, found ${added.length}`);
    });

    /* ---------------------------------------------------------------- state */

    await test("the eleven domain slices reproduce the state literal the monolith held", async () => {

        globalThis.document = { getElementById: () => null };
        globalThis.Modal = { escape: value => String(value) };

        const store = await import(`${pathToFileURL(path.join(APP_DIR, "store.js")).href}`);

        const slices = Object.keys(store).filter(key => key.endsWith("State")).sort();

        assert.deepEqual(slices, [
            "approvalState", "conversationState", "discussionState", "eventState", "executionState",
            "historyState", "mcpState", "planState", "projectState", "runtimeState", "settingsState"
        ], "the domains the phase declared");

        const seen = new Map();

        for (const slice of slices) {

            for (const [key, value] of Object.entries(store[slice])) {

                assert.ok(!seen.has(key), `${key} lives in two slices (${seen.get(key)} and ${slice})`);

                seen.set(key, { slice, value });
            }
        }

        const problems = [];

        for (const entry of SNAPSHOT.stateShape) {

            const found = seen.get(entry.key);

            if (!found) {

                problems.push(`${entry.key}: recorded in the monolith, in no slice now`);

                continue;
            }

            /* the recorded initial value is source text; evaluate it the way the
               browser would, then compare structurally */

            let expected;

            try {
                expected = Function(`"use strict"; return (${entry.value});`)();
            } catch {
                problems.push(`${entry.key}: the recorded value ${entry.value} cannot be evaluated`);
                continue;
            }

            const actual = found.value;

            const same =
                expected instanceof Map ? (actual instanceof Map && actual.size === expected.size && actual.size === 0) :
                expected instanceof Set ? (actual instanceof Set && actual.size === expected.size) :
                Array.isArray(expected) ? (Array.isArray(actual) && actual.length === expected.length) :
                JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);

            if (!same) {
                problems.push(`${entry.key} (${found.slice}): initial value changed — recorded ${JSON.stringify(expected)}, now ${JSON.stringify(actual)}`);
            }
        }

        const invented = [...seen.keys()].filter(key => !SNAPSHOT.stateShape.some(entry => entry.key === key));

        assert.deepEqual(invented, [], `state keys no recorded state held:\n${invented.join("\n")}`);
        assert.deepEqual(problems, [], `the slices do not reproduce the state:\n${problems.join("\n")}`);
    });

    await test("`state` is gone, and nothing reached around the slices", () => {

        const escapes = [...sources]
            .flatMap(([file, text]) => text.split("\n").map(line => ({ file, line })))
            .filter(({ line }) => /(?:^|[^.\w$-])state\s*[.[]/.test(line) && !/-state\.js/.test(line));

        assert.deepEqual(
            escapes.map(entry => `${entry.file}: ${entry.line.trim()}`),
            [],
            "a `state.` reference would be a ReferenceError in the browser:\n" + escapes.map(e => e.line.trim()).join("\n")
        );

        assert.doesNotMatch(allSource, /const state = \{/);
    });

    /* ----------------------------------------------------------------- served */

    await test("every module is served to the browser with a script MIME type", async () => {

        /*
        | A module fetched with the wrong content type is refused by the browser
        | before it is parsed, so the console would be blank with every test here
        | still green. This is the only test that asks the real server.
        */

        const runtime = require(path.join(REPO, "agent", "agent.js"));
        const { createServer } = require(path.join(REPO, "web", "server.js"));

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const fetchText = urlPath => new Promise((resolve, reject) => {

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

                const response = await fetchText(`/app/${file}`);

                if (response.status !== 200) failures.push(`/app/${file} → ${response.status}`);
                else if (!String(response.type).includes("javascript")) failures.push(`/app/${file} → ${response.type}`);
            }

            const page = await fetchText("/");
            const bridge = await fetchText("/app.js");
            const manifest = await fetchText("/app/package.json");

            assert.match(page.body, /type="module" src="\/app\/main\.js"/, "the page the server answers is the module page");
            assert.equal(bridge.status, 200, "the compatibility bridge is still served");
            assert.match(bridge.body, /module\.exports = require\("\.\/app\/main\.js"\);/);

            /*
            | web/public is served whole, so the type marker is reachable over
            | HTTP. It is asserted to be inert rather than hidden: it carries no
            | path, no token, no project name — and if someone puts something there,
            | this is where it gets caught.
            */

            assert.equal(manifest.status, 200);
            assert.deepEqual(
                Object.keys(JSON.parse(manifest.body)).sort(),
                ["//", "type"],
                "the served package.json must stay the two-key marker and nothing else"
            );

            assert.deepEqual(failures, [], `modules the browser could not load:\n${failures.join("\n")}`);
        } finally {
            await server.close();
        }
    });

    await test("main.js only wires: no logic of its own beyond the three starts", () => {

        const main = sources.get("main.js");

        assert.ok(main.includes('el("taskForm").addEventListener("submit", submitTaskForm);'));
        assert.ok(main.includes('el("cancelButton").addEventListener("click", cancelCurrentRun);'));

        for (const call of ["connect();", "loadSettings();", "initProjects();"]) {
            assert.ok(main.includes(call), `main.js must still ${call}`);
        }

        const handlerLines = main.split("\n").filter(line => /^\s*(async )?function /.test(line));

        assert.deepEqual(handlerLines, [], "a handler body in main.js means logic came back to the wiring");
    });

    /* ------------------------------------------------------------------- done */

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
