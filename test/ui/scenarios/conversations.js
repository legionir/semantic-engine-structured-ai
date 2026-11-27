"use strict";

/*
| Console behaviour — parallel conversations, the message queue and
| notifications (roadmap P1-03 / P1-04 / P1-05)
|
| Runs inside ui.test.js after the projects group, against the console it
| booted: Alpha (prj-a) and Beta (prj-b) are registered there.
*/

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const harness = require("../harness");


const tick = () => new Promise(resolve => setTimeout(resolve, 0));


function line(projectId, fields = {}) {

    return {
        project_id: projectId,
        status: "idle",
        task: null,
        background: false,
        pending_approvals: 0,
        queue_length: 0,
        queue_paused: false,
        messages: 0,
        ...fields
    };
}


function tabs() {

    return [...document.querySelectorAll("#conversationTabs .conversation-tab")];
}


function tabFor(projectId) {

    return tabs().find(tab => tab.getAttribute("data-project") === projectId);
}


function setHidden(hidden) {

    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
}


module.exports = async function Conversations({ test, console_ }) {

    const { state } =
        await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "app", "store.js")).href);

    const { setCurrentProject } =
        await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "app", "projects-controller.js")).href);

    /* the projects group leaves a multi-project scope; these tests talk to one */
    state.taskScopeMode = "current";
    state.taskProjectIds = [];
    setCurrentProject("prj-a", { force: true });
    await tick();

    const notices = [];

    class FakeNotification {
        constructor(title, options) {
            this.title = title;
            this.options = options;
            notices.push(this);
        }
        close() {
            this.closed = true;
        }
    }
    FakeNotification.permission = "granted";
    FakeNotification.requestPermission = async () => "granted";

    window.Notification = FakeNotification;

    await test("each live conversation gets a tab with its state; a lone one gets none", async () => {

        console_.snapshot({
            turns: 0,
            status: "running",
            messages: [],
            conversations: [line(null), line("prj-a", { status: "running", messages: 1 })]
        });
        await tick();

        assert.equal(tabs().length, 0, "a single conversation needs no tab strip");

        console_.send({
            type: "conversations",
            conversations: [
                line(null),
                line("prj-a", { status: "running", messages: 1, queue_length: 2 }),
                line("prj-b", { status: "running", messages: 1, pending_approvals: 1, task: "ship it" })
            ]
        });
        await tick();

        assert.equal(tabs().length, 2, "the empty default conversation has no tab");
        assert.ok(tabFor("prj-a").classList.contains("active"));
        assert.ok(tabFor("prj-a").classList.contains("running"));
        assert.match(tabFor("prj-a").textContent, /Alpha/);
        assert.match(tabFor("prj-a").textContent, /\+2/, "the queue length shows");
        assert.ok(tabFor("prj-b").classList.contains("awaiting"), "an approval outranks running");
        assert.match(tabFor("prj-b").textContent, /awaiting approval/);
    });

    await test("a conversation that settles off screen is marked and counted in the title", async () => {

        console_.send({
            type: "conversations",
            conversations: [
                line(null),
                line("prj-a", { status: "running", messages: 1 }),
                line("prj-b", { status: "done", messages: 2 })
            ]
        });
        await tick();

        assert.ok(tabFor("prj-b").classList.contains("done"));
        assert.ok(tabFor("prj-b").classList.contains("attention"));
        assert.match(document.title, /^\(1\) /);
        assert.equal(notices.length, 0, "notifications are off until the operator turns them on");
    });

    await test("choosing a tab opens that project's own stream and clears its marker", async () => {

        tabFor("prj-b").dispatch("click");
        await tick();

        assert.equal(state.currentProjectId, "prj-b");
        assert.match(console_.sourceUrl(), /projectId=prj-b/);
        assert.ok(tabFor("prj-b").classList.contains("active"));
        assert.equal(tabFor("prj-b").classList.contains("attention"), false);
        assert.doesNotMatch(document.title, /^\(\d+\) /);
    });

    await test("notifications can be turned on and fire only while the page is hidden", async () => {

        const button = document.getElementById("notificationsButton");

        button.dispatch("click");
        await tick();
        await tick();

        assert.equal(button.textContent, "Notify · on");
        assert.equal(console_.storage["structured-ai.notifications"], "on");

        /* visible page: a change marks the tab, nothing pops up */
        console_.send({ type: "conversations", conversations: [line(null), line("prj-a", { status: "running", messages: 1 }), line("prj-b", { status: "running", messages: 2 })] });
        console_.send({ type: "conversations", conversations: [line(null), line("prj-a", { status: "running", messages: 1 }), line("prj-b", { status: "failed", messages: 2 })] });
        await tick();

        assert.equal(notices.length, 0);

        setHidden(true);

        try {

            console_.send({
                type: "conversations",
                conversations: [line(null), line("prj-a", { status: "running", messages: 1, pending_approvals: 1, task: "deploy" }), line("prj-b", { status: "failed", messages: 2 })]
            });
            await tick();

            assert.equal(notices.length, 1);
            assert.equal(notices[0].title, "Alpha needs your approval");
            assert.equal(notices[0].options.body, "deploy");

            console_.send({
                type: "conversations",
                conversations: [line(null), line("prj-a", { status: "done", messages: 2 }), line("prj-b", { status: "failed", messages: 2 })]
            });
            await tick();

            assert.equal(notices.length, 2);
            assert.equal(notices[1].title, "Alpha finished");
            assert.match(document.title, /^\(1\) /, "the hidden page counts what changed");

        } finally {
            setHidden(false);
        }

        notices[1].onclick();
        await tick();

        assert.equal(state.currentProjectId, "prj-a", "the notification opens its conversation");
        assert.equal(notices[1].closed, true);

        button.dispatch("click");
        await tick();

        assert.equal(button.textContent, "Notify · off");
        assert.equal(console_.storage["structured-ai.notifications"], "off");
    });

    await test("a busy project queues the message and the composer stays on the run", async () => {

        console_.send({ type: "run:status", status: "running", project_id: "prj-a" });
        await tick();

        const run = document.getElementById("runButton");
        const queue = document.getElementById("queueButton");
        const correct = document.getElementById("correctButton");

        assert.equal(run.disabled, false);
        assert.equal(run.textContent, "Stop");
        assert.ok(run.classList.contains("is-stop"));
        assert.equal(queue.hidden, false);
        assert.equal(queue.textContent, "Queue message");
        assert.equal(correct.hidden, false);

        console_.reply("POST /api/projects/prj-a/tasks", {
            __status: 202,
            body: { accepted: true, project_id: "prj-a", queued: true, queue_length: 1 }
        });

        document.getElementById("task").value = "then add tests";
        document.getElementById("taskForm").dispatch("submit");
        await tick();
        await tick();

        const post = console_.posted.filter(item => item.url === "/api/projects/prj-a/tasks").at(-1);

        assert.equal(post.body.task, "then add tests");
        assert.equal(document.getElementById("task").value, "", "the composer is cleared");
        assert.equal(state.status, "running", "the run on screen goes on");
        assert.equal(document.getElementById("statusText").className, "status-pill running", "statusText reflects running pill with processing indicator");
        assert.equal(document.querySelectorAll("#chat .bubble.error").length, 0);
    });

    await test("the queue is shown, edited, deleted, cleared and resumed through the server", async () => {

        console_.send({
            type: "queue:changed",
            project_id: "prj-a",
            paused: false,
            items: [
                { id: "q-1", text: "then add tests", kind: "message" },
                { id: "q-2", text: "use the v2 api", kind: "correction" }
            ]
        });
        await tick();

        const panel = () => document.querySelector("#messageQueue .message-queue");
        const items = () => [...panel().querySelectorAll(".queue-item")];

        assert.equal(items().length, 2);
        assert.ok(items()[1].classList.contains("correction"));

        console_.reply("PATCH /api/projects/prj-a/queue/q-1", { item: { id: "q-1" } });
        items()[0].querySelector(".queue-edit-button").dispatch("click");
        await tick();

        const field = panel().querySelector(".queue-edit");
        field.value = "then add unit tests";
        panel().querySelector(".queue-save").dispatch("click");
        await tick();
        await tick();

        const patch = console_.posted.filter(item => item.method === "PATCH").at(-1);
        assert.equal(patch.url, "/api/projects/prj-a/queue/q-1");
        assert.deepEqual(patch.body, { text: "then add unit tests" });
        assert.equal(panel().querySelector(".queue-edit"), null, "the editor closes after the save");

        items()[1].querySelector(".queue-delete").dispatch("click");
        await tick();
        assert.ok(console_.posted.some(item => item.method === "DELETE" && item.url === "/api/projects/prj-a/queue/q-2"));

        /* a stop paused the queue: Resume asks the server to go on */
        console_.send({ type: "queue:changed", project_id: "prj-a", paused: true, items: [{ id: "q-1", text: "then add unit tests", kind: "message" }] });
        await tick();

        assert.ok(panel().classList.contains("paused"));
        panel().querySelector(".queue-resume").dispatch("click");
        await tick();
        assert.ok(console_.posted.some(item => item.method === "POST" && item.url === "/api/projects/prj-a/queue/resume"));

        panel().querySelector(".queue-clear").dispatch("click");
        await tick();
        assert.ok(console_.posted.some(item => item.method === "DELETE" && item.url === "/api/projects/prj-a/queue"));

        /* another project's queue never shows here */
        console_.send({ type: "queue:changed", project_id: "prj-a", paused: false, items: [] });
        await tick();
        assert.equal(panel(), null, "an empty queue hides the panel");
    });

    await test("Correct now sends the text to the running turn", async () => {

        console_.reply("POST /api/projects/prj-a/correction", { __status: 202, body: { injected: true, correction_id: "c-1" } });

        document.getElementById("task").value = "skip the docs";
        document.getElementById("correctButton").dispatch("click");
        await tick();
        await tick();

        const post = console_.posted.filter(item => item.url === "/api/projects/prj-a/correction").at(-1);

        assert.deepEqual(post.body, { text: "skip the docs" });
        assert.equal(document.getElementById("task").value, "");

        console_.send({ type: "run:status", status: "done", project_id: "prj-a" });
        await tick();

        assert.equal(document.getElementById("runButton").textContent, "Run task");
        assert.equal(document.getElementById("correctButton").hidden, true);
    });

    await test("a cancel stops the conversation on screen and New conversation clears only it", async () => {

        console_.send({ type: "run:status", status: "running", project_id: "prj-a" });
        console_.reply("POST /api/projects/prj-a/cancel", { cancelled: true });
        document.getElementById("runButton").dispatch("click");
        await tick();
        assert.ok(console_.posted.some(item => item.url === "/api/projects/prj-a/cancel"));
        console_.send({ type: "run:status", status: "cancelled", project_id: "prj-a" });
        await tick();

        const globalClears = console_.posted.filter(item => item.url === "/api/clear").length;

        console_.reply("POST /api/projects/prj-a/clear", { cleared: true, project_id: "prj-a" });
        document.getElementById("clearButton").dispatch("click");
        await tick();
        assert.ok(console_.posted.some(item => item.url === "/api/projects/prj-a/clear"));
        assert.equal(console_.posted.filter(item => item.url === "/api/clear").length, globalClears);
    });

    await test("the default view keeps another project's background turn out of its conversation", async () => {

        setCurrentProject(null);
        await tick();

        state.activeProjectId = null;
        console_.snapshot({ turns: 0, status: "idle", messages: [], conversations: [line(null), line("prj-b", { status: "running" })] });
        await tick();

        console_.send({ type: "run:start", project_id: "prj-b", task: "b-work", background: true });
        console_.send({
            type: "session:message",
            project_id: "prj-b",
            background: true,
            message: { role: "assistant", content: "secret-of-background-b", at: Date.now() }
        });
        await tick();

        assert.equal(state.status, "idle", "the default conversation is not running");
        assert.doesNotMatch(document.getElementById("chat").textContent, /secret-of-background-b/);

        setCurrentProject("prj-a");
        await tick();
    });

    await test("Run task / Stop button tracks internal task queue progress without changing its label", async () => {

        const run = document.getElementById("runButton");

        console_.snapshot({ turns: 0, status: "idle", plan: null, queue: null, messages: [] });
        await tick();
        assert.equal(run.textContent, "Run task");
        assert.equal(run.classList.contains("has-progress"), false);
        assert.equal(run.dataset.progress, undefined);

        console_.send({ type: "run:status", status: "running", project_id: "prj-a" });
        await tick();
        assert.equal(run.textContent, "Stop");
        assert.equal(run.classList.contains("has-progress"), true);
        assert.equal(run.classList.contains("is-indeterminate"), true);
        assert.equal(run.dataset.progress, "0");

        console_.send({
            type: "plan:updated",
            project_id: "prj-a",
            plan: { exists: true, objective: "Ship", steps: 4, done: 2, blocked: 0, phases: [] }
        });
        await tick();
        assert.equal(run.textContent, "Stop");
        assert.equal(run.classList.contains("is-indeterminate"), false);
        assert.equal(run.dataset.progress, "50");

        /* paused with remaining plan steps shows progress on the Run task button itself */
        console_.send({ type: "run:status", status: "done", project_id: "prj-a" });
        await tick();
        assert.equal(run.textContent, "Run task");
        assert.equal(run.classList.contains("has-progress"), true);
        assert.equal(run.dataset.progress, "50");

        /* finishing all plan steps clears the progress ring */
        console_.send({
            type: "plan:updated",
            project_id: "prj-a",
            plan: { exists: true, objective: "Ship", steps: 4, done: 4, blocked: 0, phases: [] }
        });
        await tick();
        assert.equal(run.textContent, "Run task");
        assert.equal(run.classList.contains("has-progress"), false);
        assert.equal(run.dataset.progress, undefined);
    });
};
