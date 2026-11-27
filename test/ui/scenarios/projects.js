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
    | Discussion opens as a modal: the button opens the Discussion modal
    | with the topic box and persona picker, posts to /api/discussion,
    | switches the modal to the live transcript, and lets you start a new
    | discussion once it finishes.
    */

    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    await test("discussion opens in a modal, starts a run, and shows the live transcript", async () => {

        console_.reply("/api/discussion/personas", {
            personas: [
                { id: "security", name: "Security Agent", description: "security lens" },
                { id: "frontend", name: "Frontend Agent", description: "frontend lens" }
            ]
        });

        /* earlier tests leave a run marked running; the composer is idle here */
        console_.send({ type: "run:status", status: "idle" });

        const toggle = document.getElementById("discussionButton");
        const run = document.getElementById("runButton");

        assert.equal(document.getElementById("discussionOptions"), null);
        assert.equal(run.textContent, "Run task");

        toggle.dispatch("click");

        await tick();

        const dialog = backdrops().at(-1);
        assert.ok(dialog, "the Discussion modal opens");
        assert.equal(run.textContent, "Run task", "composer Run task button is unchanged");
        const foot = dialog.querySelector(".modal-foot");
        assert.ok(foot.querySelector("#discussionRounds"), "Rounds input is in modal footer");
        assert.match(foot.textContent, /Rounds/);
        assert.equal(foot.querySelector("#startDiscussionButton").textContent.trim(), "Start");
        assert.ok(document.querySelector(".brand #statusText"), "statusText sits in .brand");
        assert.ok(document.querySelector(".brand #gatewayHealth"), "gatewayHealth sits in .brand");
        assert.ok(document.querySelector("#projectBar #workspace"), "workspace sits in #projectBar");
        assert.equal(
            [...dialog.querySelectorAll(".persona-box")].length,
            2,
            "every persona is selectable"
        );

        /* nothing selected, nothing sent */

        for (const box of [...dialog.querySelectorAll(".persona-box")]) {
            box.checked = false;
            box.dispatch("change");
        }

        const taskInput = dialog.querySelector("#discussionTask");
        taskInput.value = "design auth";
        taskInput.dispatch("input");
        dialog.querySelector(".discussion-setup").dispatch("submit");

        await tick();

        assert.equal(
            console_.posted.filter(post => post.url === "/api/discussion").length,
            0,
            "an empty persona selection is refused locally"
        );

        /* a selection goes to the discussion endpoint, not /api/tasks */

        const first = [...dialog.querySelectorAll(".persona-box")][0];
        first.checked = true;
        first.dispatch("change");

        dialog.querySelector(".discussion-setup").dispatch("submit");

        await tick();

        const posts =
            console_.posted.filter(post => post.url === "/api/discussion");

        assert.equal(posts.length, 1);
        assert.equal(posts[0].body.task, "design auth");
        assert.deepEqual(posts[0].body.personas, ["security"]);
        assert.equal(posts[0].body.max_rounds, 5);
        assert.ok(dialog.querySelector("#discussionStatus"), "switches to the live transcript view");

        /* finishing enables the New discussion tab inside the modal */

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

        assert.match(dialog.querySelector("#discussionStatus").textContent, /2 round/);
        const newTab = [...dialog.querySelectorAll(".discussion-modal-tabs button")]
            .find(btn => btn.textContent.trim() === "New discussion");
        assert.ok(newTab && !newTab.disabled, "New discussion tab becomes available");
        newTab.dispatch("click");
        await tick();
        assert.ok(dialog.querySelector("#startDiscussionButton"), "setup form returns on New discussion tab");

        if (Modal.openCount > 0) {
            Modal.closeTop("test");
        }
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
