"use strict";

/*
| Console behaviour — the plan, loops, approvals and the conversation bubbles
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


module.exports = async function Conversation({ test, card, console_ }) {

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
            card.tree().textContent;

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
            card.tree().textContent;

        assert.match(tree, /unreadable answer ×1/);
        assert.match(tree, /fs_write/);
        assert.match(
            card.log().textContent,
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

        const stopped = card.tree().textContent;
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

    await test("the chat toggle button switches agent responses between rendered Markdown and raw text", () => {

        const mdPayload = "# Complex Summary\n\n| File | Status |\n| --- | --- |\n| `app.js` | **ok** |\n\n```js\nconst x = 1;\n```";

        console_.send({
            type: "session:message",
            message: { role: "user", kind: "message", content: "**User** prompt" }
        });
        console_.send({
            type: "session:message",
            message: { role: "assistant", kind: "message", content: mdPayload }
        });

        const chat = document.getElementById("chat");
        const toggle = document.getElementById("chatFormatToggle");
        assert.ok(toggle, "chat format toggle button exists");
        assert.ok(document.querySelector(".composer-tools #chatFormatToggle"), "chat format toggle lives below message input in composer-tools");
        assert.equal(toggle.getAttribute("aria-pressed"), "false");
        assert.equal(toggle.textContent, "Raw · off");
        assert.ok(chat.querySelector("h1.md-heading"), "Markdown heading is rendered by default");
        assert.ok(chat.querySelector("table.md-table"), "Markdown table is rendered by default");
        assert.equal(chat.querySelectorAll(".raw-message-content").length, 0);

        toggle.dispatch("click");
        assert.equal(toggle.getAttribute("aria-pressed"), "true");
        assert.equal(toggle.textContent, "Raw · on");
        const rawBlocks = [...chat.querySelectorAll(".bubble.assistant .raw-message-content")];
        assert.ok(rawBlocks.length >= 1, "agent bubbles render raw content pre block");
        assert.ok(rawBlocks.some(node => node.textContent === mdPayload), "raw markdown source is preserved verbatim");
        assert.equal(chat.querySelectorAll(".bubble.assistant table.md-table").length, 0, "rendered markdown tables are replaced in raw mode");
        assert.ok(chat.querySelector(".bubble.user .message-content strong"), "user message remains rendered");

        toggle.dispatch("click");
        assert.equal(toggle.getAttribute("aria-pressed"), "false");
        assert.equal(toggle.textContent, "Raw · off");
        assert.ok(chat.querySelector("table.md-table"), "Markdown preview returns when toggled back");
    });
};
