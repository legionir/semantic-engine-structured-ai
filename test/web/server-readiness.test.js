"use strict";

/*
|--------------------------------------------------------------------------
| Server readiness (roadmap P1-02, P1-07, P1-08)
|--------------------------------------------------------------------------
|
|   P1-02  a new project from a git URL: what the URL, branch and folder
|          may be; a clone over HTTP registers the project and reports
|          its progress; a duplicate folder is refused; a failed clone
|          leaves nothing behind; a token reaches git as a header and is
|          stored nowhere; a project-scoped token cannot clone.
|   P1-07  the resource snapshot and its warnings; the orphan ledger kills
|          only a verified orphan; /api/system and stopping a process.
|   P1-08  the doctor's checks; `agent resume` parsing.
|
| The repository is served over git's "dumb" HTTP protocol by a static
| file server, so nothing leaves the machine (a dumb server cannot do a
| shallow clone, so the clones here are full).
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { removeTempDirs } = require("../helpers/cleanup");

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const WORKSPACE = temp("ready-ws-");
const DATA_HOME = temp("ready-data-");
const SERVED = temp("ready-git-");
const PROJECTS = path.join(DATA_HOME, "cloned");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.PROJECTS_ROOT = PROJECTS;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    "scoped-token-0123456789": { allowedProjects: ["prj-other"], permissions: ["project:read", "project:write"] }
});
delete process.env.GIT_CLONE_TOKEN;
delete process.env.GITHUB_PAT;
delete process.env.GITLAB_TOKEN;

const REPO = path.resolve(__dirname, "..", "..");

const authorizations = [];


/* a repository with two branches, published for dumb HTTP */
function buildRepository() {

    const source = path.join(SERVED, "src");
    const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: "pipe" });

    fs.mkdirSync(source);
    git(["init", "-q", "-b", "main"], source);
    git(["config", "user.email", "test@example.com"], source);
    git(["config", "user.name", "Clone Test"], source);
    fs.writeFileSync(path.join(source, "README.md"), "main branch\n");
    git(["add", "README.md"], source);
    git(["commit", "-q", "-m", "first"], source);
    git(["checkout", "-q", "-b", "dev"], source);
    fs.writeFileSync(path.join(source, "DEV.md"), "dev branch\n");
    git(["add", "DEV.md"], source);
    git(["commit", "-q", "-m", "dev"], source);
    git(["checkout", "-q", "main"], source);

    git(["clone", "-q", "--bare", source, path.join(SERVED, "repo.git")], SERVED);
    git(["update-server-info"], path.join(SERVED, "repo.git"));
}


const files = http.createServer((req, res) => {

    authorizations.push(req.headers.authorization || null);

    const file = path.join(SERVED, decodeURIComponent(req.url.split("?")[0]));

    if (!file.startsWith(SERVED) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404;
        res.end();
        return;
    }

    res.end(fs.readFileSync(file));
});


const results = [];

async function test(name, fn) {

    try {

        await fn();
        results.push(true);
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push(false);
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack}`);
    }
}


async function waitFor(check, label, ms = 30000) {

    const deadline = Date.now() + ms;

    while (Date.now() < deadline) {

        const value = await check();

        if (value) return value;

        await new Promise(done => setTimeout(done, 100));
    }

    throw new Error(`timed out waiting for ${label}`);
}


async function main() {

    buildRepository();
    await new Promise(resolve => files.listen(0, "127.0.0.1", resolve));

    const gitBase = `http://127.0.0.1:${files.address().port}`;

    const ProjectClone = require(path.join(REPO, "agent", "projects", "ProjectClone.js"));
    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    const web = createServer(runtime, { apiRateLimit: 100000 });
    const address = await web.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;

    const api = async (method, url, body, token = web.token) => {

        const response = await fetch(`${base}${url}`, {
            method,
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        return { status: response.status, body: await response.json().catch(() => null) };
    };

    const finished = async id =>
        waitFor(async () => {
            const { body } = await api("GET", `/api/project-clones/${encodeURIComponent(id)}`);
            return body && body.job && body.job.status !== "running" ? body.job : null;
        }, `clone ${id}`);

    /* ------------------------------------------------------------ P1-02 */

    await test("clone URLs: https, http, ssh and scp-like only; no credentials, options or local paths", () => {

        for (const good of ["https://github.com/a/b.git", "http://host:8080/x/y", "ssh://git@host/a/b.git", "git@github.com:a/b.git"]) {
            assert.ok(ProjectClone.parseUrl(good).url, good);
        }

        for (const bad of ["file:///tmp/x", "ext::sh -c id", "-uhttps://x/y", "https://u:p@github.com/a/b", "/tmp/repo", "https://github.com/a/b?x=1", "https://github.com/a/b#frag", ""]) {
            assert.throws(() => ProjectClone.parseUrl(bad), undefined, bad);
        }

        assert.equal(ProjectClone.repoName("https://github.com/a/my-repo.git"), "my-repo");
    });

    await test("the folder is one plain name inside the projects root", () => {

        for (const bad of ["../x", "a/b", "a\\b", ".hidden", "x.", "", ".."]) {
            assert.throws(() => ProjectClone.checkFolderName(bad), undefined, bad);
        }

        assert.equal(ProjectClone.checkFolderName("my-repo_2"), "my-repo_2");
        assert.throws(() => ProjectClone.checkBranch("--upload-pack=x"));
        assert.throws(() => ProjectClone.checkBranch("a..b"));
        assert.equal(ProjectClone.checkBranch("feature/x"), "feature/x");
        assert.equal(path.resolve(ProjectClone.projectsRoot()), path.resolve(PROJECTS));
    });

    await test("git's progress lines become a phase and a percentage", () => {

        assert.deepEqual(ProjectClone.parseProgress("Receiving objects:  45% (9/20)"), { phase: "Receiving objects", percent: 45 });
        assert.equal(ProjectClone.parseProgress("hello"), null);
    });

    let clonedProject = null;

    await test("POST /api/project-clones clones a branch and registers the project", async () => {

        const started = await api("POST", "/api/project-clones", { url: `${gitBase}/repo.git`, branch: "dev", name: "Cloned Dev" });

        assert.equal(started.status, 202, JSON.stringify(started.body));
        assert.equal(started.body.job.status, "running");
        assert.equal(started.body.job.path, path.join(path.resolve(PROJECTS), "repo"));
        assert.equal(started.body.job.token, undefined, "the job view carries no token field");

        const job = await finished(started.body.job.id);

        assert.equal(job.status, "succeeded", job.error);
        assert.equal(job.percent, 100);
        assert.ok(fs.existsSync(path.join(job.path, "DEV.md")), "the dev branch is checked out");
        assert.ok(job.project && job.project.id, "registered");
        clonedProject = job.project;

        const listed = await api("GET", "/api/projects");
        const project = listed.body.projects.find(item => item.id === clonedProject.id);
        assert.ok(project, "in the project list");
        assert.equal(project.name, "Cloned Dev");

        const jobs = await api("GET", "/api/project-clones");
        assert.equal(path.resolve(jobs.body.root), path.resolve(PROJECTS));
        assert.ok(jobs.body.jobs.some(item => item.id === job.id));
    });

    await test("a folder that is already there is refused (409)", async () => {

        const again = await api("POST", "/api/project-clones", { url: `${gitBase}/repo.git` });

        assert.equal(again.status, 409, JSON.stringify(again.body));
        assert.match(again.body.error, /already/);
    });

    await test("a failed clone reports git's error and removes its folder", async () => {

        const started = await api("POST", "/api/project-clones", { url: `${gitBase}/missing.git`, folder: "missing" });
        assert.equal(started.status, 202);

        const job = await finished(started.body.job.id);

        assert.equal(job.status, "failed");
        assert.ok(job.error, "an error is reported");
        assert.ok(!fs.existsSync(path.join(PROJECTS, "missing")), "nothing is left behind");
    });

    await test("bad requests are refused before git runs", async () => {

        assert.equal((await api("POST", "/api/project-clones", { url: "file:///etc" })).status, 400);
        assert.equal((await api("POST", "/api/project-clones", { url: `${gitBase}/repo.git`, folder: "../escape" })).status, 400);
        assert.equal((await api("GET", "/api/project-clones/clone-nope")).status, 404);
    });

    await test("a token reaches git as a header and is stored nowhere", async () => {

        process.env.GIT_CLONE_TOKEN = "tok-secret-123";

        try {

            const before = authorizations.length;
            const started = await api("POST", "/api/project-clones", { url: `${gitBase}/repo.git`, folder: "with-token" });
            const job = await finished(started.body.job.id);

            assert.equal(job.status, "succeeded", job.error);
            assert.equal(job.credentials, "GIT_CLONE_TOKEN");
            assert.ok(!JSON.stringify(job).includes("tok-secret-123"), "not in the job");

            const sent = authorizations.slice(before).filter(Boolean);
            assert.ok(sent.length > 0, "an Authorization header was sent");
            assert.equal(Buffer.from(sent[0].replace(/^Basic /, ""), "base64").toString(), "x-access-token:tok-secret-123");

            assert.ok(!fs.readFileSync(path.join(job.path, ".git", "config"), "utf8").includes("tok-secret"), "not in .git/config");

        } finally {
            delete process.env.GIT_CLONE_TOKEN;
        }
    });

    await test("a project-scoped token cannot clone", async () => {

        const refused = await api("POST", "/api/project-clones", { url: `${gitBase}/repo.git`, folder: "scoped" }, "scoped-token-0123456789");

        assert.equal(refused.status, 403);
        assert.equal((await api("GET", "/api/project-clones", undefined, "scoped-token-0123456789")).status, 403);
    });

    /* ------------------------------------------------------------ P1-07 */

    const SystemResources = require(path.join(REPO, "agent", "runtime", "SystemResources.js"));

    await test("the resource snapshot has CPU, memory, disks, runs and processes", () => {

        const snapshot = SystemResources.snapshot();

        assert.ok(snapshot.cpu.cores >= 1);
        assert.ok(snapshot.memory.total_bytes > 0 && snapshot.memory.available_bytes > 0);
        assert.ok(snapshot.disks.length >= 1 && snapshot.disks.every(disk => disk.error || disk.free_bytes >= 0));
        assert.ok(snapshot.runs && Number.isInteger(snapshot.runs.max_concurrent_projects));
        assert.ok(Array.isArray(snapshot.processes) && Array.isArray(snapshot.warnings));
    });

    await test("low memory and low disk become warnings", () => {

        const settings = require(path.join(REPO, "agent", "config"));
        const memory = settings.get("RESOURCE_MIN_FREE_MEMORY_MB");
        const disk = settings.get("RESOURCE_MIN_FREE_DISK_MB");

        const warnings = SystemResources.warningsFor({
            memory: { available_bytes: (memory - 1) * 1024 * 1024 },
            disks: [
                { label: "data home", path: "/data", free_bytes: (disk - 1) * 1024 * 1024 },
                { label: "workspace", path: "/ws", free_bytes: (disk + 10) * 1024 * 1024 }
            ]
        });

        assert.deepEqual(warnings.map(item => item.kind), ["memory", "disk"]);
        assert.equal(warnings[1].path, "/data");
    });

    await test("the monitor emits only when a warning appears or clears", () => {

        const emitted = [];
        const settings = require(path.join(REPO, "agent", "config"));
        const original = settings.get("RESOURCE_MIN_FREE_MEMORY_MB");

        settings.set("RESOURCE_MONITOR_INTERVAL_MS", 0);
        settings.set("RESOURCE_MIN_FREE_MEMORY_MB", 10_000_000);

        const monitor = SystemResources.startMonitor((type, payload) => emitted.push({ type, ...payload }));

        try {

            monitor.tick();
            assert.equal(emitted.filter(item => item.kind === "memory").length, 1, "once, not per tick");

            settings.set("RESOURCE_MIN_FREE_MEMORY_MB", original);
            monitor.tick();

            const memory = emitted.filter(item => item.kind === "memory");
            assert.equal(memory.length, 2);
            assert.equal(memory[1].level, "ok");
            assert.ok(emitted.every(item => item.type === "system:resources"));

        } finally {
            monitor.stop();
            settings.set("RESOURCE_MIN_FREE_MEMORY_MB", original);
        }
    });

    await test("the orphan sweep kills only a verified orphan of a dead console", async () => {

        const ledger = require(path.join(REPO, "agent", "tools", "process", "ProcessLedger.js"));

        const dead = spawn(process.execPath, ["-e", ""]);
        await new Promise(resolve => dead.once("exit", resolve));

        const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);

        try {

            await waitFor(() => Number.isInteger(orphan.pid), "the orphan to start");

            const start = ledger.startTicks(orphan.pid);

            fs.mkdirSync(path.dirname(ledger.ledgerFile()), { recursive: true });
            fs.writeFileSync(ledger.ledgerFile(), JSON.stringify({
                processes: {
                    [`${dead.pid}:orphan`]: { owner_pid: dead.pid, id: "orphan", pid: orphan.pid, group: false, start, command: "node orphan" },
                    [`${dead.pid}:reused`]: { owner_pid: dead.pid, id: "reused", pid: orphan.pid, group: false, start: "1", command: "node reused" },
                    [`${process.pid}:mine`]: { owner_pid: process.pid, id: "mine", pid: orphan.pid, group: false, start, command: "node mine" }
                }
            }));

            const killed = [];
            const result = ledger.sweep({ killImpl: (pid, signal) => killed.push({ pid, signal }) });

            if (start) {
                assert.deepEqual(result.stopped.map(item => item.id), ["orphan"]);
                assert.deepEqual(killed, [{ pid: orphan.pid, signal: "SIGKILL" }]);
                assert.equal(result.skipped.find(item => item.id === "reused").reason, "pid reused by another process");
            } else {
                /* no /proc: nothing can be verified, so nothing is killed */
                assert.equal(killed.length, 0);
                assert.ok(result.skipped.every(item => item.reason === "cannot verify the process"));
            }

            assert.deepEqual(Object.keys(ledger.read()), [`${process.pid}:mine`], "a live console's entry is kept");

        } finally {
            orphan.kill("SIGKILL");
            fs.rmSync(ledger.ledgerFile(), { force: true });
        }
    });

    await test("GET /api/system answers the admin token only", async () => {

        const system = await api("GET", "/api/system");

        assert.equal(system.status, 200);
        assert.ok(system.body.cpu && system.body.memory && Array.isArray(system.body.disks));

        assert.equal((await api("GET", "/api/system", undefined, "scoped-token-0123456789")).status, 403);
    });

    await test("POST /api/system/processes/:id/stop stops a background process", async () => {

        assert.equal((await api("POST", "/api/system/processes/p-nope/stop")).status, 404);

        const ProcessManager = require(path.join(REPO, "agent", "tools", "process", "ProcessManager.js"));
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
        const exited = new Promise(resolve => child.once("exit", resolve));

        ProcessManager.SESSIONS.set("p-test", { id: "p-test", pid: child.pid, child, status: "running", command: "node", started_at: Date.now() });

        try {

            const stopped = await api("POST", "/api/system/processes/p-test/stop");
            assert.equal(stopped.status, 200);
            assert.equal(stopped.body.status, "stopping");

            await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("not stopped")), 5000))]);

            const listed = await api("GET", "/api/system");
            assert.ok(listed.body.processes.some(item => item.id === "p-test"), "still listed until its session settles");

        } finally {
            ProcessManager.SESSIONS.delete("p-test");
            child.kill("SIGKILL");
        }
    });

    /* ------------------------------------------------------------ P1-08 */

    await test("doctor: Node.js version, a busy port, writable folders", async () => {

        const doctor = require(path.join(REPO, "agent", "cli", "ServerDoctor.js"));

        assert.equal(doctor.nodeCheck(">=20").status, Number(process.versions.node.split(".")[0]) >= 20 ? "ok" : "fail");
        assert.equal(doctor.nodeCheck(">=999").status, "fail");

        assert.equal((await doctor.portCheck("127.0.0.1", address.port)).status, "fail", "the test server holds this port");
        assert.equal((await doctor.portCheck("127.0.0.1", address.port, false)).status, "warn", "a default port in use only warns");

        const report = await doctor.diagnose({
            host: "127.0.0.1",
            port: address.port,
            workspace: WORKSPACE,
            runner: () => ({ status: 0, stdout: "git version 9.9.9\n" })
        });

        const byName = Object.fromEntries(report.checks.map(item => [item.name, item]));

        assert.equal(byName.git.detail, "git version 9.9.9");
        assert.equal(byName["data home"].status, "ok");
        assert.equal(byName.workspace.status, "ok");
        assert.equal(byName.port.status, "fail");
        assert.equal(report.ok, false);
        assert.match(doctor.formatReport(report), /FAIL {2}port/);

        const noGit = await doctor.diagnose({ port: 1, explicitPort: false, workspace: WORKSPACE, runner: () => ({ error: new Error("ENOENT") }) });
        assert.equal(noGit.checks.find(item => item.name === "git").status, "warn");
    });

    await test("agent resume [id] [message] parses", () => {

        const { parseArguments: parseArgs } = require(path.join(REPO, "agent", "cli", "ArgParser.js"));

        const latest = parseArgs(["resume"]);
        assert.equal(latest.resume, true);
        assert.equal(latest.resumeId, undefined);
        assert.deepEqual(latest.positional, []);

        const named = parseArgs(["resume", "s-2026-11-25T10-00-00-000Z-ab12cd", "and", "then", "test"]);
        assert.equal(named.resumeId, "s-2026-11-25T10-00-00-000Z-ab12cd");
        assert.deepEqual(named.positional, ["and", "then", "test"]);

        const message = parseArgs(["resume", "keep going"]);
        assert.equal(message.resumeId, undefined);
        assert.deepEqual(message.positional, ["keep going"]);
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    try {
        if (typeof web.closeAllConnections === "function") web.closeAllConnections();
        await Promise.race([new Promise(done => web.close(done)), new Promise(done => setTimeout(done, 1000))]);
        await runtime.shutdown?.();
    } catch {
        /* best effort */
    }

    files.close();

    await removeTempDirs(runtime, WORKSPACE, DATA_HOME, SERVED);

    process.exit(failed === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
