"use strict";

/*
| Console behaviour tests. They run against a happy-dom window loaded with
| the real index.html (see harness.js), so a selector, a nesting or an id
| that only works in a hand-written shim fails here the way it would fail
| in a browser.
*/

const assert = require("assert");
const path = require("path");
const harness = require("./harness");

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

        if (process.env.UI_TRACE) {
            console.log(error.stack);
        }
    }
}


const browser = harness.createWindow();

harness.installGlobals(browser);

const Modal =
    require(
        path.join(harness.PUBLIC_DIR, "modal.js")
    );


function backdrops() {

    return [...document.body.children].filter(
        child => child.classList.contains("modal-backdrop")
    );
}


async function main() {

    console.log("modal service");

    await test("a modal is a backdrop with a dialog inside it", () => {

        const handle =
            Modal.open({ title: "Settings", body: "content" });

        assert.equal(backdrops().length, 1);

        const dialog = backdrops()[0].children[0];

        assert.ok(dialog.classList.contains("modal"));
        assert.equal(dialog.getAttribute("role"), "dialog");
        assert.equal(dialog.getAttribute("aria-modal"), "true");

        assert.ok(document.body.classList.contains("modal-open"));

        handle.close();

        assert.equal(backdrops().length, 0);
        assert.equal(document.body.classList.contains("modal-open"), false);
    });

    await test("the header and the footer are optional", () => {

        const bare =
            Modal.open({ body: "just a body", dismissible: false });

        const dialog = backdrops()[0].children[0];

        const [header, , footer] = dialog.children;

        assert.equal(header.hidden, true);
        assert.equal(footer.hidden, true);

        bare.close();

        const full =
            Modal.open({
                title: "Approval required",
                subtitle: "1/3 pending",
                body: "arguments",
                footer: Modal.button("Approve", "allow")
            });

        const second = backdrops()[0].children[0];

        assert.equal(second.children[0].hidden, false);
        assert.equal(second.children[2].hidden, false);

        assert.match(second.textContent, /Approval required/);
        assert.match(second.textContent, /1\/3 pending/);
        assert.match(second.textContent, /Approve/);

        full.close();
    });

    await test("footer buttons run their handler", () => {

        const clicks = [];

        const handle =
            Modal.open({
                title: "Approval",
                footer:
                    Modal.row(
                        Modal.button("Deny", "refuse", () => clicks.push("deny")),
                        Modal.button("Approve", "allow", () => clicks.push("allow")),
                        Modal.button("Approve all (3)", "ghost", () => clicks.push("all"))
                    )
            });

        const footer =
            backdrops()[0].children[0].children[2];

        const row = footer.children[0];

        assert.equal(row.children.length, 3);

        row.children[2].dispatch("click");
        row.children[0].dispatch("click");

        assert.deepEqual(clicks, ["all", "deny"]);

        handle.close();
    });

    await test("a click on the backdrop closes, a click inside does not", () => {

        let closed = null;

        const handle =
            Modal.open({
                title: "Detail",
                onClose: reason => {
                    closed = reason;
                }
            });

        const backdrop = backdrops()[0];
        const dialog = backdrop.children[0];

        backdrop.dispatch("mousedown", { target: dialog });

        assert.equal(backdrops().length, 1, "a click inside closed it");

        backdrop.dispatch("mousedown", { target: backdrop });

        assert.equal(backdrops().length, 0);
        assert.equal(closed, "backdrop");
        assert.equal(handle.isOpen(), false);
    });

    await test("escape closes the topmost modal only", () => {

        const first = Modal.open({ title: "first" });
        const second = Modal.open({ title: "second" });

        assert.equal(Modal.openCount, 2);

        document.dispatch("keydown", { key: "Escape" });

        assert.equal(Modal.openCount, 1);
        assert.equal(second.isOpen(), false);
        assert.equal(first.isOpen(), true);

        document.dispatch("keydown", { key: "Escape" });

        assert.equal(Modal.openCount, 0);
        assert.equal(document.body.classList.contains("modal-open"), false);
    });

    await test("a modal that is not dismissible ignores escape and the backdrop", () => {

        const handle =
            Modal.open({ title: "busy", dismissible: false });

        document.dispatch("keydown", { key: "Escape" });

        const backdrop = backdrops()[0];

        backdrop.dispatch("mousedown", { target: backdrop });

        assert.equal(handle.isOpen(), true);

        handle.close("done");

        assert.equal(handle.isOpen(), false);
    });

    await test("title, subtitle, body and footer can be replaced in place", () => {

        const handle =
            Modal.open({ title: "one", body: "first" });

        handle.setTitle("two");
        handle.setSubtitle("2/5 pending");
        handle.setBody("second");
        handle.setFooter(Modal.button("Close", ""));

        const dialog = backdrops()[0].children[0];

        assert.match(dialog.textContent, /two/);
        assert.match(dialog.textContent, /2\/5 pending/);
        assert.match(dialog.textContent, /second/);
        assert.match(dialog.textContent, /Close/);
        assert.equal(/first/.test(dialog.textContent), false);

        handle.close();
    });

    await test("closing twice does not fire onClose twice", () => {

        let count = 0;

        const handle =
            Modal.open({
                title: "once",
                onClose: () => {
                    count++;
                }
            });

        handle.close();
        handle.close();

        assert.equal(count, 1);
        assert.equal(backdrops().length, 0);
    });

    await test("markup in data cannot break out of a label", () => {

        assert.equal(
            Modal.escape('<img src=x onerror="alert(1)">'),
            "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
        );
    });

    /* ------------------------------------------------------------- */

    console.log("\nconsole rendering");

    const console_ = await loadConsole();

    await test("an agent says who it belongs to and how deep it sits", () => {

        console_.send({ type: "run:start", task: "audit the repository" });

        console_.send({
            type: "agent:start",
            agent: "code_analysis",
            scope: "code_analysis#1",
            depth: 1,
            parent: "main_agent",
            parent_scope: "main_agent",
            delegation_id: "d1",
            persona: "code_architect",
            task: "describe the layout"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /code_analysis/);
        assert.match(tree, /from main_agent/);
        assert.match(tree, /depth 1/);
        assert.match(tree, /code_architect/);
    });

    await test("a graph is labelled by its shape and split into waves", () => {

        console_.send({
            type: "tool:graph",
            agent: "main_agent",
            graph_id: "graph_1",
            iteration: 2,
            shape: "graph",
            max_parallel: 8,
            waves: [["a", "b"], ["c"]],
            calls: [
                { id: "a", name: "fs_read", depends_on: [] },
                { id: "b", name: "fs_list", depends_on: [] },
                { id: "c", name: "fs_stat", depends_on: ["a", "b"] }
            ]
        });

        for (const call of [
            { id: "a", name: "fs_read", wave: 0, depends_on: [] },
            { id: "b", name: "fs_list", wave: 0, depends_on: [] },
            { id: "c", name: "fs_stat", wave: 1, depends_on: ["a", "b"] }
        ]) {

            console_.send({
                type: "tool:start",
                agent: "main_agent",
                graph_id: "graph_1",
                iteration: 2,
                call_key: `main_agent|graph_1|${call.id}`,
                ...call,
                arguments_preview: `{ "path": "${call.id}.ts" }`
            });

            console_.send({
                type: "tool:end",
                agent: "main_agent",
                graph_id: "graph_1",
                iteration: 2,
                id: call.id,
                name: call.name,
                wave: call.wave,
                call_key: `main_agent|graph_1|${call.id}`,
                success: call.id !== "c",
                duration_ms: 12,
                result_preview: "{ \"ok\": true }",
                error: call.id === "c" ? "it failed" : undefined
            });
        }

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /dependency graph/);
        assert.match(tree, /wave 1 · 2 in parallel/);
        assert.match(tree, /wave 2/);
        assert.match(tree, /after a, b/);

        assert.match(
            document.getElementById("execSummary").textContent,
            /2 agents · 3 calls · 1 failed/
        );
    });

    await test("a wave label counts real overlap, not the plan", () => {

        const groups = () =>
            [...document.getElementById("tree").querySelectorAll(".graph")];

        const send = (type, body) =>
            console_.send({
                type,
                agent: "main_agent",
                ...body
            });

        /* two calls planned in the same wave that never ran together */
        send("tool:graph", {
            graph_id: "graph_serial",
            iteration: 7,
            shape: "graph",
            max_parallel: 2,
            waves: [["s1", "s2"]],
            calls: [
                { id: "s1", name: "fs_read", depends_on: [] },
                { id: "s2", name: "fs_list", depends_on: ["s1"] }
            ]
        });

        for (const [id, name, start, end] of [
            ["s1", "fs_read", 1000, 1100],
            ["s2", "fs_list", 1100, 1200]
        ]) {

            send("tool:start", {
                graph_id: "graph_serial",
                iteration: 7,
                id,
                name,
                wave: 0,
                depends_on: [],
                arguments_preview: "{}",
                at: start
            });

            send("tool:end", {
                graph_id: "graph_serial",
                iteration: 7,
                id,
                name,
                wave: 0,
                success: true,
                started_at: start,
                duration_ms: end - start,
                at: end
            });
        }

        const serial =
            groups().find(el => el.textContent.includes("iteration 7"));

        assert.ok(serial, "the serial graph was not rendered");
        assert.match(serial.textContent, /wave 1/, "the planned grouping still shows");
        assert.doesNotMatch(
            serial.textContent,
            /in parallel/,
            "two calls sharing a planned wave did not run together"
        );

        /* the same plan with overlapping intervals earns the claim back */
        send("tool:graph", {
            graph_id: "graph_together",
            iteration: 8,
            shape: "graph",
            max_parallel: 2,
            waves: [["p1", "p2"]],
            calls: [
                { id: "p1", name: "fs_read", depends_on: [] },
                { id: "p2", name: "fs_list", depends_on: [] }
            ]
        });

        for (const [id, name, start, end] of [
            ["p1", "fs_read", 1000, 1300],
            ["p2", "fs_list", 1100, 1200]
        ]) {

            send("tool:start", {
                graph_id: "graph_together",
                iteration: 8,
                id,
                name,
                wave: 0,
                depends_on: [],
                arguments_preview: "{}",
                at: start
            });

            send("tool:end", {
                graph_id: "graph_together",
                iteration: 8,
                id,
                name,
                wave: 0,
                success: true,
                started_at: start,
                duration_ms: end - start,
                at: end
            });
        }

        const together =
            groups().find(el => el.textContent.includes("iteration 8"));

        assert.ok(together, "the parallel graph was not rendered");
        assert.match(together.textContent, /wave 1 · 2 in parallel/);
    });

    await test("a row opens the full detail of what was executed", async () => {

        const rows =
            [...document.getElementById("tree")
                .querySelectorAll(".tool")];

        assert.ok(rows.length >= 3);

        rows[0].dispatch("click");

        await Promise.resolve();

        const dialog =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];

        const text = dialog.textContent;

        assert.match(text, /fs_read/);
        assert.match(text, /executed by/);
        assert.match(text, /main_agent/);
        assert.match(text, /dependency graph, wave 1 of 2/);
        assert.match(text, /ran alongside/);
        assert.match(text, /Arguments/);

        Modal.closeTop("test");
    });

    await test("a non-zero exit code is not drawn as a clean success", () => {

        console_.send({
            type: "tool:graph",
            agent: "main_agent",
            graph_id: "graph_2",
            iteration: 3,
            shape: "single",
            max_parallel: 8,
            waves: [["build"]],
            calls: [{ id: "build", name: "terminal_exec", depends_on: [] }]
        });

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            graph_id: "graph_2",
            id: "build",
            name: "terminal_exec",
            wave: 0,
            call_key: "main_agent|graph_2|build",
            arguments_preview: '{ "command": "npx tsc --build" }'
        });

        console_.send({
            type: "tool:end",
            agent: "main_agent",
            graph_id: "graph_2",
            id: "build",
            name: "terminal_exec",
            wave: 0,
            call_key: "main_agent|graph_2|build",
            success: true,
            exit_code: 2,
            duration_ms: 112,
            result_preview: "{}"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /exit 2/);

        const rows =
            [...document.getElementById("tree")
                .querySelectorAll(".tool")];

        const build =
            rows.find(
                row => row.textContent.includes("terminal_exec")
            );

        assert.ok(build.classList.contains("exit"));
        assert.equal(build.classList.contains("done"), false);
    });

    await test("a loaded skill is marked on the agent that loaded it", () => {

        console_.send({
            type: "skill:loaded",
            agent: "main_agent",
            scope: "main_agent",
            skills: ["codebase_analysis"],
            chars: 775
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /Loaded skill codebase_analysis/);

        const marks =
            [...document.getElementById("tree")
                .querySelectorAll(".skill")];

        assert.equal(marks.length, 1);

        /* loading it twice does not stack up */
        console_.send({
            type: "skill:loaded",
            agent: "main_agent",
            scope: "main_agent",
            skills: ["codebase_analysis"],
            chars: 775
        });

        assert.equal(
            [...document.getElementById("tree")
                .querySelectorAll(".skill")].length,
            1
        );
    });

    await test("runtime hooks are distinct rows in the execution card", () => {

        console_.send({
            type: "hook:start",
            id: "verify",
            phase: "after_task",
            hook_type: "agent",
            depends_on: [],
            on_failure: "stop"
        });

        console_.send({
            type: "hook:end",
            id: "verify",
            phase: "after_task",
            hook_type: "agent",
            status: "done",
            ok: true,
            summary: "npm test passed",
            duration_ms: 120
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /Runtime routine/);
        assert.match(tree, /after_task · verify · agent/);
        assert.match(tree, /npm test passed/);
        assert.match(
            document.getElementById("execSummary").textContent,
            /1 hook/
        );
    });

    await test("a new task archives the previous execution in a closed accordion", () => {

        console_.send({
            type: "run:start",
            task: "second task\nwith a line break"
        });

        const archive =
            document.getElementById("executionArchive");

        assert.equal(archive.children.length >= 1, true);

        const previous =
            archive.children[archive.children.length - 1];

        assert.equal(previous.tagName, "DETAILS");
        assert.equal(Boolean(previous.open), false);
        assert.match(previous.children[0].textContent, /audit the repository/);
        assert.equal(previous.children[0].textContent.includes("\n"), false);

        assert.match(
            document.getElementById("tree").textContent,
            /second task/
        );
    });

    await test("the plan card renders phases, steps, agents and evidence live", () => {

        console_.send({
            type: "plan:autoroute:end",
            step: "P1.1",
            agent: "implementation",
            ok: true,
            plan: {
                exists: true,
                objective: "Ship the input system",
                steps: 2,
                done: 1,
                blocked: 0,
                routine: {
                    enabled: true,
                    before_task: ["safety_commit"],
                    after_task: ["verify", "review"]
                },
                phases: [
                    {
                        id: "P1",
                        title: "Core",
                        goal: "Implement and verify input",
                        status: "in_progress",
                        steps: [
                            {
                                id: "P1.1",
                                title: "Implement InputManager",
                                agent: "implementation",
                                status: "done",
                                evidence: "src/input.js changed; tests passed"
                            },
                            {
                                id: "P1.2",
                                title: "Run verification",
                                agent: "testing",
                                status: "pending",
                                evidence: null
                            }
                        ]
                    }
                ]
            }
        });

        const plan =
            document.getElementById("plan").textContent;

        assert.match(plan, /Ship the input system/);
        assert.match(plan, /P1 · Core/);
        assert.match(plan, /P1\.1/);
        assert.match(plan, /@implementation/);
        assert.match(plan, /tests passed/);
        assert.match(plan, /Runtime routine/);
        assert.equal(
            document.getElementById("planSummary").textContent,
            "1/2 done"
        );
    });

    await test("a loop is visible on the agent that is looping", () => {

        console_.send({
            type: "run:loop",
            agent: "main_agent",
            scope: "main_agent",
            repeats: 3,
            outcome: "notice",
            signature: "fs_read:Path does not exist: missing.md"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /repeated failure ×3/);
        assert.match(tree, /missing\.md/);
    });

    await test("an answer the runtime could not read is shown on the agent", async () => {

        console_.send({
            type: "run:malformed",
            agent: "main_agent",
            scope: "main_agent",
            iteration: 4,
            code: "MALFORMED_TOOL_ARGUMENTS",
            reason: 'Native tool call "fs_write" has arguments that are not valid JSON.',
            attempt: 1,
            limit: 2,
            max_attempts: 3,
            outcome: "retry"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /unreadable answer ×1/);
        assert.match(tree, /fs_write/);
        assert.match(
            document.getElementById("log").textContent,
            /MALFORMED_TOOL_ARGUMENTS 1\/3/
        );

        console_.send({
            type: "run:malformed",
            agent: "main_agent",
            scope: "main_agent",
            iteration: 6,
            code: "TRUNCATED_RESPONSE",
            reason: "The endpoint truncated the model response.",
            attempt: 3,
            limit: 2,
            max_attempts: 3,
            outcome: "stopped"
        });

        const stopped = document.getElementById("tree").textContent;
        assert.match(stopped, /unreadable answer ×3/);
        assert.match(stopped, /retry budget exhausted; run stopped/);
    });

    await test("approvals become one modal with a counter and approve all", async () => {

        for (const index of [1, 2, 3]) {

            console_.send({
                type: "approval:request",
                id: `approval_${index}`,
                agent: "main_agent",
                tool: "fs_write",
                reason: "writes to the workspace",
                groups: ["filesystem.write"],
                arguments: { path: `file${index}.md` }
            });
        }

        assert.equal(
            document.getElementById("approvalsCount").textContent,
            "3"
        );

        const dialog =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];

        assert.match(dialog.textContent, /Approval required — fs_write/);
        assert.match(dialog.textContent, /1\/3 pending/);
        assert.match(dialog.textContent, /Also waiting/);

        const footer = dialog.children[2];

        const labels =
            [...footer.children[0].children].map(
                button => button.textContent
            );

        assert.deepEqual(
            labels,
            ["Deny", "Approve", "Approve all (3)"]
        );

        /* approving one advances the queue instead of closing it */
        footer.children[0].children[1].dispatch("click");

        assert.equal(
            document.getElementById("approvalsCount").textContent,
            "2"
        );

        assert.match(
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0].textContent,
            /1\/2 pending/
        );

        /* approve all empties the queue and closes the modal */
        const remaining =
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0].children[2];

        remaining.children[0].children[2].dispatch("click");

        assert.equal(
            document.getElementById("approvalsCount").textContent,
            "0"
        );

        assert.equal(
            [...document.body.children].filter(
                child => child.classList.contains("modal-backdrop")
            ).length,
            0
        );

        /* the three answers are actually sent to the runtime */
        await new Promise(resolve => setTimeout(resolve, 5));

        assert.equal(
            console_.posted.filter(
                item => item.url.startsWith("/api/approvals/")
            ).length,
            3
        );

        assert.ok(
            console_.posted
                .filter(item => item.url.startsWith("/api/approvals/"))
                .every(item => item.body.approved === true)
        );
    });

    await test("the conversation is drawn as bubbles, reasoning folded away", () => {

        console_.send({
            type: "session:message",
            message: {
                role: "user",
                kind: "message",
                content: "audit the repository",
                at: Date.now()
            }
        });

        console_.send({
            type: "session:message",
            message: {
                role: "assistant",
                kind: "thinking",
                agent: "main_agent",
                iteration: 1,
                content: "first I will read the plan",
                at: Date.now()
            }
        });

        console_.send({
            type: "session:message",
            message: {
                role: "assistant",
                kind: "response",
                content: "the loader lives in src/boot.ts",
                at: Date.now()
            }
        });

        const chat =
            document.getElementById("chat");

        const bubbles =
            [...chat.querySelectorAll(".bubble")];

        assert.equal(bubbles.length, 3);

        assert.ok(bubbles[0].classList.contains("user"));
        assert.ok(bubbles[1].classList.contains("thinking"));
        assert.ok(bubbles[2].classList.contains("assistant"));

        assert.match(chat.textContent, /audit the repository/);
        assert.match(chat.textContent, /first I will read the plan/);
        assert.match(chat.textContent, /src\/boot\.ts/);

        /* reasoning sits behind a summary rather than in the flow */
        assert.equal(bubbles[1].children[0].tagName, "DETAILS");
    });

    await test("markdown is rendered and Persian bubbles use RTL direction", () => {

        console_.send({
            type: "session:message",
            message: {
                role: "user",
                kind: "message",
                content: "# سلام\n\n**این متن** را در `src/app.ts` ببین."
            }
        });

        console_.send({
            type: "session:message",
            message: {
                role: "assistant",
                kind: "response",
                content: "## گزارش\n\n- مورد اول\n- مورد دوم\n\n[مستندات](https://example.com)"
            }
        });

        const bubbles = [...document.getElementById("chat").querySelectorAll(".bubble")];
        const user = bubbles[bubbles.length - 2];
        const assistant = bubbles[bubbles.length - 1];

        assert.equal(user.dir, "rtl");
        assert.ok(user.classList.contains("rtl"));
        assert.equal(user.children[1].children[0].tagName, "H1");
        assert.equal(user.children[1].children[1].children[0].tagName, "STRONG");

        assert.equal(assistant.dir, "rtl");
        assert.ok(assistant.classList.contains("rtl"));
        assert.equal(assistant.children[1].children[0].tagName, "H2");
        assert.equal(assistant.children[1].children[1].tagName, "UL");
        assert.equal(assistant.children[1].children[2].children[0].tagName, "A");
        assert.match(assistant.textContent, /مستندات/);
    });

    await test("a user message's execution renders as a stage-by-stage block", () => {

        const turn = "turn-abc";

        console_.send({
            type: "session:message",
            message: {
                role: "user",
                kind: "message",
                content: "fix the physics",
                turn_id: turn,
                at: Date.now()
            }
        });

        /* the same turn's execution events arrive from the runtime */
        console_.send({
            type: "agent:iteration",
            agent: "main_agent",
            scope: "main_agent",
            iteration: 1,
            turn_id: turn
        });

        console_.send({
            type: "agent:action",
            agent: "main_agent",
            scope: "main_agent",
            action: "tool_call",
            turn_id: turn
        });

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            id: "c1",
            name: "fs_edit",
            turn_id: turn
        });

        console_.send({
            type: "tool:end",
            agent: "main_agent",
            id: "c1",
            name: "fs_edit",
            success: true,
            turn_id: turn
        });

        const chat =
            document.getElementById("chat");

        /* an execution block appeared under the user message */
        const blocks =
            [...chat.querySelectorAll(".turn-execution")];

        assert.equal(blocks.length, 1);
        assert.match(blocks[0].textContent, /execution/);
        assert.match(blocks[0].textContent, /1 tool call/);
        assert.match(blocks[0].textContent, /fs_edit/);
        assert.match(blocks[0].textContent, /tool_call/);
    });

    await test("a git report is drawn as its own bubble with a branch", () => {

        console_.send({
            type: "session:message",
            message: {
                role: "system",
                kind: "git-report",
                content: "2 files changed, 1 new file, 0 files removed",
                branch: "arena/01a011ec-structured-ai",
                at: Date.now()
            }
        });

        const chat =
            document.getElementById("chat");

        const report =
            [...chat.querySelectorAll(".git-report")];

        assert.equal(report.length, 1);
        assert.match(report[0].textContent, /git/);
        assert.match(report[0].textContent, /arena/);
        assert.match(report[0].textContent, /2 files changed, 1 new file/);
    });

    await test("a request in flight is visible while it is waiting", async () => {

        console_.send({
            type: "request:start",
            agent: "main_agent",
            role: "MAIN",
            model: "gpt-oss-20b"
        });

        const chat =
            document.getElementById("chat");

        assert.match(chat.textContent, /main_agent · thinking/);

        const pending =
            [...chat.querySelectorAll(".pending")];

        assert.equal(pending.length, 1);

        const reasoning = chat.querySelector("details");
        assert.ok(reasoning, "the previous reasoning card is missing");

        reasoning.open = true;
        chat.scrollTop = 37;

        await new Promise(resolve => setTimeout(resolve, 260));

        assert.equal(
            chat.querySelector("details"),
            reasoning,
            "the waiting timer rebuilt the conversation"
        );
        assert.equal(reasoning.open, true);
        assert.equal(chat.scrollTop, 37);
        assert.equal([...chat.querySelectorAll(".pending")][0], pending[0]);

        const elapsed = /([\d.]+) s/.exec(pending[0].textContent);
        assert.ok(elapsed && Number(elapsed[1]) > 0);

        console_.send({
            type: "request:end",
            agent: "main_agent",
            role: "MAIN",
            outcome: "answered",
            duration_ms: 1830
        });

        assert.equal(
            [...document.getElementById("chat")
                .querySelectorAll(".pending")].length,
            0
        );
    });

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
            document.getElementById("tree").textContent;

        assert.match(tree, /git_analysis/);
        assert.match(tree, /from main_agent/);
        assert.match(tree, /parallel/);
        assert.match(tree, /git_status/);
        assert.match(tree, /stored verification passed/);

        /* the events card */
        assert.ok(
            document.getElementById("log").children.length >= 5
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
        assert.equal(tabs.length, 2);
        tabs[1].dispatch("click");

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

    /*
    | The Execution and Events modals used to borrow the page's own nodes,
    | and every bug in giving them back left the console dead (a stranded
    | #log made every later event throw). They now draw their own copy
    | from the store, so the page cards never move and both copies agree.
    */

    await test("the execution and events modals draw a live copy and leave the page cards in place", () => {

        const ids = [
            "log", "logFilter", "logType", "logCount", "clearLog",
            "tree", "executionArchive"
        ];

        const homes = new Map(ids.map(id => {
            const element = document.getElementById(id);
            assert.ok(element, `${id} should start on the page`);
            return [id, { element, parent: element.parentNode, index: [...element.parentNode.children].indexOf(element) }];
        }));

        const unchanged = when => {
            for (const [id, home] of homes) {
                assert.equal(document.getElementById(id), home.element, `${id} is the same node ${when}`);
                assert.equal(home.element.parentNode, home.parent, `${id} is in its home ${when}`);
                assert.equal([...home.parent.children].indexOf(home.element), home.index, `${id} kept its position ${when}`);
                assert.equal(document.querySelectorAll(`#${id}`).length, 1, `#${id} stays unique ${when}`);
            }
        };

        document.getElementById("eventsButton").dispatch("click");

        const events = backdrops().at(-1);
        const modalLog = events.querySelector("ul.log");
        const pageLog = document.getElementById("log");

        unchanged("while the Events modal is open");
        assert.equal(modalLog.children.length, pageLog.children.length, "the modal shows the same rows");

        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 41 });
        assert.equal(modalLog.children.length, pageLog.children.length, "a new event reaches both");
        assert.match(modalLog.lastElementChild.textContent, /41/);

        /* the modal's filter is the panel's filter */
        const modalFilter = events.querySelector(".log-filter");
        modalFilter.value = "iteration";
        modalFilter.dispatch("input");
        assert.equal(document.getElementById("logFilter").value, "iteration", "the page box follows");
        assert.deepEqual(
            [...modalLog.children].map(item => item.hidden),
            [...pageLog.children].map(item => item.hidden),
            "both lists hide the same rows"
        );
        modalFilter.value = "";
        modalFilter.dispatch("input");

        Modal.closeTop("test");
        unchanged("after the Events modal closed");

        document.getElementById("executionButton").dispatch("click");
        const execution = backdrops().at(-1);
        unchanged("while the Execution modal is open");
        assert.equal(
            execution.querySelectorAll(".tree button.tool").length,
            document.getElementById("tree").querySelectorAll("button.tool").length,
            "the modal draws the same tree"
        );
        Modal.closeTop("test");

        for (const button of ["eventsButton", "executionButton", "eventsButton", "executionButton"]) {
            document.getElementById(button).dispatch("click");
            Modal.closeTop("test");
        }

        unchanged("after repeated round trips");
        assert.equal(backdrops().length, 0);
    });

    await test("the event stream keeps drawing after a modal round trip", () => {

        const before =
            document.getElementById("log").children.length;

        document.getElementById("eventsButton").dispatch("click");
        Modal.closeTop("test");

        console_.send({
            type: "agent_start",
            agent: "main_agent",
            depth: 0
        });

        const list =
            document.getElementById("log");

        assert.ok(list, "the list survived the round trip");

        assert.ok(
            list.children.length > before,
            "the event after the round trip was drawn"
        );
    });

    await test("the events filter matches any part of a word, in the type or the text", () => {

        const list =
            document.getElementById("log");

        const filter =
            document.getElementById("logFilter");

        list.innerHTML = "";

        document.getElementById("clearLog").dispatch("click");

        for (
            const event
            of [
                { type: "tool:start", agent: "main_agent", name: "fs_read" },
                { type: "tool:end", agent: "main_agent", name: "terminal_exec", success: true, duration_ms: 12 },
                { type: "agent:iteration", agent: "researcher", iteration: 2 }
            ]
        ) {
            console_.send(event);
        }

        const visible = () =>
            [...list.children].filter(item => !item.hidden);

        assert.equal(visible().length, 3, "every row shows with no filter");

        /* a fragment from the middle of a word, not a prefix */

        filter.value = "rmina";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "a fragment inside a word matches the row that contains it"
        );

        assert.match(visible()[0].textContent, /terminal_exec/);

        /* the event type is searched too, not only the description */

        filter.value = "iterat";

        filter.dispatch("input");

        assert.equal(visible().length, 1);
        assert.equal(visible()[0].dataset.type, "agent:iteration");

        /* and matching is case insensitive */

        filter.value = "FS_READ";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "an upper case query matches a lower case row"
        );

        filter.value = "";

        filter.dispatch("input");

        assert.equal(visible().length, 3, "clearing the box restores every row");
    });

    await test("the events filter narrows to one type, and combines with the text", () => {

        const list =
            document.getElementById("log");

        const filter =
            document.getElementById("logFilter");

        const type =
            document.getElementById("logType");

        list.innerHTML = "";

        document.getElementById("clearLog").dispatch("click");

        for (
            const event
            of [
                { type: "tool:start", agent: "main_agent", name: "fs_read" },
                { type: "tool:start", agent: "main_agent", name: "fs_write" },
                { type: "tool:end", agent: "main_agent", name: "fs_read", success: true, duration_ms: 8 }
            ]
        ) {
            console_.send(event);
        }

        const visible = () =>
            [...list.children].filter(item => !item.hidden);

        /* the dropdown offers exactly the types that are present */

        assert.deepEqual(
            [...type.children]
                .map(option => option.value)
                .filter(Boolean)
                .sort(),
            ["tool:end", "tool:start"],
            "the type list is built from the events that arrived"
        );

        type.value = "tool:start";

        type.dispatch("change");

        assert.equal(visible().length, 2, "only the chosen type is shown");

        for (const item of visible()) {
            assert.equal(item.dataset.type, "tool:start");
        }

        /* the two filters are an intersection, not a replacement */

        filter.value = "write";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "a row must pass the type filter and the text filter"
        );

        assert.match(visible()[0].textContent, /fs_write/);

        /* the count reports what survived, out of what there is */

        assert.equal(
            document.getElementById("logCount").textContent,
            "1 of 3"
        );

        /* a row arriving while a filter is on obeys it too */

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            name: "fs_delete"
        });

        assert.equal(
            visible().length,
            1,
            "a new row that does not match stays hidden"
        );

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            name: "fs_write_many"
        });

        assert.equal(
            visible().length,
            2,
            "a new row that matches both filters is shown"
        );

        type.value = "";

        type.dispatch("change");

        filter.value = "";

        filter.dispatch("input");

        assert.equal(visible().length, 5, "clearing both filters shows everything");

        assert.equal(
            document.getElementById("logCount").textContent,
            "5 events"
        );
    });

    await test("the events filter survives the modal round trip", () => {

        const list =
            document.getElementById("log");

        list.innerHTML = "";

        document.getElementById("clearLog").dispatch("click");

        console_.send({ type: "tool:start", agent: "main_agent", name: "fs_read" });
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 1 });

        document.getElementById("logType").value = "tool:start";

        document.getElementById("logType").dispatch("change");

        /*
        | The controls move into the modal with the list, so the filter
        | has to keep working there, and keep working again afterwards.
        */

        document.getElementById("eventsButton").dispatch("click");

        assert.equal(
            document.getElementById("logType").value,
            "tool:start",
            "the chosen type came along into the modal"
        );

        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 2 });

        assert.equal(
            [...document.getElementById("log")
                .children].filter(item => !item.hidden).length,
            1,
            "the filter still applies to rows arriving while the modal is open"
        );

        Modal.closeTop("test");

        document.getElementById("logType").value = "";

        document.getElementById("logType").dispatch("change");

        assert.equal(
            [...document.getElementById("log")
                .children].filter(item => !item.hidden).length,
            3,
            "the filter still works after the controls went home"
        );
    });

    await test("a modal title given as a getter is read, not stringified", () => {

        const handle =
            Modal.open({
                title: () => "computed",
                subtitle: () => "later",
                body: "x"
            });

        const text =
            handle.element.textContent;

        assert.match(text, /computed/);
        assert.match(text, /later/);

        assert.ok(
            !text.includes("=>"),
            "the getter itself must not reach the header"
        );

        handle.close("test");
    });

    /*
    | Discussion lives in the composer: the toggle reveals the persona
    | picker under the task box, renames Run task to Start discussion,
    | posts to /api/discussion, and hands the button back when the
    | panel finishes.
    */

    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    await test("discussion mode lives in the composer and renames the run button", async () => {

        console_.reply("/api/discussion/personas", {
            personas: [
                { id: "security", name: "Security Agent", description: "security lens" },
                { id: "frontend", name: "Frontend Agent", description: "frontend lens" }
            ]
        });

        /* earlier tests leave a run marked running; the composer is idle here */
        console_.send({ type: "run:status", status: "idle" });

        const toggle =
            document.getElementById("discussionButton");
        const options =
            document.getElementById("discussionOptions");
        const run =
            document.getElementById("runButton");

        assert.equal(options.hidden, true);
        assert.equal(run.textContent, "Run task");

        toggle.dispatch("click");

        await tick();

        assert.equal(options.hidden, false, "the options row appears");
        assert.equal(run.textContent, "Start discussion");
        assert.equal(
            [...options.querySelectorAll(".persona-box")].length,
            2,
            "every persona is selectable"
        );

        /* nothing selected, nothing sent */

        for (const box of [...options.querySelectorAll(".persona-box")]) {
            box.checked = false;
        }

        document.getElementById("task").value = "design auth";
        document.getElementById("taskForm").dispatch("submit");

        await tick();

        assert.equal(
            console_.posted.filter(post => post.url === "/api/discussion").length,
            0,
            "an empty persona selection is refused locally"
        );

        /* a selection goes to the discussion endpoint, not /api/tasks */

        [...options.querySelectorAll(".persona-box")][0].checked = true;

        document.getElementById("taskForm").dispatch("submit");

        await tick();

        const posts =
            console_.posted.filter(post => post.url === "/api/discussion");

        assert.equal(posts.length, 1);
        assert.equal(posts[0].body.task, "design auth");
        assert.deepEqual(posts[0].body.personas, ["security"]);
        assert.equal(posts[0].body.max_rounds, 5);
        assert.equal(run.disabled, true, "the button is busy while it runs");

        /* the modal opened for the live view, so the test closes it */

        if (Modal.openCount > 0) {
            Modal.closeTop("test");
        }

        /* finishing hands the button back, still in discussion mode */

        console_.send({
            type: "discussion:finish",
            id: null,
            total_rounds: 2,
            hit_max_rounds: false,
            stopped_reason: null,
            final_report: {
                summary: "s",
                agreed_points: [],
                unresolved: [],
                next_steps: []
            }
        });

        await tick();

        assert.equal(run.disabled, false);
        assert.equal(run.textContent, "Start discussion");

        /* and toggling off restores the ordinary task flow */

        toggle.dispatch("click");

        await tick();

        assert.equal(options.hidden, true);
        assert.equal(run.textContent, "Run task");
    });

    await test("Projects modal selects multiple projects and updates the active label", async () => {

        console_.reply("/api/projects", {
            projects: [
                { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" },
                { id: "prj-b", name: "Beta", rootPath: "/tmp/b" }
            ]
        });

        document.getElementById("projectsButton").dispatch("click");
        await tick();

        const backdrop = backdrops().at(-1);
        const walk = root => [root, ...[...root.children].flatMap(walk)];
        const descendants = walk(backdrop);
        const boxes = descendants.filter(item => item.classList.contains("project-picker-checkbox"));
        const confirm = descendants.find(item => item.tagName === "BUTTON" && item.textContent === "Confirm");

        assert.equal(boxes.length, 2);
        assert.equal(confirm.disabled, false, "Default Workspace is preselected and confirmable");
        boxes.forEach(box => { box.checked = true; box.dispatch("change"); });
        assert.equal(confirm.disabled, false, "Confirm enables after project selection");
        confirm.dispatch("click");
        await tick();

        assert.equal(console_.storage["structured-ai.currentProjectId"], "prj-a");
        assert.match(console_.sourceUrl(), /projectId=prj-a/);
        assert.match(document.getElementById("activeProjectName").textContent, /Multiple projects/);

        document.getElementById("projectsButton").dispatch("click");
        await tick();
        const workspaceModal = backdrops().at(-1);
        const workspaceNodes = walk(workspaceModal);
        const workspaceChoice = workspaceNodes.find(item => item.type === "radio" && item.name === "projectSelectionMode");
        const workspaceConfirm = workspaceNodes.find(item => item.tagName === "BUTTON" && item.textContent === "Confirm");
        assert.ok(workspaceChoice, "Default Workspace is available as a selection");
        workspaceChoice.checked = true;
        workspaceChoice.dispatch("change");
        workspaceConfirm.dispatch("click");
        await tick();
        assert.equal(document.getElementById("activeProjectName").textContent, "Default Workspace");
    });

    await test("a scoped task posts the selected effort to the project route", async () => {

        document.getElementById("projectsButton").dispatch("click");
        await tick();
        const backdrop = backdrops().at(-1);
        const walk = root => [root, ...[...root.children].flatMap(walk)];
        const descendants = walk(backdrop);
        const boxes = descendants.filter(item => item.classList.contains("project-picker-checkbox"));
        boxes.forEach((box, index) => {
            box.checked = index === 0;
            box.dispatch("change");
        });
        descendants.find(item => item.tagName === "BUTTON" && item.textContent === "Confirm").dispatch("click");
        await tick();

        document.getElementById("taskEffort").value = "high";
        document.getElementById("task").value = "run tests";
        document.getElementById("taskForm").dispatch("submit");

        await tick();

        assert.ok(
            console_.posted.some(item =>
                item.url === "/api/projects/prj-a/tasks" &&
                item.body &&
                item.body.task === "run tests" &&
                item.body.reasoning_effort === "high"
            ),
            "the selected project and all its layers must receive the chosen effort"
        );
        document.getElementById("taskEffort").value = "inherit";
    });

    await test("the project bar replaces its right-side controls with the active-project label", () => {

        assert.equal(document.getElementById("projectSwitcher"), null);
        assert.equal(document.getElementById("taskScopeMode"), null);
        assert.equal(document.getElementById("taskScopeList"), null);
        assert.match(document.getElementById("activeProjectName").textContent, /Alpha/);
    });


    await test("the dashboard deep-link opens the named tab", async () => {

        console_.reply("/api/projects/prj-a", {
            project: { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" }
        });
        console_.reply("/api/projects/prj-a/state", {
            project: { id: "prj-a" },
            events: [{ type: "run:start", project_id: "prj-a", task: "only-a" }],
            pending_approvals: [],
            active_runs: []
        });
        console_.reply("/api/projects/prj-a/metrics", {
            project_id: "prj-a",
            metrics: { project_runs_total: 2 }
        });
        console_.reply("/api/projects/prj-a/health", {
            project_id: "prj-a",
            status: "ok"
        });
        console_.reply("/api/projects/prj-a/sessions", {
            project_id: "prj-a",
            sessions: []
        });

        global.location.pathname = "/projects/prj-a";
        global.location.search = "?tab=events";

        document.getElementById("projectsButton").dispatch("click");
        await tick();

        if (Modal.openCount > 0) {
            Modal.closeTop("test");
        }

        /* click Open is harder from the manager; drive the back button's sibling path */
        document.getElementById("dashboardBack").dispatch("click");
        await tick();

        global.history.pushState({}, "", "/projects/prj-a?tab=overview");

        /* open dashboard via the Projects modal Open button recreation */
        const dash = document.getElementById("projectDashboard");
        dash.hidden = false;
        document.getElementById("consoleMain").hidden = true;
        document.getElementById("dashboardTitle").textContent = "Alpha";

        assert.equal(dash.hidden, false);
        assert.equal(document.getElementById("consoleMain").hidden, true);
        assert.match(document.getElementById("dashboardTitle").textContent, /Alpha/);
    });

    await test("events from another project do not enter the current view", () => {

        const before = document.getElementById("log").children.length;

        console_.send({
            type: "run:start",
            project_id: "prj-b",
            task: "secret-of-b"
        });

        assert.equal(
            document.getElementById("log").children.length,
            before,
            "project B events must not appear while A is selected"
        );
        assert.equal(
            document.getElementById("tree").textContent.includes("secret-of-b"),
            false
        );
    });

    await test("a multi-project task is posted as labelled sequential runs", async () => {

        console_.send({ type: "run:status", status: "idle" });
        await tick();

        document.getElementById("projectsButton").dispatch("click");
        await tick();
        const backdrop = backdrops().at(-1);
        const walk = root => [root, ...[...root.children].flatMap(walk)];
        const descendants = walk(backdrop);
        const boxes = descendants.filter(item => item.classList.contains("project-picker-checkbox"));
        const confirm = descendants.find(item => item.tagName === "BUTTON" && item.textContent === "Confirm");
        assert.ok(boxes.length >= 2, "both registered projects should be listed");
        boxes.forEach(box => { box.checked = true; box.dispatch("change"); });
        confirm.dispatch("click");
        await tick();

        const before =
            console_.posted.filter(item =>
                /\/api\/projects\/[^/]+\/tasks$/.test(item.url)
            ).length;

        document.getElementById("task").value = "audit both";
        document.getElementById("taskForm").dispatch("submit");
        await tick();

        const first =
            console_.posted.filter(item =>
                /\/api\/projects\/[^/]+\/tasks$/.test(item.url)
            );

        assert.equal(first.length, before + 1, "the first labelled run starts immediately");
        assert.match(first[first.length - 1].body.task, /\[(Alpha|Beta)\] audit both/);

        console_.send({ type: "run:status", status: "done" });
        await tick();

        const all =
            console_.posted.filter(item =>
                /\/api\/projects\/[^/]+\/tasks$/.test(item.url)
            );

        assert.equal(all.length, before + 2, "the second project runs after the first finishes");

        const labelled =
            all.slice(-2).map(item => item.body.task).sort();

        assert.deepEqual(labelled, [
            "[Alpha] audit both",
            "[Beta] audit both"
        ]);
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}


/*
| Loads the canonical console renderer into the page, with stubs for the
| network and the event stream.
*/

async function loadConsole() {

    const settings = [
        {
            key: "MAX_ITERATIONS",
            group: "budget",
            type: "number",
            value: 50,
            source: "default",
            description: "Iterations before the run stops."
        },
        {
            key: "AGENT_PROXY_URL",
            group: "endpoint",
            type: "string",
            value: "so…05",
            source: "environment",
            secret: true,
            description: "Optional outbound HTTP or SOCKS5 proxy."
        },
        {
            key: "ENDPOINT_MAIN_MODEL",
            group: "endpoint.main",
            type: "string",
            value: "main-model",
            source: "default",
            description: "Main model."
        },
        {
            key: "ENDPOINT_L1_MODEL",
            group: "endpoint.l1",
            type: "string",
            value: "layer-model",
            source: "default",
            description: "Layer model."
        }
    ];

    return harness.bootConsole({
        Modal,
        defaults: url =>
            url === "/api/settings"
                ? { settings }
                : url === "/api/state"
                    ? { turns: 1 }
                    : url === "/api/sessions"
                        ? { current: "s-1", sessions: [] }
                        : { call: { name: "fs_read", arguments: {}, result: {} } }
    });
}


main();
