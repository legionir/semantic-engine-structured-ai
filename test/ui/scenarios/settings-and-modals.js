"use strict";

/*
| Console behaviour — stored conversations, settings, MCP, policy, execution and events modals
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


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

        assert.match(dialog.textContent, /Settings/);
        assert.match(dialog.textContent, /MAX_ITERATIONS/);
        assert.match(dialog.textContent, /applied on next use/);
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
        assert.match(llmDialog.textContent, /LLM settings/);
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
        const header = document.getElementById("approvalMode");

        assert.equal(home.children.length, 2, "both chips are in the header");

        document.getElementById("settingsButton").dispatch("click");

        const dialog = backdrops().at(-1).children[0];

        /* nothing is moved: the header keeps its pair, the modal has its own */
        assert.equal(home.children.length, 2, "the header pair stays where it is");
        assert.equal(document.querySelectorAll("#approvalMode").length, 1, "ids stay unique");
        assert.equal(dialog.querySelectorAll(".policy-row").length, 1, "the policy row is in the modal");

        const settings = dialog.querySelector(".settings");
        assert.ok(settings.children[0].classList.contains("filter"), "filter remains first");
        assert.ok(settings.children[1].classList.contains("runtime-policy-settings"), "policy follows the filter");

        const select = dialog.querySelector(".policy-row select");
        const checkbox = dialog.querySelector(".policy-row input[type=checkbox]");
        assert.equal(select.value, header.value, "the modal shows the mode in effect");
        assert.equal(checkbox.checked, document.getElementById("autoContinue").checked);

        /* a change in the modal is the same action as a change in the header */
        const next = header.value === "deny" ? "prompt" : "deny";
        select.value = next;
        select.dispatch("change");
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(
            console_.posted.some(item => item.url === "/api/approval-mode" && item.body && item.body.mode === next),
            "the change is sent"
        );
        assert.equal(header.value, next, "and the header follows");

        /* the filter hides the policy row when it does not match */
        const filter = settings.children[0];
        filter.value = "max_iter";
        filter.dispatch("input");
        assert.equal(settings.children[1].hidden, true);
        filter.value = "approval";
        filter.dispatch("input");
        assert.equal(settings.children[1].hidden, false);

        Modal.closeTop("test");

        assert.equal(home.children.length, 2);
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
};
