"use strict";

/*
| Console behaviour — agent quality (roadmap P3-03, P3-05, P3-08, P3-09)
|
|   - a task sent with Plan first carries plan_mode; the plan banner
|     approves it with a turn without plan_mode, or revises it with one;
|   - the run's cost (and its cap) and the goal verdict beside the composer;
|   - Changes lists the tasks, shows one diff, reverts it and offers
|     "Revert anyway" on a conflict;
|   - Review draws the findings and turns the selected ones into a task.
*/

const assert = require("assert");


module.exports = async function AgentQuality({ test, backdrops, console_ }) {

    const byId = id => document.getElementById(id);
    const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(r => setTimeout(r, 0)); };
    const modal = () => backdrops().at(-1);
    const button = (root, label) => [...root.querySelectorAll("button")].find(item => item.textContent.trim().startsWith(label));
    const posts = pattern => console_.posted.filter(item => item.method !== "GET" && pattern.test(item.url));
    const close = async () => { modal().querySelector(".modal-close")?.dispatch("click"); await settle(); };

    console_.send({ type: "run:status", status: "idle" });

    await test("Plan first sends plan_mode, the goal and the cap with the task", async () => {

        console_.reply("POST /api/tasks", { __status: 202, body: { ok: true } });

        byId("taskPlanMode").checked = true;
        byId("taskGoal").value = "tests pass";
        byId("taskMaxCost").value = "0.5";
        byId("task").value = "add a cache";
        byId("taskForm").dispatch("submit");
        await settle();

        const body = posts(/^\/api\/tasks$/).at(-1).body;
        assert.equal(body.task, "add a cache");
        assert.equal(body.plan_mode, true);
        assert.equal(body.goal, "tests pass");
        assert.equal(body.max_cost_usd, 0.5);
        assert.equal(byId("taskPlanMode").checked, false, "plan first belongs to one task");
        assert.equal(byId("taskMaxCost").value, "0.5", "the cap stays");
        byId("taskMaxCost").value = "";

        console_.send({ type: "run:status", status: "idle" });
        await settle();
    });

    await test("the plan banner approves without plan mode and revises with it", async () => {

        console_.send({ type: "run:start", run_id: "r-plan" });
        console_.send({ type: "run:status", status: "done", plan_mode: true, turn_id: "t-1" });
        await settle();

        const banner = byId("planApproval");
        assert.match(banner.textContent, /The plan is ready for your approval/);

        const before = posts(/^\/api\/tasks$/).length;
        button(banner, "Approve and run").dispatch("click");
        await settle();

        const approve = posts(/^\/api\/tasks$/);
        assert.equal(approve.length, before + 1);
        assert.match(approve.at(-1).body.task, /The plan is approved/);
        assert.equal(approve.at(-1).body.plan_mode, undefined, "the approved turn may change the project");
        assert.equal(banner.textContent.trim(), "");

        console_.send({ type: "run:status", status: "idle" });
        console_.send({ type: "run:status", status: "done", plan_mode: true });
        await settle();

        const field = banner.querySelector("input");
        field.value = "use Redis instead";
        field.dispatch("input");
        button(banner, "Revise").dispatch("click");
        await settle();

        const revise = posts(/^\/api\/tasks$/).at(-1).body;
        assert.equal(revise.task, "Revise the plan: use Redis instead");
        assert.equal(revise.plan_mode, true);

        console_.send({ type: "run:status", status: "idle" });
        await settle();
    });

    await test("the run's cost, its cap and the goal verdict are shown", async () => {

        console_.send({ type: "run:start", run_id: "r-cost" });
        console_.send({ type: "run:cost", cost_usd: 0.0123, max_cost_usd: 0.05, prompt_tokens: 2000, completion_tokens: 500, requests: 2, unpriced_models: [] });
        await settle();

        assert.match(byId("runCost").textContent, /\$0\.01 \/ \$0\.05/);

        console_.send({ type: "run:cost_cap", cost_usd: 0.051, max_cost_usd: 0.05 });
        console_.send({ type: "run:goal", goal: "tests pass", met: false, reason: "2 failing", outcome: "continue" });
        await settle();

        assert.match(byId("runCost").textContent, /cap reached/);
        assert.match(byId("runCost").textContent, /goal: not yet/);
        assert.ok(byId("runCost").querySelector(".cap-reached"));
    });

    await test("Changes shows what a task changed, reverts it, and asks before overwriting", async () => {

        console_.reply("GET /api/snapshots", { enabled: true, runs: [{ run_id: "run-7", before: "a", after: "b", created_at: new Date().toISOString() }] });
        console_.reply("GET /api/snapshots/run-7", { run_id: "run-7", files: [{ status: "M", path: "edit.txt" }, { status: "A", path: "new.txt" }], patch: "+after", truncated: false });
        console_.reply("POST /api/snapshots/run-7/revert", { __status: 409, body: { reverted: false, conflicts: ["edit.txt"], code: "SNAPSHOT_CONFLICT", error: "1 file(s) changed again" } });

        byId("taskChangesButton").dispatch("click");
        await settle();

        const view = modal();
        button(view, "run-7").dispatch("click");
        await settle();

        assert.match(view.textContent, /edit\.txt/);
        assert.match(view.textContent, /new\.txt/);

        button(view, "Revert this task").dispatch("click");
        await settle();

        assert.match(view.textContent, /Changed again after the task: edit\.txt/);
        assert.equal(posts(/\/revert$/).at(-1).body.force, false);

        console_.reply("POST /api/snapshots/run-7/revert", { reverted: true, run_id: "run-7", restored: ["edit.txt"], removed: ["new.txt"], conflicts: [] });
        button(view, "Revert anyway").dispatch("click");
        await settle();

        assert.equal(posts(/\/revert$/).at(-1).body.force, true);
        assert.match(view.textContent, /Reverted run-7: 1 restored, 1 removed/);

        await close();
    });

    await test("Review draws the findings and fixes the selected ones", async () => {

        console_.reply("POST /api/review", {
            label: "the uncommitted changes",
            summary: "One risky change.",
            truncated: false,
            findings: [
                { severity: "low", file: "a.js", line: 3, title: "naming" },
                { severity: "high", file: "b.js", line: 9, title: "null check missing", suggestion: "guard it" }
            ]
        });
        console_.reply("POST /api/tasks", { __status: 202, body: { ok: true } });

        byId("reviewButton").dispatch("click");
        await settle();

        const view = modal();
        button(view, "Review").dispatch("click");
        await settle();

        assert.equal(posts(/^\/api\/review$/).at(-1).body.target, "diff");

        const findings = [...view.querySelectorAll(".finding")];
        assert.equal(findings.length, 2);
        assert.match(findings[0].textContent, /high/, "most severe first");
        assert.match(button(view, "Fix selected").textContent, /\(1\)/, "high findings are preselected");

        button(view, "Fix selected").dispatch("click");
        await settle();

        const task = posts(/^\/api\/tasks$/).at(-1).body.task;
        assert.match(task, /1\. \[high\] b\.js:9 — null check missing/);
        assert.doesNotMatch(task, /naming/);

        console_.send({ type: "run:status", status: "idle" });
        await settle();
    });
};
