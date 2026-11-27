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
        assert.ok(form.querySelector(".new-project-body"), "uses clean new-project container without mcp-add top rule");
        assert.equal(form.querySelector(".mcp-add"), null);
        const folderTab = button(form, "Folder");
        assert.equal(folderTab.classList.contains("active"), true, "Folder tab is active by default");
        assert.equal(folderTab.getAttribute("aria-selected"), "true");
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

        const manager = await openManager();
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
        assert.equal(byId("activeProjectName").textContent, "Default Workspace");
        assert.notEqual(console_.storage["structured-ai.currentProjectId"], "prj-g", "the deleted project is forgotten");
        assert.doesNotMatch(console_.sourceUrl(), /projectId=prj-g/, "and its event stream is left");

        assert.ok(manager.isConnected, "the manager stays open and redraws with the new list");
        assert.equal(modal(), manager);
        assert.equal(manager.querySelectorAll(".project-row").length, 2);
        assert.doesNotMatch(manager.textContent, /Gamma/);
        assert.match(manager.textContent, /2 registered/);
        assert.equal(manager.querySelector("input[name=projectSelectionMode]").checked, true, "the default takes over the deleted selection");
        assert.equal(button(manager, "Confirm").disabled, false);
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

    await test("the Projects manager redraws in place and keeps an unconfirmed choice", async () => {

        const gamma = { id: "prj-g", name: "Gamma", rootPath: "/tmp/gamma" };
        console_.reply("/api/projects", { projects: [...PROJECTS, gamma] });
        const manager = await openManager();
        const box = name => [...manager.querySelectorAll(".project-row")]
            .find(row => row.textContent.includes(name)).querySelector(".project-picker-checkbox");
        const confirm = button(manager, "Confirm");

        const alpha = box("Alpha");
        alpha.checked = true;
        alpha.dispatch("change");
        assert.equal(manager.querySelector("input[name=projectSelectionMode]").checked, false, "a project replaces the default");

        console_.reply("DELETE /api/projects/prj-g", { ok: true });
        console_.reply("/api/projects", { projects: PROJECTS });
        button([...manager.querySelectorAll(".project-row")].find(row => row.textContent.includes("Gamma")), "Delete").dispatch("click");
        await settle();

        assert.ok(manager.isConnected, "the open manager is redrawn, not replaced");
        assert.equal(modal(), manager);
        assert.doesNotMatch(manager.textContent, /Gamma/);
        assert.equal(box("Alpha"), alpha, "the row that stayed is the same node");
        assert.equal(alpha.checked, true, "the unconfirmed choice survives the redraw");
        assert.equal(byId("activeProjectName").textContent, "Default Workspace", "nothing is applied before Confirm");
        assert.equal(button(manager, "Confirm"), confirm);

        alpha.checked = false;
        alpha.dispatch("change");
        assert.equal(confirm.disabled, true, "nothing chosen, nothing to confirm");
        button(manager, "Close").dispatch("click");
        await settle();
    });

    await test("a deleted project leaves a multi-project scope", async () => {

        const gamma = { id: "prj-g", name: "Gamma", rootPath: "/tmp/gamma" };
        console_.reply("/api/projects", { projects: [...PROJECTS, gamma] });
        let manager = await openManager();
        for (const box of manager.querySelectorAll(".project-picker-checkbox")) {
            box.checked = true;
            box.dispatch("change");
        }
        button(manager, "Confirm").dispatch("click");
        await settle();
        assert.equal(byId("activeProjectName").textContent, "Multiple projects · 3");

        manager = await openManager();
        const remove = name => button([...manager.querySelectorAll(".project-row")].find(row => row.textContent.includes(name)), "Delete");

        console_.reply("DELETE /api/projects/prj-g", { ok: true });
        console_.reply("/api/projects", { projects: PROJECTS });
        remove("Gamma").dispatch("click");
        await settle();
        assert.equal(byId("activeProjectName").textContent, "Multiple projects · 2", "the label follows the scope while the manager is open");
        assert.equal(console_.storage["structured-ai.currentProjectId"], "prj-a", "Alpha stays the visible project");

        console_.reply("DELETE /api/projects/prj-a", { ok: true });
        console_.reply("/api/projects", { projects: [PROJECTS[1]] });
        remove("Alpha").dispatch("click");
        await settle();
        assert.equal(byId("activeProjectName").textContent, "Beta", "one project left is a single-project scope");
        assert.equal(console_.storage["structured-ai.currentProjectId"], "prj-b", "the visible project moves to the one still selected");
        assert.match(console_.sourceUrl(), /projectId=prj-b/);
        assert.equal(manager.querySelector(".project-row .project-picker-checkbox").checked, true, "and the manager shows it selected");

        button(manager, "Close").dispatch("click");
        await settle();
        console_.reply("/api/projects", { projects: PROJECTS });
        await useDefaultWorkspace();
        assert.equal(byId("activeProjectName").textContent, "Default Workspace");
    });

    await test("the New Project form keeps what was typed while it reports a problem", async () => {

        byId("newProjectButton").dispatch("click");
        await settle();
        const form = modal();
        const [name, root] = form.querySelectorAll("input");
        name.value = "Delta";
        root.value = "";
        button(form, "Create").dispatch("click");
        await settle();

        assert.equal(form.querySelector(".mcp-message").textContent, "a root path is required");
        assert.equal(form.querySelectorAll("input")[0], name, "the field is the same node");
        assert.equal(name.value, "Delta", "and still holds the name");

        button(form, "Cancel").dispatch("click");
        await settle();
    });

    await test("the health chip links to the visible project's overview", async () => {

        const chip = byId("gatewayHealth");
        assert.match(chip.textContent, /^(ok|degraded|down|unknown|—)$/);
        assert.doesNotMatch(chip.textContent, /health · /);
        assert.equal(chip.getAttribute("href"), "/api/health");

        const manager = await openManager();
        const beta = [...manager.querySelectorAll(".project-row")].find(row => row.textContent.includes("Beta")).querySelector(".project-picker-checkbox");
        beta.checked = true;
        beta.dispatch("change");
        button(manager, "Confirm").dispatch("click");
        await settle();
        assert.equal(chip.getAttribute("href"), "/projects/prj-b?tab=overview", "the link follows a project change without a new health check");

        await useDefaultWorkspace();
        assert.equal(chip.getAttribute("href"), "/api/health");
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
        assert.equal(byId("taskForm").contains(byId("attachmentList")), true, "attachmentList sits inside the composer form");
        assert.equal(byId("attachmentList").nextElementSibling, byId("task"), "attachmentList sits right above #task");
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

    /* roadmap P1-09 */
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const typeTask = async text => {
        const task = byId("task");
        task.value = text;
        task.setSelectionRange(text.length, text.length);
        task.dispatch("input");
        await wait(160);
        await settle();
    };
    const options = () => [...byId("mentionList").querySelectorAll("li")].map(item => item.textContent);

    await test("@ completes paths of the project; arrows move, Enter inserts, Escape closes", async () => {

        console_.reply("GET /api/mentions?q=sr", { entries: [{ path: "src/", type: "directory" }, { path: "srv.js", type: "file" }] });
        console_.reply("GET /api/mentions?q=src%2F", { entries: [{ path: "src/app.js", type: "file" }] });

        await typeTask("fix @sr");
        assert.equal(byId("mentionList").hidden, false);
        assert.deepEqual(options(), ["src/", "srv.js"]);
        assert.equal(byId("task").getAttribute("aria-expanded"), "true");

        byId("task").dispatch("keydown", { key: "ArrowDown" });
        assert.equal(byId("mentionList").querySelector("li.active").textContent, "srv.js");
        byId("task").dispatch("keydown", { key: "ArrowUp" });

        byId("task").dispatch("keydown", { key: "Enter" });
        assert.equal(byId("task").value, "fix @src/", "a folder is inserted without a space and keeps completing");
        await wait(160);
        await settle();
        assert.deepEqual(options(), ["src/app.js"]);

        byId("task").dispatch("keydown", { key: "Tab" });
        assert.equal(byId("task").value, "fix @src/app.js ");
        assert.equal(byId("mentionList").hidden, true);

        await typeTask("mail me@sr");
        assert.equal(byId("mentionList").hidden, true, "an e-mail address is not a mention");

        await typeTask("@sr");
        byId("task").dispatch("keydown", { key: "Escape" });
        assert.equal(byId("mentionList").hidden, true);
        byId("task").value = "";
    });

    await test("a pasted picture becomes an attachment, with a warning while MODEL_IMAGE_INPUT is off", async () => {

        const picture = new File(["png-bytes"], "image.png", { type: "image/png" });
        byId("task").dispatch("paste", { clipboardData: { files: [picture] } });
        await settle();
        assert.equal(chips().length, 1);
        assert.match(chips()[0], /^pasted-.*\.png$/);
        assert.equal(byId("attachmentList").querySelector(".attachment-error"), null);

        byId("task").dispatch("paste", { clipboardData: { files: [new File(["t"], "a.txt", { type: "text/plain" })] } });
        await settle();
        assert.equal(chips().length, 1, "only pictures are taken from the clipboard");

        console_.reply("GET /api/settings", { settings: [{ key: "MODEL_IMAGE_INPUT", value: "off", type: "enum", values: ["on", "off"] }] });
        byId("llmSettingsButton").dispatch("click");
        await settle();
        document.dispatch("keydown", { key: "Escape" });
        await settle();
        assert.equal(backdrops().length, 0, "the settings dialog is closed again");
        assert.match(byId("attachmentList").textContent, /MODEL_IMAGE_INPUT is off/);

        byId("attachmentList").querySelector("button[aria-label^='Remove']").dispatch("click");
        await settle();
        assert.deepEqual(chips(), []);
    });
};
