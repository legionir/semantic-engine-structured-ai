"use strict";

/*
| Console behaviour — stored conversations, settings, MCP, policy, execution and events modals
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");
const path = require("path");
/* import() needs a file:// URL: a Windows path (D:\\...) reads as a URL scheme */
const { pathToFileURL } = require("url");
const harness = require("../harness");


module.exports = async function SettingsAndModals({ test, Modal, backdrops, card, console_ }) {

    await test("opening a stored conversation redraws every card", async () => {

        /*
        | The point of storing the streamed events rather than a summary:
        | the same code that draws a live run draws the stored one.
        */

        console_.reply("/api/sessions/s-1", {
            session: {
                id: "s-1",
                title: "an earlier conversation",
                turns: 1,

                messages: [
                    { role: "user", kind: "message", content: "what changed?" },
                    { role: "assistant", kind: "response", content: "two files" }
                ],

                events: [
                    { type: "run:start", task: "what changed?" },
                    {
                        type: "agent:start",
                        agent: "git_analysis",
                        scope: "git_analysis#1",
                        depth: 1,
                        parent: "main_agent",
                        parent_scope: "main_agent",
                        task: "report the repository state"
                    },
                    {
                        type: "hook:start",
                        id: "verify",
                        phase: "after_task",
                        hook_type: "agent"
                    },
                    {
                        type: "hook:end",
                        id: "verify",
                        phase: "after_task",
                        hook_type: "agent",
                        status: "done",
                        ok: true,
                        summary: "stored verification passed"
                    },
                    {
                        type: "tool:graph",
                        agent: "main_agent",
                        graph_id: "graph_9",
                        iteration: 1,
                        shape: "parallel",
                        max_parallel: 8,
                        waves: [["one", "two"]],
                        calls: [
                            { id: "one", name: "git_status", depends_on: [] },
                            { id: "two", name: "git_log", depends_on: [] }
                        ]
                    },
                    {
                        type: "tool:start",
                        agent: "main_agent",
                        graph_id: "graph_9",
                        id: "one",
                        name: "git_status",
                        wave: 0,
                        call_key: "main_agent|graph_9|one",
                        arguments_preview: '{ "cwd": "." }'
                    },
                    {
                        type: "tool:end",
                        agent: "main_agent",
                        graph_id: "graph_9",
                        id: "one",
                        name: "git_status",
                        wave: 0,
                        call_key: "main_agent|graph_9|one",
                        success: true,
                        duration_ms: 7,
                        result_preview: "{}"
                    }
                ],

                calls: [
                    {
                        key: "main_agent|graph_9|one",
                        id: "one",
                        name: "git_status",
                        agent: "main_agent",
                        status: "done",
                        arguments: { cwd: "." },
                        result: {}
                    }
                ]
            }
        });

        /* the server announces the switch, the console loads it */
        console_.send({
            type: "session:switched",
            session: {
                id: "s-1",
                title: "an earlier conversation",
                turns: 1
            }
        });

        await new Promise(resolve => setTimeout(resolve, 5));

        /* the conversation */
        assert.match(
            document.getElementById("chat").textContent,
            /what changed\?/
        );

        /* the execution card */
        const tree =
            card.tree().textContent;

        assert.match(tree, /git_analysis/);
        assert.match(tree, /from main_agent/);
        assert.match(tree, /parallel/);
        assert.match(tree, /git_status/);
        assert.match(tree, /stored verification passed/);

        /* the events card */
        assert.ok(
            card.log().children.length >= 5
        );

        assert.match(
            document.getElementById("sessionTitle").textContent,
            /an earlier conversation/
        );
    });

    await test("settings open in a modal from the header button", async () => {

        document.getElementById("settingsButton").dispatch("click");

        const dialog =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];

        assert.ok(dialog.classList.contains("settings-modal"), "settings modal keeps sticky filter class");
        assert.match(dialog.textContent, /Settings/);
        assert.match(dialog.textContent, /MAX_ITERATIONS/);
        assert.match(dialog.textContent, /applied on next use/);
        const iterTitle = dialog.querySelector('.setting[data-key="MAX_ITERATIONS"] .setting-title');
        assert.ok(iterTitle, "source badge sits beside the title");
        assert.equal(iterTitle.children[0].classList.contains("label"), true);
        assert.equal(iterTitle.children[1].classList.contains("src"), true);
        Modal.closeTop("test");

        console_.reply("/api/models", {
            models: ["main-model"],
            byRole: {
                MAIN: ["main-model"],
                L1: ["main-model", "layer-model"]
            },
            errors: {}
        });
        document.getElementById("llmSettingsButton").dispatch("click");
        const llmDialog =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];
        assert.ok(llmDialog.classList.contains("settings-modal"), "LLM settings modal keeps sticky filter class");
        assert.match(llmDialog.textContent, /LLM settings/);
        const llmTitle = llmDialog.querySelector(".setting .setting-title");
        assert.ok(llmTitle && llmTitle.querySelector(".label") && llmTitle.querySelector(".src"), "LLM setting badge sits beside the title");
        const proxyInput = [...llmDialog.querySelectorAll(".setting")]
            .flatMap(row => [...row.children])
            .find(child => child.tagName === "INPUT" && child.type === "password");
        assert.ok(proxyInput, "proxy credentials use a password input");
        assert.equal(proxyInput.value, "", "masked credentials are never written back into the field");
        assert.match(proxyInput.placeholder, /enter a replacement/);

        await new Promise(resolve => setTimeout(resolve, 0));
        const modelRequests = console_.posted
            .filter(item => item.url === "/api/models");
        assert.equal(modelRequests.length, 1, "all model rows share one aggregate catalog request");

        const modelRows = [...llmDialog.querySelectorAll(".setting")]
            .filter(row => row.dataset.key.endsWith("_MODEL"));
        const layerOptions = [...modelRows.find(row => row.dataset.key === "ENDPOINT_L1_MODEL").children[1].children]
            .map(option => option.value);
        assert.ok(layerOptions.includes("layer-model"), "the backend's per-role catalog populates the layer select");

        Modal.closeTop("test");

        assert.equal(
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            ).length,
            0
        );
    });

    await test("Plan stays beside the conversation on desktop and uses one mobile modal", () => {

        const panel = document.getElementById("planPanel");
        const before = Modal.openCount;
        window.innerWidth = 1280;
        document.getElementById("planButton").dispatch("click");
        assert.equal(Modal.openCount, before, "desktop uses the inline plan panel");

        window.innerWidth = 390;
        document.getElementById("planButton").dispatch("click");
        const backdrop = [...document.body.children].find(child => child.classList.contains("modal-backdrop"));
        const dialog = backdrop.children[0];
        assert.match(dialog.textContent, /Plan/);
        assert.equal([...dialog.querySelectorAll(".panel")].length, 0, "the plan does not create a second nested card");
        Modal.closeTop("test");
        assert.equal(panel.classList.contains("plan-modal-content"), false);
        window.innerWidth = 1280;
    });


    await test("MCP modal has a raw JSON tab that saves the workspace config", async () => {

        console_.reply("/api/mcp", {
            enabled: true,
            servers: [],
            tools: [],
            problems: [],
            tool_count: 0
        });
        console_.reply("/api/mcp/config", {
            text: '{\n  "mcpServers": {}\n}\n',
            path: "/workspace/.agent/mcp.json"
        });
        document.getElementById("mcpButton").dispatch("click");
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        const backdrop = [...document.body.children].find(child => child.classList.contains("modal-backdrop"));
        const dialog = backdrop.children[0];
        const tabs = [...dialog.querySelectorAll(".mcp-tab")];
        assert.deepEqual(tabs.map(tab => tab.textContent.trim()), ["Servers", "Catalogue", "Registry", "Import", "Secrets", "Raw JSON"]);
        tabs[5].dispatch("click");

        const textarea = [...dialog.querySelectorAll(".mcp-raw-json")][0];
        assert.ok(textarea.value.includes("mcpServers"));
        textarea.value = '{\n  "mcpServers": {\n    "local": { "command": "node", "args": ["server.js"] }\n  }\n}\n';
        [...dialog.querySelectorAll(".mcp-json-editor")][0].querySelector("button").dispatch("click");
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(console_.posted.some(item =>
            item.url === "/api/mcp/config" &&
            item.method === "PUT" &&
            item.body &&
            item.body.text.includes('"local"')
        ));
        Modal.closeTop("test");
    });


    await test("MCP panel: per-tool switches, read/write approval, sign-in, import and the registry warning (group 6)", async () => {

        const tick = () => new Promise(resolve => setTimeout(resolve, 0));
        const server = {
            name: "gh",
            transport: "http",
            state: "ready",
            enabled: true,
            tool_count: 2,
            capabilities: ["tools", "prompts"],
            connection: { url: "https://gh.example/mcp" },
            stats: {},
            reconnect: {},
            approval: { read: "inherit", write: "inherit" },
            oauth: { signed_in: false },
            tools: [
                { name: "list_issues", description: "List issues", read_only: true, enabled: true },
                { name: "create_issue", description: "Create an issue", read_only: false, enabled: true }
            ]
        };

        console_.reply("/api/mcp", { enabled: true, servers: [server], tools: [], problems: [], tool_count: 2 });
        console_.reply("/api/mcp/config", { text: '{\n  "mcpServers": {}\n}\n', path: "/workspace/.agent/mcp.json" });
        console_.reply("/api/mcp/gh/controls", { ok: true, overrides: { disabled_tools: ["create_issue"] } });
        console_.reply("/api/mcp/import/preview", {
            client: "Claude Desktop",
            entries: [
                { name: "files", status: "new", definition: { command: "npx" } },
                { name: "gh", status: "conflict", definition: { command: "npx" } }
            ]
        });

        document.getElementById("mcpButton").dispatch("click");
        await tick();
        await tick();

        const dialog = backdrops().at(-1).children[0];
        const row = dialog.querySelector(".mcp-server");

        assert.ok(row.textContent.includes("sign-in needed"), "an OAuth server without a token says so");

        const expand = [...row.querySelectorAll("button")].find(button => button.textContent.includes("Tools & approval"));
        expand.dispatch("click");
        await tick();

        const switches = [...dialog.querySelectorAll(".mcp-tool-switches input")];
        assert.equal(switches.length, 2);
        assert.ok(dialog.querySelector(".mcp-tool-switches").textContent.includes("write"));

        switches[1].checked = false;
        switches[1].dispatch("change");
        await tick();

        assert.ok(console_.posted.some(item =>
            item.url === "/api/mcp/gh/controls" && item.method === "PATCH" &&
            item.body && item.body.tool === "create_issue" && item.body.enabled === false
        ), "the switch is sent");

        const writeApproval = [...dialog.querySelectorAll(".mcp-approval select")][1];
        writeApproval.value = "always";
        writeApproval.dispatch("change");
        await tick();

        assert.ok(console_.posted.some(item =>
            item.url === "/api/mcp/gh/controls" && item.body && item.body.approval &&
            item.body.approval.write === "always" && item.body.approval.read === "inherit"
        ), "write approval is set on its own");

        const tabs = [...dialog.querySelectorAll(".mcp-tab")];

        tabs.find(tab => tab.textContent.trim() === "Registry").dispatch("click");
        await tick();
        const warning = dialog.querySelector(".mcp-trust-warning");
        assert.ok(warning && /not reviewed/.test(warning.textContent), "the trust warning comes first");

        tabs.find(tab => tab.textContent.trim() === "Import").dispatch("click");
        await tick();
        const text = dialog.querySelector(".mcp-import-text");
        text.value = '{"mcpServers": {"files": {"command": "npx"}}}';
        text.dispatch("input");
        [...dialog.querySelectorAll(".mcp-import button")].find(button => button.textContent.trim() === "Preview").dispatch("click");
        await tick();
        await tick();

        assert.ok(console_.posted.some(item => item.url === "/api/mcp/import/preview" && item.body && item.body.text.includes("files")));
        const preview = dialog.querySelector(".mcp-import-preview");
        assert.ok(preview.textContent.includes("1 new") && preview.textContent.includes("1 conflicting"), preview.textContent);
        assert.equal(preview.querySelectorAll("select").length, 1, "only the conflict asks what to do");

        Modal.closeTop("test");
    });


    await test("Settings draws the runtime policy controls from the header's state", async () => {

        const home = document.getElementById("policyHome");
        const approvalMode = document.getElementById("approvalMode");
        const autoContinue = document.getElementById("autoContinue");

        assert.equal(home.children.length, 1, "until done mirror stays in policyHome");
        assert.ok(document.querySelector(".composer-tools #approvalMode"), "approval/plan mode lives next to Changes and Review");
        assert.deepEqual([...approvalMode.options].map(option => option.value), ["auto", "prompt", "deny", "plan"]);

        document.getElementById("settingsButton").dispatch("click");

        const dialog = backdrops().at(-1).children[0];

        assert.equal(home.children.length, 1, "the hidden mirror stays where it is");
        assert.equal(document.querySelectorAll("#approvalMode").length, 1, "ids stay unique");
        assert.equal(dialog.querySelectorAll(".policy-row").length, 1, "only UNTIL_DONE remains in Settings runtime policy");

        const settings = dialog.querySelector(".settings");
        assert.ok(settings.children[0].classList.contains("filter"), "filter remains first");
        assert.ok(settings.children[1].classList.contains("runtime-policy-settings"), "policy follows the filter");
        assert.equal(settings.children[1].querySelector("h3").textContent, "runtime policy");

        const untilDoneRow = dialog.querySelector('.policy-row[data-key="UNTIL_DONE"]');
        assert.ok(untilDoneRow, "UNTIL_DONE row exists");

        const untilDoneSelect = untilDoneRow.querySelector("select");
        assert.equal(untilDoneSelect.value, autoContinue.checked ? "true" : "false");

        /* a change in the modal is the same action as changing #autoContinue */
        const nextAuto = !autoContinue.checked;
        untilDoneSelect.value = nextAuto ? "true" : "false";
        untilDoneSelect.dispatch("change");
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(
            console_.posted.some(item => item.url === "/api/settings" && item.body && item.body.key === "AUTO_CONTINUE" && item.body.value === nextAuto),
            "the change is sent"
        );
        assert.equal(autoContinue.checked, nextAuto, "and the header mirror follows");

        /* changing #approvalMode in composer sends /api/approval-mode */
        const nextMode = approvalMode.value === "deny" ? "prompt" : "deny";
        approvalMode.value = nextMode;
        approvalMode.dispatch("change");
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.ok(
            console_.posted.some(item => item.url === "/api/approval-mode" && item.body && item.body.mode === nextMode),
            "composer approval mode change is sent"
        );

        /* the filter hides the policy group when it does not match */
        const filter = settings.children[0];
        filter.value = "max_iter";
        filter.dispatch("input");
        assert.equal(settings.children[1].hidden, true);
        filter.value = "until";
        filter.dispatch("input");
        assert.equal(settings.children[1].hidden, false);
        assert.equal(untilDoneRow.hidden, false);

        Modal.closeTop("test");

        assert.equal(home.children.length, 1);
        assert.ok(document.getElementById("autoContinue").isConnected, "the header controls never left");

        /* reopening draws the row again */
        document.getElementById("settingsButton").dispatch("click");
        assert.equal(backdrops().at(-1).querySelectorAll(".policy-row").length, 1);
        Modal.closeTop("test");
        assert.equal(backdrops().length, 0);
    });

    await test("execution and events open as modals from the header", () => {

        document.getElementById("executionButton").dispatch("click");

        let backdrops =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            );

        assert.equal(backdrops.length, 1);
        assert.match(backdrops[0].textContent, /Execution/);

        Modal.closeTop("test");

        backdrops =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            );

        assert.equal(backdrops.length, 0);

        document.getElementById("eventsButton").dispatch("click");

        backdrops =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            );

        assert.equal(backdrops.length, 1);
        assert.match(backdrops[0].textContent, /Events/);

        Modal.closeTop("test");
    });

    await test("command palette opens via button and keyboard, filters commands, and executes action", async () => {

        const paletteBtn = document.getElementById("commandPaletteButton");
        assert.ok(paletteBtn, "command palette button is present in bar-nav");

        paletteBtn.dispatch("click");
        let activeBackdrops = backdrops();
        assert.equal(activeBackdrops.length, 1);
        let dialog = activeBackdrops[0].children[0];
        assert.match(dialog.textContent, /Command Palette/);

        const input = dialog.querySelector(".palette-input");
        assert.ok(input, "palette search input is present");

        const list = dialog.querySelector(".palette-list");
        assert.ok(list, "palette command list is present");
        const initialCount = list.children.length;
        assert.ok(initialCount >= 15, "commands list has all navigation and action items");

        /* test search filtering */
        input.value = "History";
        input.dispatch("input");
        assert.equal(list.children.length, 1, "filtered down to 1 item");
        assert.match(list.children[0].textContent, /History/);

        /* test empty search */
        input.value = "xyznonexistentcommand";
        input.dispatch("input");
        assert.equal(list.children.length, 0);
        const empty = dialog.querySelector(".palette-empty");
        assert.equal(empty.hidden, false);

        /* reset search and test arrow navigation */
        input.value = "";
        input.dispatch("input");
        assert.equal(list.children.length, initialCount);

        input.dispatch("keydown", { key: "ArrowDown" });
        assert.ok(list.children[1].classList.contains("active"), "ArrowDown moves active item");

        /* close palette */
        Modal.closeTop("test");
        assert.equal(backdrops().length, 0);

        /* test opening via Ctrl+K */
        document.dispatch("keydown", { key: "k", ctrlKey: true });
        assert.equal(backdrops().length, 1);
        assert.match(backdrops()[0].textContent, /Command Palette/);
        Modal.closeTop("test");
    });

    await test("MCP view supports custom arbitrary headers for remote transports", async () => {

        const { parseHeadersInput, connectBody } = await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "app", "mcp-view.js")).href);

        /* JSON headers */
        const parsedJson = parseHeadersInput('{"X-API-Key": "secret123", "Authorization": "Bearer token456"}');
        assert.deepEqual(parsedJson, {
            "X-API-Key": "secret123",
            "Authorization": "Bearer token456"
        });

        /* Line-based headers with : and = */
        const parsedLines = parseHeadersInput("# comments\nHeader-A: valA\nHeader-B = valB\n\n");
        assert.deepEqual(parsedLines, {
            "Header-A": "valA",
            "Header-B": "valB"
        });

        /* empty input returns undefined */
        assert.equal(parseHeadersInput(""), undefined);
        assert.equal(parseHeadersInput("   "), undefined);

        /* test connectBody with headers element and interactive header rows */
        const form = document.createElement("form");
        const transportInput = document.createElement("input");
        transportInput.name = "transport";
        transportInput.value = "http";
        const nameInput = document.createElement("input");
        nameInput.name = "name";
        nameInput.value = "remote-test";
        const urlInput = document.createElement("input");
        urlInput.name = "url";
        urlInput.value = "https://example.com/mcp";
        const headersInput = document.createElement("textarea");
        headersInput.name = "headers";
        headersInput.value = "X-Custom: hello\nX-Tenant: 42";

        form.append(transportInput, nameInput, urlInput, headersInput);
        const body = connectBody(form);
        assert.equal(body.name, "remote-test");
        assert.equal(body.transport, "http");
        assert.deepEqual(body.headers, {
            "X-Custom": "hello",
            "X-Tenant": "42"
        });

        /* interactive key/value builder in the live MCP modal for http, sse, websocket */
        console_.reply("/api/mcp", { enabled: true, servers: [], tools: [], problems: [], tool_count: 0 });
        console_.reply("/api/mcp/config", { text: '{\n  "mcpServers": {}\n}\n', path: "/workspace/.agent/mcp.json" });
        document.getElementById("mcpButton").dispatch("click");
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        const dialog = backdrops().at(-1).children[0];
        const transportSelect = dialog.querySelector('.mcp-add select[name="transport"]');
        for (const kind of ["http", "sse", "websocket"]) {
            transportSelect.value = kind;
            transportSelect.dispatch("change");
            const field = dialog.querySelector(".mcp-headers-field");
            assert.equal(field.hidden, false, `custom headers field is open in ${kind} mode`);
            assert.ok(field.querySelector(".mcp-header-add"), `+ Add header button shown in ${kind} mode`);
        }
        dialog.querySelector(".mcp-header-add").dispatch("click");
        assert.equal(dialog.querySelectorAll(".mcp-header-row").length, 2, "adds a second interactive header row");
        const rows = [...dialog.querySelectorAll(".mcp-header-row")];
        rows[0].querySelector("input[data-header-key]").value = "X-Custom-Header";
        rows[0].querySelector("input[data-header-val]").value = "alpha";
        rows[1].querySelector("input[data-header-key]").value = "Sec-WebSocket-Protocol";
        rows[1].querySelector("input[data-header-val]").value = "custom-mcp";
        const built = connectBody(dialog.querySelector("form.mcp-add"));
        assert.deepEqual(built.headers, {
            "X-Custom-Header": "alpha",
            "Sec-WebSocket-Protocol": "custom-mcp"
        });
        Modal.closeTop("test");
    });

    await test("extensible slash command service supports custom providers, autocomplete and composer execution", async () => {

        const {
            createSlashCommandRegistry,
            registerCommand,
            registerCommandProvider,
            executeSlashCommand
        } = await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "app", "slash-commands.js")).href);

        /* isolated registry extensibility */
        const registry = createSlashCommandRegistry();
        let ran = null;
        const removeCustom = registry.register({
            name: "deploy",
            aliases: ["ship"],
            description: "Trigger deployment",
            category: "Custom",
            acceptsArgs: true,
            execute: args => { ran = args; return "ok"; }
        });
        const removeProvider = registry.registerProvider(async () => [
            { name: "team:standup", description: "Dynamic team command", execute: () => "standup" }
        ]);

        const matches = await registry.match("dep");
        assert.equal(matches[0].path, "/deploy");
        const providerMatches = await registry.match("team");
        assert.equal(providerMatches[0].path, "/team:standup");

        const execAlias = await registry.execute("/ship prod");
        assert.equal(execAlias.handled, true);
        assert.equal(execAlias.ok, true);
        assert.equal(ran, "prod");

        const pathLike = await registry.execute("/app/applet/file.js");
        assert.equal(pathLike.handled, false, "file paths pass through as normal messages");

        const unknown = await registry.execute("/doesnotexist");
        assert.equal(unknown.handled, true);
        assert.equal(unknown.ok, false);
        assert.match(unknown.error, /Unknown command/);

        removeCustom();
        removeProvider();
        assert.equal((await registry.get("deploy")), null);

        /* live console registration & composer integration */
        const cleanup = registerCommand({
            name: "ping-test",
            description: "Test custom command",
            execute: args => `pong:${args}`
        });
        const cleanupProv = registerCommandProvider(() => []);
        try {
            const customRes = await executeSlashCommand("/ping-test hello");
            assert.equal(customRes.ok, true);
            assert.equal(customRes.value, "pong:hello");

            const task = document.getElementById("task");
            const form = document.getElementById("taskForm");
            const beforeTasks = console_.posted.filter(item => item.url.includes("/tasks")).length;

            /* /help prints commands into chat without hitting /api/tasks */
            task.value = "/help";
            form.dispatch("submit");
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.equal(console_.posted.filter(item => item.url.includes("/tasks")).length, beforeTasks);
            assert.match(document.getElementById("chat").textContent, /Available commands/);
            assert.equal(task.value, "", "composer input clears after slash command runs");

            /* /mode changes the composer mode */
            task.value = "/mode deny";
            form.dispatch("submit");
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.equal(document.getElementById("approvalMode").value, "deny");
            assert.ok(console_.posted.some(item => item.url === "/api/approval-mode" && item.body?.mode === "deny"));

            /* typing /hist opens slash autocomplete */
            task.value = "/hist";
            task.selectionStart = 5;
            task.dispatch("input");
            await new Promise(resolve => setTimeout(resolve, 110));
            const mentionList = document.getElementById("mentionList");
            assert.equal(mentionList.hidden, false);
            assert.match(mentionList.textContent, /\/history/);
        } finally {
            cleanup();
            cleanupProv();
        }
    });

    await test("task templates service saves, searches, loads, edits, and deletes reusable task descriptions", async () => {

        const {
            createTaskTemplateService
        } = await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "app", "task-templates.js")).href);

        /* isolated unit service */
        const memStore = new Map();
        const adapter = {
            getItem: k => (memStore.has(k) ? memStore.get(k) : null),
            setItem: (k, v) => memStore.set(k, String(v)),
            removeItem: k => memStore.delete(k)
        };
        const svc = createTaskTemplateService({ storage: adapter });
        assert.throws(() => svc.save({ name: "", content: "abc" }), /name is required/);
        assert.throws(() => svc.save({ name: "Empty", content: "   " }), /cannot be empty/);

        const created = svc.save({
            name: "Bug Triage",
            category: "Debug",
            description: "Investigate failing specs",
            content: "Run the failing suite and summarize root cause.",
            mode: "prompt",
            effort: "high"
        });
        assert.ok(created.id.startsWith("tpl-bug-triage-"));
        assert.throws(() => svc.save({ name: "bug triage", content: "dup" }), /already exists/);
        assert.equal(svc.search("failing").length, 1);

        const exported = svc.exportJson();
        assert.ok(exported.includes("Bug Triage"));
        const parsed = JSON.parse(exported);
        assert.equal(parsed.version, 1);
        assert.equal(parsed.templates.length, 1);

        const imported = svc.importJson(JSON.stringify({
            templates: [
                { name: "Code Review", content: "Check types and tests.", category: "Review" }
            ]
        }));
        assert.equal(imported.imported, 1);
        assert.equal(svc.list().length, 2);
        assert.equal(svc.get("Code Review").category, "Review");

        assert.throws(() => svc.importJson("not-json"), /Invalid JSON format/);
        assert.throws(() => svc.importJson(JSON.stringify([])), /No templates found/);

        svc.remove(svc.get("Code Review").id);

        const used = svc.recordUse(created.id);
        assert.equal(used.usageCount, 1);
        assert.equal(svc.remove(created.id), true);
        assert.equal(svc.list().length, 0);

        /* live Templates modal + header dropdown menu button + New/Edit Template modal + slash integration */
        const task = document.getElementById("task");
        task.value = "Audit auth middleware and write regression tests.";

        assert.equal(document.getElementById("templatesDropdown"), null, "templates dropdown element removed");
        const templatesBtn = document.getElementById("templatesButton");
        assert.ok(templatesBtn, "templates button exists");
        assert.ok(templatesBtn.closest("#consoleMenu .bar-nav"), "templates button lives inside the header dropdown menu");

        templatesBtn.dispatch("click");
        assert.equal(backdrops().length, 1, "clicking Templates opens the Templates modal");
        const templatesDialog = () => document.querySelector(".modal.templates-modal");
        let listModal = templatesDialog();
        assert.ok(listModal, "Templates modal rendered");
        assert.match(listModal.textContent, /Task Templates/);
        assert.ok(listModal.querySelector(".template-new-btn"), "New template button lives inside the Templates modal");

        /* clicking New template opens separate editor modal on top */
        listModal.querySelector(".template-new-btn").dispatch("click");
        assert.equal(backdrops().length, 2, "New Template modal opens above Templates modal");
        const dialog = [...document.body.children]
            .filter(child => child.classList.contains("modal-backdrop"))
            .at(-1).children[0];
        assert.ok(dialog.classList.contains("template-editor-modal"));
        assert.match(dialog.textContent, /New Template/);

        const nameInput = dialog.querySelector(".template-name-input");
        const categoryInput = dialog.querySelector(".template-category-input");
        const descInput = dialog.querySelector(".template-desc-input");
        const contentInput = dialog.querySelector(".template-content-input");
        const modeSelect = dialog.querySelector(".template-mode-select");
        const effortSelect = dialog.querySelector(".template-effort-select");
        assert.equal(contentInput.value, "Audit auth middleware and write regression tests.");

        nameInput.value = "Auth Audit";
        categoryInput.value = "Security";
        descInput.value = "Review auth checks";
        modeSelect.value = "plan";
        effortSelect.value = "high";
        dialog.querySelector(".templates-form").dispatch("submit");
        assert.equal(backdrops().length, 1, "saving closes New Template modal and keeps Templates modal open");

        /* verify list, search filter, and load inside Templates modal */
        listModal = templatesDialog();
        assert.equal(listModal.querySelectorAll(".template-item").length, 1);
        assert.match(listModal.querySelector(".template-item").textContent, /Auth Audit/);
        assert.match(listModal.querySelector(".template-item").textContent, /Security/);

        const searchInput = listModal.querySelector(".templates-search");
        searchInput.value = "nomatch";
        searchInput.dispatch("input");
        assert.equal(listModal.querySelectorAll(".template-item").length, 0);
        searchInput.value = "Security";
        searchInput.dispatch("input");
        assert.equal(listModal.querySelectorAll(".template-item").length, 1);

        /* load into composer */
        task.value = "";
        listModal.querySelector(".template-load-btn").dispatch("click");
        assert.equal(task.value, "Audit auth middleware and write regression tests.");
        assert.equal(document.getElementById("approvalMode").value, "plan");
        assert.equal(document.getElementById("taskEffort").value, "high");
        assert.equal(backdrops().length, 0, "loading a template closes the Templates modal");

        /* edit opens separate Edit Template modal */
        templatesBtn.dispatch("click");
        listModal = templatesDialog();
        listModal.querySelector(".template-edit-btn").dispatch("click");
        assert.equal(backdrops().length, 2);
        const editDialog = [...document.body.children]
            .filter(child => child.classList.contains("modal-backdrop"))
            .at(-1).children[0];
        assert.ok(editDialog.classList.contains("template-editor-modal"));
        assert.match(editDialog.textContent, /Edit Template/);
        editDialog.querySelector(".template-content-input").value = "Updated audit prompt";
        editDialog.querySelector(".templates-form").dispatch("submit");
        assert.equal(backdrops().length, 1);

        /* verify updated preview in Templates modal & close via Escape / close button */
        assert.match(listModal.querySelector(".template-item-preview").textContent, /Updated audit prompt/);
        Modal.closeTop("test");
        assert.equal(backdrops().length, 0, "closing Templates modal removes backdrop");

        /* /templates <name> slash command loads template into #task without wiping it */
        task.value = "/templates Auth Audit";
        document.getElementById("taskForm").dispatch("submit");
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(task.value, "Updated audit prompt");

        /* reopen modal: Import and Export buttons exist inside Templates modal */
        templatesBtn.dispatch("click");
        listModal = templatesDialog();
        assert.ok(listModal, "reopening Templates modal to test import and export");
        assert.ok(listModal.querySelector(".template-import-btn"), "Import button in Templates modal");
        assert.ok(listModal.querySelector(".template-export-btn"), "Export button in Templates modal");
        assert.ok(listModal.querySelector(".template-import-input"), "hidden file input in Templates modal");

        /* test export */
        listModal.querySelector(".template-export-btn").dispatch("click");
        const msg = listModal.querySelector(".templates-modal-msg");
        assert.ok(!msg.hidden, "Export shows status message");
        assert.match(msg.textContent, /Exported/);

        /* test import file input */
        const fileInput = listModal.querySelector(".template-import-input");
        const mockFile = {
            name: "import.json",
            text: async () => JSON.stringify([
                { name: "Security Sweep", content: "Run security scanners.", category: "Security" }
            ])
        };
        Object.defineProperty(fileInput, "files", { value: [mockFile], configurable: true });
        fileInput.dispatch("change");
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.match(listModal.textContent, /Security Sweep/);

        /* duplicate import prompts for overwrite vs skip */
        const dupFile = {
            name: "dup.json",
            text: async () => JSON.stringify([
                { name: "Security Sweep", content: "Run deep security scanners.", category: "Security" }
            ])
        };
        Object.defineProperty(fileInput, "files", { value: [dupFile], configurable: true });
        fileInput.dispatch("change");
        await new Promise(resolve => setTimeout(resolve, 30));
        const conflictPrompt = listModal.querySelector(".templates-import-conflict");
        assert.ok(conflictPrompt && !conflictPrompt.hidden, "duplicate import opens conflict prompt");
        listModal.querySelector(".template-import-skip-btn").dispatch("click");
        assert.equal(
            listModal.querySelector(".template-item-preview").textContent.includes("Run deep security scanners."),
            false,
            "skip preserves existing template content"
        );

        Object.defineProperty(fileInput, "files", { value: [dupFile], configurable: true });
        fileInput.dispatch("change");
        await new Promise(resolve => setTimeout(resolve, 30));
        listModal.querySelector(".template-import-overwrite-btn").dispatch("click");
        assert.match(listModal.textContent, /Run deep security scanners\./, "overwrite updates existing template content");

        /* search filter resets when Templates modal closes */
        const filterEl = listModal.querySelector(".templates-search");
        filterEl.value = "nomatch";
        filterEl.dispatch("input");
        assert.equal(listModal.querySelectorAll(".template-item").length, 0);
        Modal.closeTop("test");
        assert.equal(backdrops().length, 0);
        templatesBtn.dispatch("click");
        listModal = templatesDialog();
        assert.equal(listModal.querySelector(".templates-search").value, "", "search resets on close");
        assert.equal(listModal.querySelectorAll(".template-item").length, 2, "all templates visible after reopen");

        /* delete confirmation inside Templates modal: Cancel keeps item, Confirm deletes it */
        const beforeCount = listModal.querySelectorAll(".template-item").length;
        listModal.querySelector(".template-delete-btn").dispatch("click");
        assert.ok(listModal.querySelector(".template-confirm-delete-btn"), "confirm delete button appears");
        listModal.querySelector(".template-cancel-delete-btn").dispatch("click");
        assert.equal(listModal.querySelectorAll(".template-item").length, beforeCount, "Cancel preserves template");

        while (listModal.querySelector(".template-delete-btn")) {
            listModal.querySelector(".template-delete-btn").dispatch("click");
            listModal.querySelector(".template-confirm-delete-btn").dispatch("click");
        }
        assert.equal(listModal.querySelectorAll(".template-item").length, 0);
        assert.equal(backdrops().length, 1, "deleting templates keeps the Templates modal open");
        Modal.closeTop("test");
        assert.equal(backdrops().length, 0);

        /* LLM settings modal has Reload and Close footer buttons */
        const llmBtn = document.getElementById("llmSettingsButton");
        if (llmBtn) {
            llmBtn.dispatch("click");
            await new Promise(resolve => setTimeout(resolve, 10));
            const llmDialog = backdrops().at(-1);
            const footerLabels = [...llmDialog.querySelectorAll(".modal-foot button")].map(b => b.textContent.trim());
            assert.deepEqual(footerLabels, ["Reload", "Close"]);
            Modal.closeTop("test");
        }

        const modeEl = document.getElementById("approvalMode");
        modeEl.value = "auto";
        modeEl.dispatch("change");
        const effortEl = document.getElementById("taskEffort");
        effortEl.value = "inherit";
        effortEl.dispatch("change");
        task.value = "";
        task.dispatch("input");
    });

    await test("history groups conversations by project and workspace and supports filtering", async () => {

        console_.reply("/api/projects", {
            projects: [
                { id: "prj-api", name: "API Service", rootPath: "/repos/api-service" }
            ]
        });
        console_.reply("/api/sessions", {
            current: "s-api-1",
            sessions: [
                {
                    id: "s-api-1",
                    title: "Fix auth endpoint",
                    project_id: "prj-api",
                    project_name: "API Service",
                    workspace: "/repos/api-service",
                    turns: 2,
                    events: 4,
                    updated_at: "2026-11-27T10:00:00.000Z"
                },
                {
                    id: "s-ws-a",
                    title: "Default repo cleanup",
                    project_id: null,
                    workspace: "/workspace/main",
                    turns: 1,
                    events: 2,
                    updated_at: "2026-11-26T10:00:00.000Z"
                },
                {
                    id: "s-ws-b",
                    title: "Standalone scripts audit",
                    project_id: null,
                    workspace: "/repos/scripts",
                    turns: 3,
                    events: 6,
                    updated_at: "2026-11-25T10:00:00.000Z"
                }
            ]
        });

        document.getElementById("historyButton").dispatch("click");
        try {
            await new Promise(resolve => setTimeout(resolve, 15));

            const dialog = backdrops().at(-1).children[0];
            const groups = [...dialog.querySelectorAll(".history-group")];
            assert.equal(groups.length, 3, "renders separate groups for the project and each distinct workspace");
            assert.match(groups[0].textContent, /API Service/);
            assert.match(groups[0].textContent, /Fix auth endpoint/);

            const scopeFilter = dialog.querySelector(".history-scope-filter");
            assert.ok(scopeFilter, "renders project/workspace filter dropdown when multiple groups exist");
            scopeFilter.value = "workspace:/repos/scripts";
            scopeFilter.dispatch("change");
            assert.equal(dialog.querySelectorAll(".history-group").length, 1);
            assert.match(dialog.querySelector(".history-group").textContent, /Standalone scripts audit/);

            scopeFilter.value = "all";
            scopeFilter.dispatch("change");
            assert.equal(dialog.querySelectorAll(".history-group").length, 3);

            const search = dialog.querySelector(".history-search");
            search.value = "auth endpoint";
            search.dispatch("input");
            assert.equal(dialog.querySelectorAll(".session-row").length, 1);
        } finally {
            Modal.closeTop("test");
        }
    });
};
