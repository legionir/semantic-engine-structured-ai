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
        byId("task").dispatch("input");
        assert.equal(console_.storage["structured-ai.taskDraft"], "offline", "draft auto-saves to localStorage");
        byId("taskForm").dispatch("submit");
        await settle();
        assert.equal(errorBubbles().length, before + 1);
        assert.match(errorBubbles().at(-1).textContent, /connection refused/);
        assert.equal(byId("runButton").disabled, false);
        assert.equal(console_.storage["structured-ai.taskDraft"], "offline", "draft remains saved after failure");
        byId("task").value = "";
        byId("task").dispatch("input");
        assert.equal(console_.storage["structured-ai.taskDraft"], undefined, "clearing input removes stored draft");
        console_.reply("/api/tasks", { accepted: true });
    });

    await test("saved task draft restores on boot and clears when a task is accepted", async () => {
        const { initTaskDraft } = await import("../../../web/public/app/composer-controller.js");
        byId("task").value = "";
        console_.storage["structured-ai.taskDraft"] = "persisted draft task";
        initTaskDraft();
        assert.equal(byId("task").value, "persisted draft task", "draft restores from localStorage");
        byId("taskForm").dispatch("submit");
        await settle();
        assert.equal(byId("task").value, "");
        assert.equal(console_.storage["structured-ai.taskDraft"], undefined, "draft clears after successful submit");
    });

    await test("Run task and Queue message lock while submitting and failed Queue keeps running status", async () => {
        const { state } = await import("../../../web/public/app/store.js");
        const realFetch = global.fetch;

        console_.reply("/api/projects", { projects: [{ id: "prj-q", name: "QueueProj", rootPath: "/tmp/q" }] });
        console_.send({ type: "run:status", status: "idle" });
        await settle();

        let release = null;
        let inFlightPosts = 0;
        global.fetch = (url, options) => {
            if (url === "/api/tasks" && options?.method === "POST") {
                inFlightPosts++;
                return new Promise(resolve => {
                    release = () => resolve({ ok: true, status: 202, json: async () => ({ accepted: true }) });
                });
            }
            return realFetch(url, options);
        };

        try {
            byId("task").value = "first submit";
            byId("taskForm").dispatch("submit");
            await settle(2);
            assert.equal(state.submitting, true);
            assert.equal(byId("runButton").disabled, true, "Run task is locked while submitting");
            assert.equal(state.status, "idle", "status stays idle until server confirms acceptance");
            assert.equal(byId("runButton").textContent, "Run task");

            byId("taskForm").dispatch("submit");
            await settle(2);
            assert.equal(inFlightPosts, 1, "duplicate Run task submission is ignored");

            release();
            await settle();
            assert.equal(state.submitting, false);
            assert.equal(state.status, "running");
            assert.equal(byId("runButton").textContent, "Stop");
        } finally {
            global.fetch = realFetch;
        }

        const prevProject = state.currentProjectId;
        state.currentProjectId = "prj-q";
        console_.send({ type: "run:status", status: "running", project_id: "prj-q" });
        await settle();
        assert.equal(byId("queueButton").hidden, false);

        let releaseQueueFail = null;
        let queuedPosts = 0;
        global.fetch = (url, options) => {
            if (url === "/api/projects/prj-q/tasks" && options?.method === "POST") {
                queuedPosts++;
                return new Promise(resolve => {
                    releaseQueueFail = () => resolve({
                        ok: false,
                        status: 500,
                        json: async () => ({ error: "queue full" })
                    });
                });
            }
            return realFetch(url, options);
        };

        try {
            byId("task").value = "follow up";
            byId("queueButton").dispatch("click");
            await settle(2);
            assert.equal(byId("queueButton").disabled, true, "Queue message is locked while submitting");
            byId("queueButton").dispatch("click");
            await settle(2);
            assert.equal(queuedPosts, 1, "duplicate Queue message submission is ignored");

            releaseQueueFail();
            await settle();
            assert.equal(state.status, "running", "failed Queue request does not revert active run to idle");
            assert.equal(byId("runButton").textContent, "Stop");
            assert.equal(byId("queueButton").disabled, false);
        } finally {
            global.fetch = realFetch;
            state.currentProjectId = prevProject;
            byId("task").value = "";
            console_.send({ type: "run:status", status: "idle" });
            await settle();
        }
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

    await test("conversations can be deleted from the history modal with confirmation and error reporting", async () => {
        console_.reply("GET /api/sessions", {
            current: "s-1",
            sessions: [
                { id: "s-1", title: "active session", turns: 2 },
                { id: "s-0", title: "older session", turns: 1 }
            ]
        });
        byId("historyButton").dispatch("click");
        await settle();
        const dialog = backdrops().at(-1);
        const delActive = dialog.querySelector('button[aria-label="Delete active session"]');
        const delOld = dialog.querySelector('button[aria-label="Delete older session"]');
        assert.equal(delActive.disabled, true, "cannot delete the open conversation");
        assert.equal(delOld.disabled, false);

        delOld.dispatch("click");
        await settle();
        const cancelModal = document.querySelector(".modal.confirm-modal");
        assert.ok(cancelModal, "confirmation modal opened before deleting conversation");
        [...cancelModal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Cancel").dispatch("click");
        await settle();
        assert.equal(dialog.querySelectorAll(".session-row").length, 2, "declined keeps both conversations");

        console_.reply("DELETE /api/sessions/s-0", { __status: 409, body: { error: "session locked" } });
        delOld.dispatch("click");
        await settle();
        let confirmModal = document.querySelector(".modal.confirm-modal");
        [...confirmModal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Delete").dispatch("click");
        await settle();
        assert.match(dialog.textContent, /session locked/);
        assert.equal(dialog.querySelectorAll(".session-row").length, 2);

        console_.reply("DELETE /api/sessions/s-0", { ok: true, id: "s-0" });
        delOld.dispatch("click");
        await settle();
        confirmModal = document.querySelector(".modal.confirm-modal");
        [...confirmModal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Delete").dispatch("click");
        await settle();
        assert.equal(dialog.querySelectorAll(".session-row").length, 1);
        assert.doesNotMatch(dialog.textContent, /older session/);
        Modal.closeTop("test");
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
        assert.equal(byId("policyHome").children.length, 1, "the until done control stays home");
        assert.ok(byId("approvalMode").isConnected, "approval mode stays in the composer toolbar");
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

    await test("MCP: a reconnecting server shows its countdown; the catalogue activates with a token; secrets list names only", async () => {
        const lost = {
            name: "github", transport: "http", enabled: true, state: "reconnecting", tool_count: 0,
            connection: { url: "https://api.githubcopilot.com/mcp/" },
            reconnect: { attempt: 2, next_at: Date.now() + 3000, count: 1, last_error: "MCP server \"github\" disconnected: boom", last_error_at: Date.now() }
        };
        console_.reply("/api/mcp", { enabled: true, servers: [lost], tools: [], problems: [], tool_count: 0 });
        console_.reply("/api/mcp/config", { text: "{}", path: "/w/.agent/mcp.json" });
        byId("mcpButton").dispatch("click");
        await settle();
        const dialog = backdrops().at(-1);
        assert.match(dialog.querySelector(".mcp-server .state").textContent, /reconnecting in [0-9]s \(attempt 2\)/);
        assert.ok(dialog.querySelector(".mcp-dot.reconnecting"), "the status dot says so too");
        assert.match(dialog.querySelector(".mcp-server").textContent, /last error .*disconnected: boom/);
        assert.match(dialog.querySelector(".mcp-server").textContent, /reconnected 1×/);
        assert.ok([...dialog.querySelectorAll(".mcp-actions button")].some(button => button.textContent.trim() === "Reconnect"));

        const github = {
            id: "github", title: "GitHub", category: "code", description: "Issues and PRs", transport: "http",
            pinned: "https://api.githubcopilot.com/mcp/", homepage: "https://github.com/modelcontextprotocol", trust: "default",
            inputs: [{ id: "token", label: "GitHub personal access token", required: true, secret_name: "GITHUB_PAT", secret_stored: false, link: "https://github.com/settings/personal-access-tokens/new", placeholder: "github_pat_…", default: null }],
            prerequisites: [], installed: []
        };
        const playwright = {
            id: "playwright", title: "Playwright", category: "browser", description: "Browser", transport: "stdio",
            pinned: "npx -y @playwright/mcp@0.0.86", trust: "default", inputs: [],
            prerequisites: [
                { id: "npx", label: "npx (Node.js)", ok: true, path: "/usr/bin/npx", installable: false },
                { id: "chromium", label: "Headless Chromium", ok: false, hint: "Install the Chromium build", installable: true }
            ],
            installed: []
        };
        console_.reply("/api/mcp/catalog", { categories: { code: "Code", browser: "Browser" }, servers: [github, playwright] });
        [...dialog.querySelectorAll(".mcp-tab")].find(button => button.textContent.trim() === "Catalogue").dispatch("click");
        await settle();

        const cards = () => [...dialog.querySelectorAll(".mcp-card")];
        assert.equal(cards().length, 2);
        const aboutLink = cards()[0].querySelector(".mcp-actions a");
        assert.ok(aboutLink && aboutLink.classList.contains("ghost") && aboutLink.classList.contains("mcp-about-link"), "Catalogue About link uses ghost button styling");
        assert.ok(dialog.querySelector('.mcp-catalog-tools input[type="search"]'), "Catalogue filter search input renders");
        const activateOf = item => [...item.querySelectorAll("button")].find(button => /^Activate/.test(button.textContent.trim()));
        assert.equal(activateOf(cards()[1]).disabled, true, "a missing prerequisite blocks activation");
        assert.match(cards()[1].textContent, /Install the Chromium build/);
        assert.ok([...cards()[1].querySelectorAll("button")].some(button => button.textContent.trim() === "Install"));

        activateOf(cards()[0]).dispatch("click");
        await settle();
        const form = dialog.querySelector(".mcp-activate");
        assert.ok(form, "the token form opens");
        const token = form.querySelector('input[name="token"]');
        assert.equal(token.type, "password");
        token.value = "github_pat_from_the_form";

        console_.reply("POST /api/mcp/catalog/github/activate", { ok: true, server: "github", catalog: "github", scope: "global", tools: [{ name: "get_me", description: "who am I" }] });
        console_.reply("/api/mcp/catalog", { categories: { code: "Code" }, servers: [{ ...github, installed: [{ name: "github", scope: "global", projects: null, state: "ready", tool_count: 1, error: null }] }, playwright] });
        console_.reply("/api/mcp", { enabled: true, servers: [{ ...lost, state: "ready", reconnect: { ...lost.reconnect, attempt: 0, next_at: null } }], tools: [], problems: [], tool_count: 1 });
        form.dispatch("submit");
        await settle();
        const sent = console_.posted.filter(item => item.url === "/api/mcp/catalog/github/activate").at(-1);
        assert.deepEqual(sent.body.inputs, { token: "github_pat_from_the_form" });
        assert.equal(sent.body.scope, "global");
        assert.match(dialog.querySelector(".mcp-activated").textContent, /Connected: 1 tool/);
        assert.match(dialog.querySelector(".mcp-activated").textContent, /get_me/);
        assert.equal(dialog.querySelector(".mcp-activate"), null, "the form is closed");

        console_.reply("POST /api/mcp/catalog/github/deactivate", { ok: true, server: "github", removed: true, secrets_removed: ["GITHUB_PAT"] });
        console_.reply("/api/mcp/catalog", { categories: { code: "Code" }, servers: [github, playwright] });
        [...cards()[0].querySelectorAll("button")].find(button => button.textContent.trim() === "Deactivate").dispatch("click");
        await settle();
        const deactivated = console_.posted.filter(item => item.url === "/api/mcp/catalog/github/deactivate").at(-1);
        assert.equal(deactivated.body.forget_secrets, true);
        assert.equal(dialog.querySelector(".mcp-activated"), null, "the old result is gone with the server");

        console_.reply("/api/secrets", { secrets: [{ name: "BRAVE_API_KEY", used_by: ["brave-search"], updated_at: "2026-11-25T10:00:00.000Z", created_at: "2026-11-25T10:00:00.000Z", length: 12 }] });
        [...dialog.querySelectorAll(".mcp-tab")].find(button => button.textContent.trim() === "Secrets").dispatch("click");
        await settle();
        assert.match(dialog.querySelector(".mcp-secret").textContent, /BRAVE_API_KEY/);
        assert.match(dialog.querySelector(".mcp-secret").textContent, /used by brave-search/);

        const add = dialog.querySelector(".mcp-secret-add");
        add.querySelector('input[name="name"]').value = "NEW_ONE";
        add.querySelector('input[name="value"]').value = "typed-secret";
        assert.equal(add.querySelector('input[name="value"]').type, "password");
        console_.reply("PUT /api/secrets/NEW_ONE", { ok: true, name: "NEW_ONE", created: true });
        add.dispatch("submit");
        await settle();
        const put = console_.posted.filter(item => item.url === "/api/secrets/NEW_ONE").at(-1);
        assert.equal(put.method, "PUT");
        assert.deepEqual(put.body, { value: "typed-secret" });
        assert.equal(dialog.querySelector('.mcp-secret-add input[name="value"]').value, "", "the value leaves the page once saved");
        assert.match(dialog.querySelector(".mcp-secret-add .mcp-message").textContent, /NEW_ONE saved/);

        [...dialog.querySelectorAll(".mcp-tab")].find(button => button.textContent.trim() === "Servers").dispatch("click");
        await settle();
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

    await test("the persona picker follows the store and keeps the operator's choices", async () => {
        console_.send({ type: "run:status", status: "idle" });
        const { state } = await import("../../../web/public/app/store.js");
        state.discussion = null;
        state.discussionPersonas = [];
        state.discussionSelection = null;
        state.discussionDraft = "";
        const toggle = byId("discussionButton");
        const dialog = () => backdrops().at(-1);
        const boxes = () => [...(dialog()?.querySelectorAll(".persona-box") || [])];
        const checked = () => boxes().filter(box => box.checked).map(box => box.value);
        const link = label => [...dialog().querySelectorAll(".discussion-persona-head button")].find(item => item.textContent === label);
        const posts = () => console_.posted.filter(item => item.url === "/api/discussion");
        const line = () => byId("discussionStatusLine");

        console_.reply("/api/discussion/personas", new Error("offline"));
        toggle.dispatch("click");
        await settle();
        assert.ok(dialog(), "the modal opens");
        assert.equal(boxes().length, 0, "nothing to pick yet");
        Modal.closeTop("test");
        await settle();
        assert.equal(toggle.classList.contains("active"), false);

        console_.reply("/api/discussion/personas", { personas: [
            { id: "security", description: "threat modelling" }, { id: "backend" }, { id: "qa" }
        ] });
        toggle.dispatch("click");
        await settle();
        assert.deepEqual(boxes().map(box => box.value), ["security", "backend", "qa"], "a failed load is tried again");
        assert.deepEqual(checked(), ["security", "backend"], "the default panel is preselected");
        assert.equal(boxes()[0].parentNode.title, "threat modelling");
        assert.equal(toggle.classList.contains("active"), true);

        link("none").dispatch("click");
        assert.deepEqual(checked(), []);
        link("all").dispatch("click");
        assert.deepEqual(checked(), ["security", "backend", "qa"]);
        const qa = boxes()[2];
        qa.checked = false;
        qa.dispatch("change");

        Modal.closeTop("test");
        await settle();
        toggle.dispatch("click");
        await settle();
        assert.deepEqual(checked(), ["security", "backend"], "closing and reopening the modal keeps the choice");

        const rounds = byId("discussionRounds");
        rounds.value = "3";
        rounds.dispatch("input");
        console_.reply("/api/discussion", { __status: 400, body: { error: "too many personas" } });
        const taskInput = byId("discussionTask");
        taskInput.value = "debate";
        taskInput.dispatch("input");
        dialog().querySelector(".discussion-setup").dispatch("submit");
        await settle();
        assert.equal(line().textContent, "too many personas");
        assert.equal(line().className, "bad");
        assert.equal(byId("discussionRounds"), rounds, "the field survives the redraw");
        assert.equal(rounds.value, "3");
        assert.deepEqual(posts().at(-1).body.personas, ["security", "backend"]);
        assert.equal(posts().at(-1).body.max_rounds, 3);

        console_.reply("/api/discussion", {});
        dialog().querySelector(".discussion-setup").dispatch("submit");
        await settle();
        assert.ok(byId("discussionStatus"), "switches to the live transcript view");
        assert.equal(byId("discussionStatus").textContent, "starting · 2 personas");

        console_.send({
            type: "discussion:finish",
            id: null,
            total_rounds: 2,
            hit_max_rounds: false,
            stopped_reason: null,
            final_report: { summary: "s", agreed_points: [], unresolved: [], next_steps: [] }
        });
        await settle();
        assert.equal(byId("discussionStatus").textContent, "done · 2 round(s)");
        assert.equal(Modal.openCount, 1, "the transcript stays open in the modal");
        Modal.closeTop("test");
        await settle();
        assert.equal(toggle.classList.contains("active"), false);
    });

    await test("a discussion that cannot start says why", async () => {
        const { state } = await import("../../../web/public/app/store.js");
        state.discussion = null;
        state.discussionPersonas = [];
        state.discussionSelection = null;
        state.discussionDraft = "";
        console_.reply("/api/discussion/personas", { personas: [{ id: "security", name: "Security Agent" }] });
        console_.send({ type: "run:status", status: "idle" });
        byId("discussionButton").dispatch("click");
        await settle();
        const dialog = backdrops().at(-1);
        const box = dialog.querySelector(".persona-box");
        box.checked = true;
        box.dispatch("change");
        console_.reply("/api/discussion", new Error("socket hang up"));
        const taskInput = byId("discussionTask");
        taskInput.value = "debate";
        taskInput.dispatch("input");
        dialog.querySelector(".discussion-setup").dispatch("submit");
        await settle();
        assert.match(dialog.textContent, /socket hang up/);
        assert.equal(byId("startDiscussionButton").disabled, false);
        Modal.closeTop("test");
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
        assert.equal(byId("runButton").textContent, "Stop", "the composer waits in Stop state");
        assert.equal(byId("runButton").disabled, false);

        /* prj-b is not on this stream: its end is learned by polling */
        await new Promise(resolve => setTimeout(resolve, 1700));
        assert.equal(byId("runButton").textContent, "Stop", "still running while prj-b has an active run");
        console_.reply("/api/projects/prj-b/state", { active_runs: [] });
        await new Promise(resolve => setTimeout(resolve, 1700));
        await settle();
        assert.equal(byId("runButton").textContent, "Run task", "the composer returns to Run task once prj-b is done");
        assert.equal(byId("runButton").disabled, false);
        assert.equal(tasks().length, before + 2, "and nothing else was posted");
    });
};
