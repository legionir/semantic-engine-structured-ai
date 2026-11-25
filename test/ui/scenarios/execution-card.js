"use strict";

/*
| Console behaviour — the execution card: agents, graphs, waves, call detail, hooks, archive
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


module.exports = async function ExecutionCard({ test, Modal, backdrops, card, console_ }) {

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
            card.tree().textContent;

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
            card.tree().textContent;

        assert.match(tree, /dependency graph/);
        assert.match(tree, /wave 1 · 2 in parallel/);
        assert.match(tree, /wave 2/);
        assert.match(tree, /after a, b/);

        assert.match(
            card.execSummary().textContent,
            /2 agents · 3 calls · 1 failed/
        );
    });

    await test("a wave label counts real overlap, not the plan", () => {

        const groups = () =>
            [...card.tree().querySelectorAll(".graph")];

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
            [...card.tree()
                .querySelectorAll(".tool")];

        assert.ok(rows.length >= 3);

        rows[0].dispatch("click");

        await Promise.resolve();

        /* the detail opens over the Execution modal */
        const dialog = backdrops().at(-1).children[0];

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
            card.tree().textContent;

        assert.match(tree, /exit 2/);

        const rows =
            [...card.tree()
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
            card.tree().textContent;

        assert.match(tree, /Loaded skill codebase_analysis/);

        const marks =
            [...card.tree()
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
            [...card.tree()
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
            card.tree().textContent;

        assert.match(tree, /Runtime routine/);
        assert.match(tree, /after_task · verify · agent/);
        assert.match(tree, /npm test passed/);
        assert.match(
            card.execSummary().textContent,
            /1 hook/
        );
    });

    await test("a new task archives the previous execution in a closed accordion", () => {

        console_.send({
            type: "run:start",
            task: "second task\nwith a line break"
        });

        const archive =
            card.archive();

        assert.equal(archive.children.length >= 1, true);

        const previous =
            archive.children[archive.children.length - 1];

        assert.equal(previous.tagName, "DETAILS");
        assert.equal(Boolean(previous.open), false);
        assert.match(previous.children[0].textContent, /audit the repository/);
        assert.equal(previous.children[0].textContent.includes("\n"), false);

        assert.match(
            card.tree().textContent,
            /second task/
        );
    });
};
