"use strict";

/*
|--------------------------------------------------------------------------
| Reactive console: invariants and regressions
|--------------------------------------------------------------------------
|
| The console renders from a store through Preact views. These tests pin
| what that rewrite promised: views never build HTML from strings, the
| vendored renderer is the one the manifest names, redraws keep what the
| operator did (folded cards, scroll, a dismissed modal), a replayed
| snapshot neither re-triggers side effects nor costs a redraw per event,
| and every action that can fail says so.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const harness = require("./harness");

const APP = path.join(harness.PUBLIC_DIR, "app");
const VENDOR = path.join(harness.PUBLIC_DIR, "vendor");

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
        if (process.env.UI_TRACE) console.log(error.stack);
    }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

const browser = harness.createWindow();
harness.installGlobals(browser);

const Modal = require(path.join(harness.PUBLIC_DIR, "modal.js"));

const byId = id => document.getElementById(id);
const backdrops = () =>
    [...document.body.children].filter(child => child.classList.contains("modal-backdrop"));

const errorBubbles = () =>
    [...byId("chat").querySelectorAll(".bubble")].filter(bubble => bubble.className.includes("error"));


async function staticChecks() {

    console.log("static invariants");

    const VIEWS = [
        "chat.js", "execution-view.js", "event-view.js", "plan-view.js",
        "discussion-view.js", "composer-view.js", "approval-state.js",
        "markdown.js", "dom.js", "store.js", "runtime-state.js",
        "execution-model.js", "conversation-model.js", "discussion-model.js"
    ];

    await test("views and models never build markup from strings", () => {
        for (const file of VIEWS) {
            const source = fs.readFileSync(path.join(APP, file), "utf8");
            assert.doesNotMatch(
                source,
                /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write/,
                file
            );
        }
    });

    await test("models and the store do not touch the DOM", () => {
        for (const file of ["store.js", "runtime-state.js", "execution-model.js", "conversation-model.js", "discussion-model.js"]) {
            const source = fs.readFileSync(path.join(APP, file), "utf8");
            assert.doesNotMatch(source, /\bdocument\.|\bwindow\./, file);
        }
    });

    await test("the console controller writes markup only to clear a container", () => {
        const source = fs.readFileSync(path.join(APP, "console.js"), "utf8");
        const writes = [...source.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(match => match[1].trim());
        assert.deepEqual([...new Set(writes)].filter(value => value !== '""'), [], "only innerHTML = \"\" is allowed");
    });

    await test("the browser modules import the vendored renderer by relative URL only", () => {
        for (const file of fs.readdirSync(APP).filter(name => name.endsWith(".js"))) {
            const source = fs.readFileSync(path.join(APP, file), "utf8");
            for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
                assert.match(match[1], /^\.{1,2}\//, `${file} imports ${match[1]}`);
            }
        }
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

    await test("every app module stays under the 500-line limit except the legacy controller", () => {
        for (const file of fs.readdirSync(APP).filter(name => name.endsWith(".js") && name !== "console.js")) {
            const lines = fs.readFileSync(path.join(APP, file), "utf8").split("\n").length;
            assert.ok(lines <= 500, `${file} has ${lines} lines`);
        }
    });
}


async function behaviour() {

    console.log("\nreactive behaviour");

    const console_ = await harness.bootConsole({
        Modal,
        defaults: url =>
            url === "/api/settings" ? { settings: [] }
                : url === "/api/state" ? { turns: 1 }
                    : url === "/api/sessions" ? { current: "s-1", sessions: [] }
                        : url === "/api/projects" ? { projects: [] }
                            : {}
    });

    await settle();

    const requests = pattern => console_.posted.filter(item => pattern.test(item.url));

    await test("a view that throws shows a notice in its panel and the others keep drawing", async () => {
        const { pathToFileURL } = require("url");
        const dom = await import(pathToFileURL(path.join(APP, "dom.js")).href);
        const store = await import(pathToFileURL(path.join(APP, "store.js")).href);
        const broken = document.createElement("div");
        const healthy = document.createElement("div");
        let fail = true;
        let draws = 0;
        const quiet = console.error;
        console.error = () => {};
        try {
            const stopBroken = dom.mount(broken, () => {
                if (fail) throw new Error("bad event");
                return dom.html`<p class="ok">fine again</p>`;
            }, ["history"]);
            const stopHealthy = dom.mount(healthy, () => dom.html`<span>${++draws}</span>`, ["history"]);
            assert.ok(broken.querySelector(".view-error"), "the broken panel says so");
            assert.equal(healthy.textContent, "1");
            store.touch("history");
            assert.equal(healthy.textContent, "2", "the other panel keeps drawing");
            fail = false;
            store.touch("history");
            assert.ok(broken.querySelector(".ok"), "the next good render replaces the notice");
            stopBroken();
            stopHealthy();
        } finally {
            console.error = quiet;
        }
    });

    await test("a discussion reads the same watched live or reopened from storage", async () => {
        const { pathToFileURL } = require("url");
        const load = file => import(pathToFileURL(path.join(APP, file)).href);
        const [dom, store, model, view] = await Promise.all([
            load("dom.js"), load("store.js"), load("discussion-model.js"), load("discussion-view.js")
        ]);

        const live = store.createState();
        const events = [
            { type: "discussion:start", id: "d1", task: "pick a db", personas: ["a", "b"], max_rounds: 3 },
            { type: "discussion:message", round: 1, persona: "a", persona_name: "Alice", content: "postgres" },
            { type: "discussion:message", round: 1, persona: "b", persona_name: "Bob", content: "sqlite" },
            { type: "discussion:observer", round: 1, decision: "CONTINUE", open_points: [{ topic: "no agreement", disagreeing: [] }] },
            { type: "discussion:message", round: 2, persona: "a", persona_name: "Alice", content: "postgres, with reasons" },
            { type: "discussion:observer", round: 2, decision: "FINISH", open_points: [] },
            { type: "discussion:finish", total_rounds: 2, hit_max_rounds: false,
                final_report: { summary: "use postgres", agreed_points: ["postgres"], unresolved: [], next_steps: [{ order: 1, layer: "L1", action: "migrate" }] } }
        ];
        for (const event of events) model.reduceDiscussion(live, event);

        /* the stored form lists decisions before rounds; the reading order must not follow it */
        const stored = store.createState();
        stored.discussion = {
            id: "d1", status: "done", task: "pick a db", personas: ["a", "b"], max_rounds: 3,
            total_rounds: 2, hit_max_rounds: false,
            observer_decisions: [
                { round: 1, decision: "CONTINUE", open_points: [{ topic: "no agreement", disagreeing: [] }] },
                { round: 2, decision: "FINISH", open_points: [] }
            ],
            rounds: [
                { round: 2, messages: [{ persona: "a", persona_name: "Alice", content: "postgres, with reasons", round: 2 }] },
                { round: 1, messages: [
                    { persona: "a", persona_name: "Alice", content: "postgres", round: 1 },
                    { persona: "b", persona_name: "Bob", content: "sqlite", round: 1 }
                ] }
            ],
            final_report: { summary: "use postgres", agreed_points: ["postgres"], unresolved: [], next_steps: [{ order: 1, layer: "L1", action: "migrate" }] }
        };

        const draw = state => {
            const container = document.createElement("div");
            dom.render(dom.h(view.Discussion, { state }), container);
            return container.textContent.replace(/\s+/g, " ").trim();
        };

        const watched = draw(live);
        assert.equal(draw(stored), watched);
        assert.ok(watched.indexOf("sqlite") < watched.indexOf("no agreement"), "a round's messages come before its decision");
        assert.ok(watched.indexOf("no agreement") < watched.indexOf("with reasons"), "and the decision before the next round");
        assert.match(watched, /use postgres/);
    });

    await test("a snapshot of 500 events is drawn once and quickly", async () => {
        const events = [];
        events.push({ type: "run:start", task: "big" });
        events.push({ type: "agent:start", agent: "main_agent", depth: 0 });
        for (let i = 0; i < 249; i++) {
            const call = { agent: "main_agent", graph_id: "g", iteration: 1, id: `c${i}`, name: "fs_read", wave: 0, call_key: `main_agent|g|c${i}` };
            events.push({ type: "tool:start", ...call, depends_on: [], arguments_preview: "{}" });
            events.push({ type: "tool:end", ...call, success: true, duration_ms: 3, result_preview: "{}" });
        }
        const started = performance.now();
        console_.snapshot({ status: "idle", turns: 3, messages: [], events, approvals: [] });
        const elapsed = performance.now() - started;
        assert.ok(byId("tree").querySelectorAll("button.tool").length >= 249, "every call is drawn");
        /* the old renderer redrew the tree per event; the budget is far above
           one render and far below 500 of them */
        if (process.env.UI_PERF) console.log(`       500-event snapshot: ${elapsed.toFixed(1)} ms`);
        assert.ok(elapsed < 1500, `took ${elapsed.toFixed(0)} ms`);
    });

    await test("a reconnect's snapshot replaces the conversation instead of adding to it", async () => {
        const messages = [
            { role: "user", kind: "message", content: "hello", at: 1 },
            { role: "assistant", kind: "response", content: "hi there", at: 2 }
        ];
        const snapshot = { status: "idle", turns: 1, messages, events: [{ type: "session:message", message: messages[0] }] };
        console_.snapshot(snapshot);
        const first = byId("chat").querySelectorAll(".bubble").length;
        const firstBubble = byId("chat").querySelector(".bubble");
        assert.equal(first, 2, "session:message replay does not double the bubbles");
        console_.snapshot(snapshot);
        assert.equal(byId("chat").querySelectorAll(".bubble").length, 2, "the same snapshot again changes nothing");
        assert.equal(byId("chat").querySelector(".bubble"), firstBubble, "and keeps the same nodes");
    });

    await test("a replayed snapshot does not re-run what its events once asked for", async () => {
        const settingsBefore = requests(/^\/api\/settings$/).length;
        const sessionsBefore = requests(/\/api\/sessions\//).length;
        console_.snapshot({
            status: "idle",
            turns: 1,
            messages: [],
            events: [
                { type: "settings:changed" },
                { type: "session:switched", session: { id: "s-other", title: "x" } }
            ]
        });
        await settle();
        assert.equal(requests(/^\/api\/settings$/).length, settingsBefore, "settings are not reloaded");
        assert.equal(requests(/\/api\/sessions\//).length, sessionsBefore, "no session is loaded");
    });

    await test("a plan phase the operator folded stays folded while the plan updates", async () => {
        const plan = done => ({
            exists: true, objective: "o", steps: 2, done, blocked: 0,
            phases: [{ id: "P1", title: "Core", status: "in_progress", steps: [{ id: "P1.1", title: "a", status: done ? "done" : "pending" }] }]
        });
        console_.send({ type: "plan:update", plan: plan(0) });
        const phase = byId("plan").querySelector("details.plan-phase");
        assert.equal(phase.open, true, "an in-progress phase starts open");
        phase.open = false;
        console_.send({ type: "plan:update", plan: plan(1) });
        const after = byId("plan").querySelector("details.plan-phase");
        assert.equal(after, phase, "the same element is kept");
        assert.equal(after.open, false, "and it stays the way the operator left it");
        assert.match(after.textContent, /done/);
    });

    await test("a thinking bubble the operator closed stays closed as the chat grows", async () => {
        console_.send({ type: "session:message", message: { role: "assistant", kind: "thinking", agent: "main_agent", content: "pondering", at: Date.now() } });
        const thinking = [...byId("chat").querySelectorAll(".bubble details")].at(-1);
        thinking.open = false;
        console_.send({ type: "session:message", message: { role: "assistant", kind: "response", content: "done", at: Date.now() } });
        assert.equal(thinking.isConnected, true, "the bubble is not rebuilt");
        assert.equal(thinking.open, false);
    });

    await test("the chat follows new messages only when it is already at the bottom", async () => {
        const chat = byId("chat");
        Object.defineProperty(chat, "scrollHeight", { configurable: true, get: () => 5000 });
        Object.defineProperty(chat, "clientHeight", { configurable: true, get: () => 400 });
        chat.scrollTop = 1000;
        console_.send({ type: "session:message", message: { role: "assistant", kind: "response", content: "while reading above", at: Date.now() } });
        assert.equal(chat.scrollTop, 1000, "reading position is kept");
        chat.scrollTop = 4600;
        console_.send({ type: "session:message", message: { role: "assistant", kind: "response", content: "at the bottom", at: Date.now() } });
        assert.equal(chat.scrollTop, 5000, "the newest message is followed");
        delete chat.scrollHeight;
        delete chat.clientHeight;
    });

    await test("clearing the events panel clears its rows, not just the screen", async () => {
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 1 });
        assert.ok(byId("log").children.length > 0);
        byId("clearLog").dispatch("click");
        assert.equal(byId("log").children.length, 0);
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 2 });
        assert.equal(byId("log").children.length, 1, "old rows do not come back with the next event");
    });

    await test("a failed task submit is reported and the composer is usable again", async () => {
        console_.send({ type: "run:status", status: "idle" });
        const before = errorBubbles().length;
        console_.reply("/api/tasks", { __status: 500, body: { error: "runtime offline" } });
        byId("task").value = "will fail";
        byId("taskForm").dispatch("submit");
        await settle();
        assert.equal(errorBubbles().length, before + 1);
        assert.match(errorBubbles().at(-1).textContent, /runtime offline/);
        assert.equal(byId("runButton").disabled, false);
        assert.equal(byId("task").value, "will fail", "the task text is kept to retry");
    });

    await test("a task that cannot reach the server is reported too", async () => {
        const before = errorBubbles().length;
        console_.reply("/api/tasks", new Error("connection refused"));
        byId("task").value = "offline";
        byId("taskForm").dispatch("submit");
        await settle();
        assert.equal(errorBubbles().length, before + 1);
        assert.match(errorBubbles().at(-1).textContent, /connection refused/);
        assert.equal(byId("runButton").disabled, false);
        console_.reply("/api/tasks", { accepted: true });
    });

    await test("approval mode goes back when the server refuses the change", async () => {
        console_.snapshot({ status: "idle", turns: 1, messages: [], events: [], approval_mode: "prompt" });
        const select = byId("approvalMode");
        assert.equal(select.value, "prompt");
        console_.reply("/api/approval-mode", { __status: 403, body: { error: "forbidden" } });
        select.value = "auto";
        select.dispatch("change");
        await settle();
        assert.equal(select.value, "prompt");
        assert.match(errorBubbles().at(-1).textContent, /Approval mode was not changed: forbidden/);
        console_.reply("/api/approval-mode", { ok: true });
    });

    await test("clearing the conversation reports a failure", async () => {
        const before = errorBubbles().length;
        console_.reply("/api/clear", { __status: 500, body: { error: "disk full" } });
        byId("clearButton").dispatch("click");
        await settle();
        assert.equal(errorBubbles().length, before + 1);
        assert.match(errorBubbles().at(-1).textContent, /disk full/);
        console_.reply("/api/clear", { cleared: true });
    });

    await test("auto-continue goes back when the server refuses the change", async () => {
        const box = byId("autoContinue");
        const before = box.checked;
        console_.reply("POST /api/settings", { __status: 400, body: { error: "fixed at startup" } });
        box.checked = !before;
        box.dispatch("change");
        await settle();
        assert.equal(box.checked, before);
        assert.match(errorBubbles().at(-1).textContent, /Auto-continue was not changed: fixed at startup/);
        console_.reply("POST /api/settings", { ok: true });
    });

    await test("a new conversation that cannot be started says so in the history modal", async () => {
        console_.reply("GET /api/sessions", { current: "s-1", sessions: [{ id: "s-1", title: "first", turns: 2 }] });
        console_.reply("POST /api/sessions", { __status: 503, body: { error: "store unavailable" } });
        byId("historyButton").dispatch("click");
        await settle();
        const dialog = backdrops().at(-1);
        [...dialog.querySelectorAll("button")].find(button => button.textContent === "New conversation").dispatch("click");
        await settle();
        assert.equal(backdrops().length, 1, "the modal stays open");
        assert.match(dialog.textContent, /store unavailable/);
        console_.reply("POST /api/sessions", { id: "s-2" });
        [...dialog.querySelectorAll("button")].find(button => button.textContent === "New conversation").dispatch("click");
        await settle();
        assert.equal(backdrops().length, 0, "a started conversation closes it");
    });

    await test("a closed approval modal reopens only for a new request", async () => {
        console_.send({ type: "approval:request", id: "a1", agent: "main_agent", tool: "shell", reason: "r", arguments: {} });
        assert.equal(backdrops().length, 1);
        Modal.closeTop();
        assert.equal(backdrops().length, 0);
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 3 });
        console_.send({ type: "run:status", status: "running" });
        assert.equal(backdrops().length, 0, "unrelated events leave it closed");
        console_.send({ type: "approval:request", id: "a2", agent: "main_agent", tool: "shell", reason: "r", arguments: {} });
        assert.equal(backdrops().length, 1, "a request the operator has not seen opens it");
    });

    await test("an answer the server refuses is put back with the reason", async () => {
        console_.reply("/api/approvals/a1", { __status: 500, body: {} });
        const allow = [...backdrops()[0].querySelectorAll("button")].find(button => button.textContent === "Approve");
        allow.dispatch("click");
        await settle();
        assert.equal(byId("approvalsCount").textContent, "2", "the request is pending again");
        assert.match(backdrops()[0].textContent, /refused/);
        console_.reply("/api/approvals/a1", { resolved: true });
        console_.send({ type: "approval:resolved", id: "a1" });
        console_.send({ type: "approval:resolved", id: "a2" });
        assert.equal(backdrops().length, 0);
    });

    await test("a settings reload keeps the filter, a value being typed and a rejection", async () => {
        const settings = [
            { key: "MAX_ITERATIONS", group: "budget", type: "number", value: 50, source: "default", description: "Iterations before the run stops." },
            { key: "MAX_DEPTH", group: "delegation", type: "number", value: 3, source: "default", description: "Delegation depth." }
        ];
        console_.reply("/api/settings", { settings });
        byId("settingsButton").dispatch("click");
        await settle();
        const dialog = backdrops().at(-1);
        const filter = dialog.querySelector("input.filter");
        filter.value = "iteration";
        filter.dispatch("input");
        const depthRow = dialog.querySelector('.setting[data-key="MAX_DEPTH"]');
        assert.equal(depthRow.hidden, true, "the filter hides what does not match");

        const iterations = dialog.querySelector('.setting[data-key="MAX_ITERATIONS"] input');
        iterations.value = "70";

        console_.reply("/api/settings", { settings: settings.map(item => ({ ...item, description: `${item.description} (reloaded)` })) });
        console_.send({ type: "settings:changed" });
        await settle();

        assert.equal(dialog.querySelector("input.filter"), filter, "the filter field is the same element");
        assert.equal(filter.value, "iteration");
        assert.equal(dialog.querySelector('.setting[data-key="MAX_DEPTH"]').hidden, true, "and still applies");
        assert.equal(iterations.isConnected, true);
        assert.equal(iterations.value, "70", "the value being typed is kept");
        assert.match(dialog.textContent, /reloaded/, "while the list itself is fresh");

        console_.reply("POST /api/settings", { __status: 400, body: { error: "must be at most 60" } });
        iterations.dispatch("change");
        await settle();
        const row = dialog.querySelector('.setting[data-key="MAX_ITERATIONS"]');
        assert.ok(row.classList.contains("rejected"));
        assert.match(row.textContent, /must be at most 60/);
        assert.equal(iterations.value, "50", "the value in effect is shown again");

        console_.reply("POST /api/settings", { ok: true });
        console_.reply("/api/settings", { settings });
        Modal.closeTop("test");
        assert.equal(byId("policyHome").children.length, 2, "the policy controls go home");
    });

    await test("an MCP refresh keeps a half-filled form, and every action reports its outcome", async () => {
        const server = enabled => ({
            name: "github", transport: "stdio", enabled, state: enabled ? "ready" : "idle",
            tool_count: 1, connection: { command: "npx" }
        });
        console_.reply("/api/mcp", { enabled: true, servers: [server(true)], tools: [], problems: [], tool_count: 1 });
        console_.reply("/api/mcp/config", { text: "{}", path: "/w/.agent/mcp.json" });
        byId("mcpButton").dispatch("click");
        await settle();
        const dialog = backdrops().at(-1);
        const name = dialog.querySelector('.mcp-add input[name="name"]');
        name.value = "half typed";

        console_.reply("/api/mcp/github/enabled", { __status: 409, body: { error: "server is busy" } });
        [...dialog.querySelectorAll(".mcp-actions button")].find(button => button.textContent.trim() === "Disable").dispatch("click");
        await settle();
        assert.match(dialog.querySelector(".mcp-server").textContent, /server is busy/, "a refused toggle says why");
        assert.match(dialog.querySelector(".mcp-server .state").textContent, /connected/, "and the list is unchanged");

        console_.reply("/api/mcp/github/enabled", { enabled: false });
        console_.reply("/api/mcp", { enabled: true, servers: [server(false)], tools: [], problems: [], tool_count: 0 });
        [...dialog.querySelectorAll(".mcp-actions button")].find(button => button.textContent.trim() === "Disable").dispatch("click");
        await settle();
        assert.match(dialog.querySelector(".mcp-server .state").textContent, /off/, "an accepted toggle redraws the row");
        assert.doesNotMatch(dialog.querySelector(".mcp-server").textContent, /server is busy/);
        assert.equal(dialog.querySelector('.mcp-add input[name="name"]'), name, "the form is not rebuilt");
        assert.equal(name.value, "half typed");

        console_.reply("/api/mcp", { __status: 400, body: { error: "name already taken" } });
        dialog.querySelector(".mcp-add").dispatch("submit");
        await settle();
        assert.match(dialog.querySelector(".mcp-message").textContent, /name already taken/);
        assert.equal(name.value, "half typed", "a failed connect keeps what was entered");

        console_.reply("/api/mcp", { enabled: true, servers: [server(false)], tools: [], problems: [], tool_count: 0 });
        dialog.querySelector(".mcp-add").dispatch("submit");
        await settle();
        assert.equal(dialog.querySelector('.mcp-add input[name="name"]').value, "", "a connected server clears the form");
        assert.ok(console_.posted.some(item => item.url === "/api/mcp" && item.method === "POST" && item.body.name === "half typed"));
        Modal.closeTop("test");
    });

    await test("an archived run opened in the Execution modal is open the next time too", async () => {
        console_.send({ type: "run:start", task: "first task" });
        console_.send({ type: "agent:start", agent: "main_agent", depth: 0 });
        console_.send({ type: "run:start", task: "second task" });
        byId("executionButton").dispatch("click");
        let accordion = backdrops().at(-1).querySelector("details.execution-run");
        assert.ok(accordion, "the previous run is archived");
        assert.equal(accordion.open, false, "closed by default");
        accordion.open = true;
        accordion.dispatchEvent(new window.Event("toggle"));
        Modal.closeTop("test");
        byId("executionButton").dispatch("click");
        accordion = backdrops().at(-1).querySelector("details.execution-run");
        assert.equal(accordion.open, true);
        Modal.closeTop("test");
    });

    await test("a discussion that cannot start says why", async () => {
        console_.reply("/api/discussion/personas", { personas: [{ id: "security", name: "Security Agent" }] });
        console_.send({ type: "run:status", status: "idle" });
        byId("discussionButton").dispatch("click");
        await settle();
        const box = byId("discussionOptions").querySelector(".persona-box");
        box.checked = true;
        console_.reply("/api/discussion", new Error("socket hang up"));
        byId("task").value = "debate";
        byId("taskForm").dispatch("submit");
        await settle();
        assert.match(byId("discussionOptions").textContent, /socket hang up/);
        assert.equal(byId("runButton").disabled, false);
        byId("discussionButton").dispatch("click");
    });

    /* last: it makes prj-a the current project */
    await test("a slow dashboard response never overwrites the tab the operator moved to", async () => {
        console_.reply("/api/projects", { projects: [{ id: "prj-a", name: "Alpha", rootPath: "/tmp/a" }] });
        console_.reply("/api/projects/prj-a", { project: { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" } });
        console_.reply("/api/projects/prj-a/health", { status: "ok" });
        console_.reply("/api/projects/prj-a/metrics", { metrics: { project_runs_total: 4 } });
        console_.reply("/api/projects/prj-a/sessions", { sessions: [] });

        /* the first /state is held until the second load has finished */
        const realFetch = global.fetch;
        let release = null;
        let calls = 0;
        global.fetch = (url, options) => {
            if (url === "/api/projects/prj-a/state" && ++calls === 1) {
                return new Promise(resolve => { release = () => resolve({
                    ok: true, status: 200,
                    json: async () => ({ events: [{ type: "run:start", task: "STALE" }], active_runs: [], pending_approvals: [] })
                }); });
            }
            return realFetch(url, options);
        };
        console_.reply("/api/projects/prj-a/state", { events: [{ type: "run:start", task: "FRESH" }], active_runs: [], pending_approvals: [] });

        location.pathname = "/projects/prj-a";
        location.search = "?tab=events";
        window.dispatchEvent(new window.Event("popstate"));
        await settle();

        assert.equal(byId("projectDashboard").hidden, false, "the dashboard is shown");
        assert.equal(byId("consoleMain").hidden, true);
        assert.match(byId("dashboardBody").textContent, /Loading/);

        [...byId("dashboardTabs").querySelectorAll("button")].find(button => button.dataset.tab === "logs").dispatch("click");
        await settle();
        [...byId("dashboardTabs").querySelectorAll("button")].find(button => button.dataset.tab === "events").dispatch("click");
        await settle();
        assert.match(byId("dashboardBody").textContent, /FRESH/);

        release();
        await settle();
        global.fetch = realFetch;

        assert.match(byId("dashboardBody").textContent, /FRESH/, "the late response is dropped");
        assert.doesNotMatch(byId("dashboardBody").textContent, /STALE/);
        assert.equal(byId("dashboardTitle").textContent, "Alpha");
        assert.ok(byId("dashboardTabs").querySelector('button[data-tab="events"]').classList.contains("active"));

        byId("dashboardBack").dispatch("click");
        assert.equal(byId("projectDashboard").hidden, true);
        assert.equal(byId("consoleMain").hidden, false);
    });

    await test("a multi-project run outside the visible stream still finishes and frees the composer", async () => {
        console_.reply("/api/projects", { projects: [
            { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" },
            { id: "prj-b", name: "Beta", rootPath: "/tmp/b" }
        ] });
        console_.send({ type: "run:status", status: "idle" });

        byId("projectsButton").dispatch("click");
        await settle();
        const manager = backdrops().at(-1);
        for (const box of manager.querySelectorAll(".project-picker-checkbox")) {
            box.checked = true;
            box.dispatch("change");
        }
        [...manager.querySelectorAll("button")].find(button => button.textContent === "Confirm").dispatch("click");
        await settle();

        const tasks = () => console_.posted.filter(item => /\/api\/projects\/[^/]+\/tasks$/.test(item.url));
        const before = tasks().length;
        console_.reply("/api/projects/prj-b/state", { active_runs: [{ run_id: "r", status: "running" }] });

        byId("task").value = "audit both";
        byId("taskForm").dispatch("submit");
        await settle();
        assert.equal(tasks().length, before + 1);
        assert.equal(tasks().at(-1).url, "/api/projects/prj-a/tasks", "the visible project runs first");

        /* the visible stream reports the first run's end */
        console_.send({ type: "run:status", status: "done", project_id: "prj-a" });
        await settle();
        assert.equal(tasks().at(-1).url, "/api/projects/prj-b/tasks", "the next project starts");
        assert.equal(byId("runButton").disabled, true, "the composer waits for it");

        /* prj-b is not on this stream: its end is learned by polling */
        await new Promise(resolve => setTimeout(resolve, 1700));
        assert.equal(byId("runButton").disabled, true, "still running while prj-b has an active run");
        console_.reply("/api/projects/prj-b/state", { active_runs: [] });
        await new Promise(resolve => setTimeout(resolve, 1700));
        await settle();
        assert.equal(byId("runButton").disabled, false, "the composer is free once prj-b is done");
        assert.equal(tasks().length, before + 2, "and nothing else was posted");
    });
}


(async () => {
    await staticChecks();
    await behaviour();
    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
})();
