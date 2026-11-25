"use strict";

/*
| Console behaviour — the New Project form, the Projects manager's row
| actions, and files attached to a task
|
| Runs last inside ui.test.js, against the console it booted. It first puts
| the console back on the default workspace, because the projects group
| leaves several projects selected.
*/

const assert = require("assert");


module.exports = async function ProjectManager({ test, backdrops, console_ }) {

    const byId = id => document.getElementById(id);
    const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
    const modal = () => backdrops().at(-1);
    const button = (root, label) => [...root.querySelectorAll("button")].find(item => item.textContent === label);
    const posts = pattern => console_.posted.filter(item => item.method !== "GET" && pattern.test(item.url));
    const errors = () => [...byId("chat").querySelectorAll(".bubble")].filter(b => b.className.includes("error"));
    const PROJECTS = [
        { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" },
        { id: "prj-b", name: "Beta", rootPath: "/tmp/b" }
    ];

    const openManager = async () => {
        byId("projectsButton").dispatch("click");
        await settle();
        return modal();
    };

    const useDefaultWorkspace = async () => {
        const manager = await openManager();
        const choice = manager.querySelector("input[type=radio][name=projectSelectionMode]");
        choice.checked = true;
        choice.dispatch("change");
        button(manager, "Confirm").dispatch("click");
        await settle();
    };

    console_.send({ type: "run:status", status: "idle" });
    console_.reply("/api/projects", { projects: PROJECTS });
    await useDefaultWorkspace();

    await test("New Project needs a root, says why a registration failed, and opens the new project", async () => {

        byId("newProjectButton").dispatch("click");
        await settle();
        const form = modal();
        const [name, root] = form.querySelectorAll("input");
        const message = form.querySelector(".mcp-message");
        const create = button(form, "Create");
        const before = posts(/^\/api\/projects$/).length;

        root.value = "   ";
        create.dispatch("click");
        await settle();
        assert.equal(message.textContent, "a root path is required");
        assert.equal(posts(/^\/api\/projects$/).length, before, "nothing is sent without a root");

        name.value = "  Gamma  ";
        root.value = " /tmp/gamma ";
        console_.reply("POST /api/projects", { __status: 409, body: { error: "root already registered" } });
        create.dispatch("click");
        await settle();
        assert.equal(message.textContent, "root already registered");
        assert.deepEqual(posts(/^\/api\/projects$/).at(-1).body, {
            name: "Gamma",
            rootPath: "/tmp/gamma",
            createIfMissing: true
        }, "name and root are trimmed; the folder is created if missing");

        console_.reply("POST /api/projects", { __status: 500, body: {} });
        create.dispatch("click");
        await settle();
        assert.equal(message.textContent, "could not register");

        console_.reply("POST /api/projects", new Error("offline"));
        create.dispatch("click");
        await settle();
        assert.equal(message.textContent, "could not register: offline");
        assert.ok(form.isConnected, "the form stays open while it fails");

        const gamma = { id: "prj-g", name: "Gamma", rootPath: "/tmp/gamma" };
        console_.reply("POST /api/projects", { project: gamma });
        console_.reply("/api/projects", { projects: [...PROJECTS, gamma] });
        create.dispatch("click");
        await settle();
        assert.equal(form.isConnected, false, "a registered project closes the form");
        assert.equal(console_.storage["structured-ai.currentProjectId"], "prj-g");
        assert.equal(byId("activeProjectName").textContent, "Gamma");

        byId("newProjectButton").dispatch("click");
        await settle();
        button(modal(), "Cancel").dispatch("click");
        await settle();
        assert.equal(backdrops().length, 0);
    });

    await test("the Projects manager says when nothing is registered", async () => {

        console_.reply("/api/projects", { projects: [] });
        const manager = await openManager();
        assert.match(manager.textContent, /No registered projects yet\./);
        assert.match(manager.textContent, /0 registered/);
        assert.equal(manager.querySelectorAll(".project-picker-checkbox").length, 0);
        button(manager, "Close").dispatch("click");
        await settle();
        console_.reply("/api/projects", { projects: [...PROJECTS, { id: "prj-g", name: "Gamma", rootPath: "/tmp/gamma" }] });
    });

    await test("a refused or failed delete keeps the project and says why; deleting the open one falls back to the default", async () => {

        let manager = await openManager();
        const deleteOf = (root, name) =>
            button([...root.querySelectorAll(".project-row")].find(row => row.textContent.includes(name)), "Delete");
        const errorCount = errors().length;

        console_.reply("DELETE /api/projects/prj-g", { __status: 409, body: { error: "a run is active" } });
        deleteOf(manager, "Gamma").dispatch("click");
        await settle();
        assert.equal(errors().length, errorCount + 1);
        assert.match(errors().at(-1).textContent, /Gamma was not deleted: a run is active/);
        assert.ok(manager.isConnected, "the manager stays open");

        console_.reply("DELETE /api/projects/prj-g", new Error("offline"));
        deleteOf(manager, "Gamma").dispatch("click");
        await settle();
        assert.match(errors().at(-1).textContent, /Gamma was not deleted: offline/);
        assert.equal(console_.storage["structured-ai.currentProjectId"], "prj-g", "still the current project");

        console_.reply("DELETE /api/projects/prj-g", { ok: true });
        console_.reply("/api/projects", { projects: PROJECTS });
        deleteOf(manager, "Gamma").dispatch("click");
        await settle();
        assert.equal(manager.isConnected, false);
        assert.equal(byId("activeProjectName").textContent, "Default Workspace");
        assert.notEqual(console_.storage["structured-ai.currentProjectId"], "prj-g", "the deleted project is forgotten");
        assert.doesNotMatch(console_.sourceUrl(), /projectId=prj-g/, "and its event stream is left");

        manager = modal();
        assert.ok(manager, "the manager reopens with the new list");
        assert.equal(manager.querySelectorAll(".project-row").length, 2);
        assert.doesNotMatch(manager.textContent, /Gamma/);
        button(manager, "Close").dispatch("click");
        await settle();
    });

    await test("Open closes the manager and shows that project's dashboard", async () => {

        const manager = await openManager();
        const row = [...manager.querySelectorAll(".project-row")].find(item => item.textContent.includes("Beta"));
        button(row, "Open").dispatch("click");
        await settle();

        assert.equal(manager.isConnected, false);
        assert.equal(byId("projectDashboard").hidden, false);
        assert.match(byId("projectDashboard").textContent, /Beta/);

        byId("dashboardBack").dispatch("click");
        await settle();
        assert.equal(byId("projectDashboard").hidden, true);
        await useDefaultWorkspace();
    });

    /* a file input's value cannot be set from script; record what the code assigns */
    const assigned = [];
    const attach = names => {
        const input = byId("attachmentInput");
        const files = names.map(name => new File([`content of ${name}`], name, { type: "text/plain" }));
        Object.defineProperty(input, "files", { configurable: true, value: files });
        Object.defineProperty(input, "value", { configurable: true, get: () => "", set: v => assigned.push(v) });
        input.dispatch("change");
        delete input.files;
        delete input.value;
    };
    const chips = () => [...byId("attachmentList").querySelectorAll(".attachment-name")].map(n => n.textContent);

    await test("attached files show as chips, can be removed, and the Attach button opens the picker", async () => {

        let picked = 0;
        const input = byId("attachmentInput");
        input.click = () => { picked++; };
        byId("attachFilesButton").dispatch("click");
        assert.equal(picked, 1);
        delete input.click;

        attach(["notes.txt", "data.csv", "extra.log"]);
        await settle();
        assert.deepEqual(chips(), ["notes.txt", "data.csv", "extra.log"]);
        assert.deepEqual(assigned, [""], "the picker is reset so the same file can be picked again");

        byId("attachmentList").querySelector("button[aria-label='Remove extra.log']").dispatch("click");
        await settle();
        assert.deepEqual(chips(), ["notes.txt", "data.csv"]);
    });

    await test("a failed upload keeps the task and the files and says why; nothing is run", async () => {

        console_.send({ type: "run:status", status: "idle" });
        const tasks = posts(/^\/api\/tasks$/).length;
        console_.reply("POST /api/uploads", { __status: 413, body: { error: "files too large" } });

        byId("task").value = "summarise the files";
        byId("taskForm").dispatch("submit");
        await settle();

        assert.equal(posts(/^\/api\/tasks$/).length, tasks, "no task without its files");
        assert.equal(byId("task").value, "summarise the files");
        assert.deepEqual(chips(), ["notes.txt", "data.csv"]);
        assert.equal(byId("attachmentList").querySelector(".attachment-error").textContent, "files too large");

        console_.reply("POST /api/uploads", { files: [{ name: "notes.txt", path: "/up/1" }] });
        byId("taskForm").dispatch("submit");
        await settle();
        assert.equal(posts(/^\/api\/tasks$/).length, tasks, "a short answer is a failure too");
        assert.match(byId("attachmentList").textContent, /File upload failed \(200\)/);
    });

    await test("files are uploaded before the task, which then names where they were stored", async () => {

        console_.send({ type: "run:status", status: "idle" });
        const uploads = posts(/^\/api\/uploads$/).length;
        console_.reply("POST /api/uploads", {
            files: [{ name: "notes.txt", path: "/up/notes.txt" }, { name: "data.csv", path: "/up/data.csv" }]
        });

        byId("taskForm").dispatch("submit");
        await settle();

        const upload = posts(/^\/api\/uploads$/).at(-1);
        assert.equal(posts(/^\/api\/uploads$/).length, uploads + 1);
        assert.deepEqual(upload.body.getAll("files").map(file => file.name), ["notes.txt", "data.csv"]);

        const task = posts(/^\/api\/tasks$/).at(-1).body.task;
        assert.match(task, /^summarise the files\n\nAttached files \(stored locally on the server\):/);
        assert.match(task, /- "notes\.txt": "\/up\/notes\.txt"\n- "data\.csv": "\/up\/data\.csv"/);
        assert.match(task, /do not execute uploaded code/);

        assert.equal(byId("task").value, "", "a sent task clears the composer");
        assert.deepEqual(chips(), []);
        assert.equal(byId("attachmentList").querySelector(".attachment-error"), null);
    });
};
