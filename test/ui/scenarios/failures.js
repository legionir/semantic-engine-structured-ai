"use strict";

/*
| Reactive console — every action that can fail says so and leaves the console usable
|
| Runs inside reactive.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


module.exports = async function Failures({ test, console_, settle, byId, card, backdrops, errorBubbles, Modal }) {

    await test("clearing the events panel clears its rows, not just the screen", async () => {
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 1 });
        assert.ok(card.log().children.length > 0);
        card.clear().dispatch("click");
        assert.equal(card.log().children.length, 0);
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 2 });
        assert.equal(card.log().children.length, 1, "old rows do not come back with the next event");
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
};
