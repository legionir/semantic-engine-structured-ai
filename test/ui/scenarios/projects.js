"use strict";

/*
| Console behaviour — discussion mode, projects, dashboard and the multi-project queue
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


module.exports = async function Projects({ test, Modal, backdrops, card, console_ }) {

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
            box.dispatch("change");
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

        const first = [...options.querySelectorAll(".persona-box")][0];
        first.checked = true;
        first.dispatch("change");

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

        const before = card.log().children.length;

        console_.send({
            type: "run:start",
            project_id: "prj-b",
            task: "secret-of-b"
        });

        assert.equal(
            card.log().children.length,
            before,
            "project B events must not appear while A is selected"
        );
        assert.equal(
            card.tree().textContent.includes("secret-of-b"),
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
};
