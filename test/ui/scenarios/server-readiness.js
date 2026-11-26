"use strict";

/*
| Console behaviour — server readiness (roadmap P1-02, P1-06, P1-07)
|
| Runs last inside ui.test.js, against the console it booted:
|   - New Project → From git URL: the folder suggestion, the request, the
|     progress drawn from the clone job, and the project opened at the end;
|   - the banner of conversations a restart interrupted: Continue and
|     Dismiss call their routes and the entry leaves the banner;
|   - the System modal: meters, warnings, Stop on a background process,
|     and the header button's amber state;
|   - a conversation over the server-wide limit is badged "waiting".
*/

const assert = require("assert");


module.exports = async function ServerReadiness({ test, backdrops, console_ }) {

    const byId = id => document.getElementById(id);
    const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(r => setTimeout(r, 0)); };
    const modal = () => backdrops().at(-1);
    const button = (root, label) => [...root.querySelectorAll("button")].find(item => item.textContent.trim() === label);
    const posts = pattern => console_.posted.filter(item => item.method !== "GET" && pattern.test(item.url));
    const input = (root, name) => root.querySelector(`input[name=${name}]`);

    console_.send({ type: "run:status", status: "idle" });

    await test("New Project from a git URL clones, shows the progress and opens the project", async () => {

        console_.reply("GET /api/project-clones", { root: "/srv/projects", jobs: [] });
        console_.reply("/api/secrets", { secrets: [{ name: "GITHUB_PAT" }] });

        byId("newProjectButton").dispatch("click");
        await settle();

        const form = modal();
        button(form, "From git URL").dispatch("click");
        await settle();

        assert.match(form.textContent, /folder in \/srv\/projects/);
        assert.ok(button(form, "Clone"), "the action says Clone");

        const url = input(form, "url");
        url.value = "https://github.com/acme/widget.git";
        url.dispatch("input");
        await settle();
        assert.equal(input(form, "folder").getAttribute("placeholder"), "widget");

        input(form, "branch").value = "dev";
        input(form, "secret").value = "GITHUB_PAT";
        input(form, "shallow").checked = true;

        const job = { id: "clone-1", status: "running", phase: "Receiving objects", percent: 40, output: ["Receiving objects:  40% (4/10)"] };
        console_.reply("POST /api/project-clones", { __status: 202, body: { job } });
        console_.reply("/api/project-clones/clone-1", { job });

        button(form, "Clone").dispatch("click");
        await settle();

        assert.deepEqual(posts(/^\/api\/project-clones$/).at(-1).body, {
            url: "https://github.com/acme/widget.git",
            branch: "dev",
            secret: "GITHUB_PAT",
            shallow: true
        });
        assert.match(form.querySelector(".clone-progress").textContent, /Receiving objects/);
        assert.match(form.querySelector(".clone-progress").textContent, /40%/);
        assert.ok(input(form, "url").disabled, "the form is locked while git runs");

        const project = { id: "prj-widget", name: "widget", rootPath: "/srv/projects/widget" };
        console_.reply("/api/project-clones/clone-1", { job: { ...job, status: "succeeded", percent: 100, project } });
        console_.reply("/api/projects", { projects: [project] });

        await new Promise(resolve => setTimeout(resolve, 900));
        await settle();

        assert.notEqual(modal(), form, "the dialog closed");
        assert.equal(byId("activeProjectName").textContent, "widget");
    });

    await test("a refused clone says why and keeps the form", async () => {

        byId("newProjectButton").dispatch("click");
        await settle();

        const form = modal();
        button(form, "From git URL").dispatch("click");
        await settle();

        button(form, "Clone").dispatch("click");
        await settle();
        assert.equal(form.querySelector(".mcp-message").textContent, "a repository URL is required");

        input(form, "url").value = "file:///etc";
        console_.reply("POST /api/project-clones", { __status: 400, body: { error: "only https, http, ssh and git@host:path URLs can be cloned" } });
        button(form, "Clone").dispatch("click");
        await settle();
        assert.match(form.querySelector(".mcp-message").textContent, /only https/);

        button(form, "Cancel").dispatch("click");
        await settle();
    });

    await test("interrupted conversations get Continue and Dismiss", async () => {

        const items = [
            { id: "s-1", project_id: null, title: "Fix the build", task: "fix the build", interrupted_at: new Date().toISOString(), messages: 4 },
            { id: "s-2", project_id: null, title: "Write docs", task: "write docs", interrupted_at: new Date().toISOString(), messages: 2 }
        ];

        console_.reply("/api/interrupted", { sessions: items });
        console_.send({ type: "session:interrupted", sessions: items });
        await settle();

        const banner = byId("interruptedBanner");
        assert.match(banner.textContent, /2 conversations were interrupted/);
        assert.match(banner.textContent, /Fix the build/);

        console_.reply("POST /api/interrupted/s-1/resume", { __status: 202, body: { ok: true, id: "s-1", where: "foreground" } });
        button(banner.querySelectorAll(".interrupted-item")[0], "Continue").dispatch("click");
        await settle();

        assert.equal(posts(/^\/api\/interrupted\/s-1\/resume$/).length, 1);
        assert.doesNotMatch(banner.textContent, /Fix the build/);

        console_.reply("DELETE /api/interrupted/s-2", { __status: 409, body: { error: "busy" } });
        button(banner.querySelector(".interrupted-item"), "Dismiss").dispatch("click");
        await settle();
        assert.match(banner.textContent, /Write docs: busy/, "a failure is shown and the entry stays");

        console_.reply("DELETE /api/interrupted/s-2", { ok: true, id: "s-2", status: "cancelled" });
        button(banner.querySelector(".interrupted-item"), "Dismiss").dispatch("click");
        await settle();
        assert.equal(banner.textContent.trim(), "", "nothing left to show");
    });

    await test("System shows the resources, warns and stops a process", async () => {

        const snapshot = {
            at: new Date().toISOString(),
            platform: "linux 6.1",
            node: "v22.0.0",
            uptime_ms: 3_600_000,
            cpu: { cores: 1, load: [0.5, 0.4, 0.3], percent: 37 },
            memory: { total_bytes: 2 * 1024 ** 3, available_bytes: 150 * 1024 ** 2, used_percent: 92.7, process_rss_bytes: 180 * 1024 ** 2, process_heap_bytes: 1 },
            disks: [{ label: "data home, workspace", path: "/var/lib/structured-ai", total_bytes: 20 * 1024 ** 3, free_bytes: 8 * 1024 ** 3 }],
            runs: { active: 2, active_projects: 2, queued: 1, max_concurrent_projects: 4, max_runs_per_project: 1, max_total: 8 },
            processes: [{ id: "p-1", pid: 4242, command: "npm run dev", project_id: "prj-widget", run_id: null, run_active: false, started_at: new Date(Date.now() - 120000).toISOString() }],
            warnings: [{ kind: "memory", message: "Memory is low: 150 MB available (RESOURCE_MIN_FREE_MEMORY_MB=200)." }]
        };

        console_.reply("GET /api/system", snapshot);

        byId("systemButton").dispatch("click");
        await settle();

        const view = modal();
        assert.match(view.textContent, /37%/);
        assert.match(view.textContent, /150\.0 MB free/);
        assert.match(view.textContent, /Memory is low/);
        assert.match(view.textContent, /2 running/);
        assert.match(view.textContent, /1 waiting/);
        assert.match(view.textContent, /npm run dev/);
        assert.ok(view.querySelector(".system-meter.warning"), "the memory meter is marked");
        assert.ok(byId("systemButton").className.includes("alert"), "the header button turns amber");

        console_.reply("POST /api/system/processes/p-1/stop", { ok: true, id: "p-1", status: "stopping" });
        button(view, "Stop").dispatch("click");
        await settle();
        assert.equal(posts(/^\/api\/system\/processes\/p-1\/stop$/).length, 1);

        view.querySelector(".modal-close, [aria-label=Close]")?.dispatch("click");
        await settle();
    });

    await test("a conversation over the server-wide limit is badged waiting", async () => {

        const { badgeOf } = await import(require("url").pathToFileURL(require("path").join(__dirname, "..", "..", "..", "web", "public", "app", "conversation-tabs-view.js")).href);

        assert.equal(badgeOf({ status: "running", waiting_for_slot: true, pending_approvals: 0 }), "waiting");
        assert.equal(badgeOf({ status: "running", waiting_for_slot: false, pending_approvals: 0 }), "running");
        assert.equal(badgeOf({ status: "running", waiting_for_slot: true, pending_approvals: 1 }), "awaiting", "an approval comes first");
    });
};
