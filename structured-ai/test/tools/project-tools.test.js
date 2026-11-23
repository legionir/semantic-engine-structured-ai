"use strict";

/*
|--------------------------------------------------------------------------
| Project-Aware Tool Tests — EXECUTION_PLAN Phase 4
|--------------------------------------------------------------------------
|
| Locks the phase-4 acceptance criteria:
|   1. tools resolve inside the calling run's project root — a tool of
|      project A cannot read or write project B's files, and a symlink
|      placed inside A that points into B is refused (security test)
|   2. terminal runs with the project's cwd; git works in the project's
|      repository; process sessions are owned per project
|   3. identity never travels as a tool argument (rule 9): projectId in
|      model arguments or a projectId context without the context itself
|      is an error; modular mode refuses context-less tool execution
|   4. two concurrent runs on two different ROOTS keep their tool
|      results, telemetry and claim checks fully isolated (end-to-end
|      with the phase-3 RunManager)
|   5. no model-facing project tool exists (گام ۴): neither the
|      implementation catalogue nor the model-facing resolveTools("*")
|      exposes a project-management tool
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p4-rootA-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p4-rootB-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p4-data-"));

process.env.WORKSPACE_ROOT = ROOT_A;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.MAX_RUN_MS = "15000";
process.env.MAX_REQUEST_MS = "10000";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const tools = require(path.join(ROOT, "agent", "tools"));

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);

    }
}


const projects = runtime.projects;
const { execFileSync } = require("child_process");


function contextFor(project) {

    return {
        agent: "main_agent",
        runId: `run-probe-${project.id}`,
        projectId: project.id,
        projectContext: projects.createProjectContext(project)
    };

}


async function expectThrow(promise, pattern, what) {

    let thrown = null;

    try {
        await promise;
    } catch (error) {
        thrown = error;
    }

    assert.ok(thrown, `${what}: expected an error, got success`);

    assert.match(
        thrown.message,
        pattern,
        `${what}: error "${thrown.message}" does not match ${pattern}`
    );

}


function finalAction(content, performed) {

    return {
        version: "1.0",
        tool_calls: null,
        delegations: null,
        response: { type: "text", content },
        data: null,
        error: null,
        action: "final",
        performed: performed ?? null
    };

}


function toolCallAction(name, args) {

    return {
        version: "1.0",
        tool_calls: [
            {
                id: "call_1",
                name,
                arguments: args,
                depends_on: []
            }
        ],
        delegations: null,
        response: null,
        data: null,
        error: null,
        action: "tool_call",
        performed: null
    };

}


async function main() {

    const projectA =
        projects.registry().register({ name: "Root Alpha", rootPath: ROOT_A });

    const projectB =
        projects.registry().register({ name: "Root Beta", rootPath: ROOT_B });

    fs.writeFileSync(path.join(ROOT_A, "alpha.txt"), "alpha data");
    fs.writeFileSync(path.join(ROOT_B, "secret.txt"), "beta secret");


    await test("fs_read_many reads every item inside the caller's project (not the default project)", async () => {

        const ctxB = contextFor(projectB);
        const ctxA = contextFor(projectA);

        /* ROOT_A is the process/default workspace; secret.txt only exists in B */

        const many =
            await tools.executeTool("fs_read_many", { paths: ["secret.txt"] }, ctxB);

        assert.equal(many.succeeded, 1);
        assert.equal(many.files[0].content, "beta secret");
        assert.equal(many.files[0].path, "secret.txt");

        /* the same item is NOT visible from project A, and an absolute path into B is refused */

        const fromA =
            await tools.executeTool(
                "fs_read_many",
                { paths: ["secret.txt", path.join(ROOT_B, "secret.txt")] },
                ctxA
            );

        assert.equal(fromA.succeeded, 0);
        assert.ok(fromA.files.every(file => file.success === false));
        assert.match(fromA.files[1].error, /outside workspace/i);
    });


    await test("search handles belong to their project: get / list / stop never cross projects", async () => {

        const ctxA = contextFor(projectA);
        const ctxB = contextFor(projectB);

        const started =
            await tools.executeTool("search_start", { query: "alpha", mode: "content" }, ctxA);

        const id = started.search_id || started.id;

        assert.ok(id, "search_start returned no handle");

        const own =
            await tools.executeTool("search_get", { search_id: id, wait_ms: 500 }, ctxA);

        assert.ok(own, "the owner can read its own search");

        await expectThrow(
            tools.executeTool("search_get", { search_id: id }, ctxB),
            /Unknown search/,
            "foreign search_get"
        );

        await expectThrow(
            tools.executeTool("search_stop", { search_id: id }, ctxB),
            /Unknown search/,
            "foreign search_stop"
        );

        const listB = await tools.executeTool("search_list", {}, ctxB);
        const listA = await tools.executeTool("search_list", {}, ctxA);

        assert.ok(!listB.searches.some(item => item.id === id || item.search_id === id));
        assert.ok(listA.count >= 1);
        assert.equal(listB.count, 0);
    });


    await test("fs tools act in the caller's project and refuse foreign paths", async () => {

        /* unscoped layer probes use the implicit default
           context, exactly like executeTool receives it in a run. */

        const ctxA = contextFor(projectA);
        const ctxB = contextFor(projectB);

        /* own-root reads work through the context and report the
           project-relative path, never an absolute one */

        const readA =
            await tools.executeTool("fs_read", { path: "alpha.txt" }, ctxA);

        assert.equal(readA.content, "alpha data");
        assert.equal(readA.path, "alpha.txt");

        const readB =
            await tools.executeTool("fs_read", { path: "secret.txt" }, ctxB);

        assert.equal(readB.content, "beta secret");
        assert.equal(readB.path, "secret.txt");

        /* project A's tool cannot reach project B's absolute path */

        await expectThrow(
            tools.executeTool(
                "fs_read",
                { path: path.join(ROOT_B, "secret.txt") },
                ctxA
            ),
            /outside workspace/i,
            "cross-project absolute read"
        );

        /* ... nor escape through ".." */

        await expectThrow(
            tools.executeTool(
                "fs_read",
                { path: `../${path.basename(ROOT_B)}/secret.txt` },
                ctxA
            ),
            /outside workspace/i,
            "cross-project relative escape"
        );

        /* writes stay put too */

        const written =
            await tools.executeTool(
                "fs_write",
                { path: "note.txt", content: "for A" },
                ctxA
            );

        assert.equal(written.path, "note.txt");
        assert.ok(
            fs.existsSync(path.join(ROOT_A, "note.txt")) &&
            !fs.existsSync(path.join(ROOT_B, "note.txt")),
            "fs_write ignored the project boundary"
        );

    });


    await test("a symlink inside project A pointing into B is refused", async () => {

        const link = path.join(ROOT_A, "escape-hatch");

        try {
            fs.symlinkSync(ROOT_B, link, "dir");
        } catch (error) {

            console.log(`       (symlink unavailable here: ${error.code}; skipping)`);
            return;
        }

        const ctxA = contextFor(projectA);

        await expectThrow(
            tools.executeTool("fs_read", { path: "escape-hatch/secret.txt" }, ctxA),
            /escapes the workspace through a symlink/i,
            "symlink escape read"
        );

        await expectThrow(
            tools.executeTool(
                "fs_write",
                { path: "escape-hatch/planted.txt", content: "x" },
                ctxA
            ),
            /escapes the workspace through a symlink/i,
            "symlink escape write"
        );

        assert.ok(
            !fs.existsSync(path.join(ROOT_B, "planted.txt")),
            "a write escaped through the symlink"
        );

    });


    await test("terminal uses the project cwd and process sessions are per-project", async () => {

        const ctxA = contextFor(projectA);
        const ctxB = contextFor(projectB);

        const pwd =
            await tools.executeTool(
                "terminal_exec",
                { command: `"${process.execPath}" -p "process.cwd()"` },
                ctxB
            );

        assert.equal(
            pwd.stdout.trim(),
            fs.realpathSync(ROOT_B),
            "terminal_exec ran in the wrong directory"
        );

        const started =
            await tools.executeTool(
                "process_start",
                { command: `"${process.execPath}" -e "setTimeout(() => {}, 30000)"` },
                ctxB
            );

        assert.ok(started.process_id, "process_start returned no id");

        /* A sees neither B's session in its list nor through direct
           addressing; B does. */

        const listA =
            await tools.executeTool(
                "process_list",
                { include_finished: true },
                ctxA
            );

        assert.ok(
            !JSON.stringify(listA).includes(started.process_id),
            "project A sees project B's process session"
        );

        await expectThrow(
            tools.executeTool(
                "process_read",
                { process_id: started.process_id, peek: true },
                ctxA
            ),
            /Unknown process/,
            "cross-project session access"
        );

        const readB =
            await tools.executeTool(
                "process_read",
                { process_id: started.process_id, peek: true },
                ctxB
            );

        assert.equal(readB.process_id, started.process_id);

        await tools.executeTool(
            "process_terminate",
            { process_id: started.process_id },
            ctxB
        );

    });


    await test("git tools operate in the project's own repository", async () => {

        execFileSync("git", ["init", "-q"], { cwd: ROOT_B });
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: ROOT_B });
        execFileSync("git", ["config", "user.name", "Phase4 Test"], { cwd: ROOT_B });
        execFileSync("git", ["add", "secret.txt"], { cwd: ROOT_B });
        execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: ROOT_B });

        const ctxB = contextFor(projectB);

        const status =
            await tools.executeTool("git_status", {}, ctxB);

        assert.match(status.stdout, /##\s/);
        assert.equal(status.cwd, ".");

        const log =
            await tools.executeTool("git_log", { limit: 5 }, ctxB);

        assert.match(log.stdout, /seed/);

    });


    await test("file provenance and git status are computed in each project's own root", async () => {

        /* project B (ROOT_B) is rooted OUTSIDE the process workspace and is a git repo */

        const ctxB = { ...contextFor(projectB), runId: "run-prov-b" };
        const ctxA = { ...contextFor(projectA), runId: "run-prov-a" };

        tools.telemetry.reset(ctxB.runId, ROOT_B);
        tools.telemetry.reset(ctxA.runId, ROOT_A);

        await tools.executeTool("fs_write", { path: "prov-b.txt", content: "b" }, ctxB);
        await tools.executeTool("fs_write", { path: "prov-a.txt", content: "a" }, ctxA);

        const changedB = tools.telemetry.changedFiles(ctxB.runId);
        const changedA = tools.telemetry.changedFiles(ctxA.runId);

        assert.ok(changedB.includes("prov-b.txt"), `B lost its own change: ${JSON.stringify(changedB)}`);
        assert.ok(!changedB.includes("prov-a.txt"), "A's change leaked into B");
        assert.ok(changedA.includes("prov-a.txt"), `A lost its own change: ${JSON.stringify(changedA)}`);
        assert.ok(!changedA.includes("prov-b.txt"), "B's change leaked into A");

        /* an ABSOLUTE path inside the project root is normalised against that project's root */

        await tools.executeTool(
            "fs_write",
            { path: path.join(ROOT_B, "prov-abs.txt"), content: "x" },
            ctxB
        );

        assert.ok(tools.telemetry.changedFiles(ctxB.runId).includes("prov-abs.txt"));

        /* B's repository status is read from ROOT_B, not from the process workspace */

        assert.ok(tools.telemetry.dirtyFiles(ctxB.runId).includes("prov-b.txt"));
    });


    await test("project identity never travels through arguments (rule 9)", async () => {

        const ctxA = contextFor(projectA);

        await expectThrow(
            tools.executeTool(
                "fs_read",
                { path: "alpha.txt", projectId: projectB.id },
                ctxA
            ),
            /rule 9/,
            "identity as a tool argument"
        );

        await expectThrow(
            tools.executeTool(
                "fs_read",
                { path: "alpha.txt" },
                { agent: "main_agent", runId: "r-x", projectId: projectA.id }
            ),
            /projectId without a project context|rule 9/,
            "projectId context without the context itself"
        );

        /* Direct callers without a run still receive the implicit default
           workspace boundary; project-aware runs pass the explicit context
           above. This keeps the public tool API usable while preventing
           forged identity in either channel. */

        const implicit =
            await tools.executeTool("fs_read", { path: "alpha.txt" }, undefined);
        assert.match(implicit.content, /alpha/);

        const projectless =
            await tools.executeTool("fs_read", { path: "alpha.txt" }, { agent: "main_agent" });
        assert.match(projectless.content, /alpha/);

    });


    await test("tools pending awareness fail loudly on foreign roots", async () => {

        const ctxB = contextFor(projectB);

        /* runtime_stats still reports the process-wide workspace; on a
           project rooted elsewhere it must say so, not misreport. */

        await expectThrow(
            tools.executeTool("runtime_stats", {}, ctxB),
            /not yet project-aware/,
            "pending tool on a foreign root"
        );

        /* on a workspace-rooted project the same call is untouched */

        const stats =
            await tools.executeTool("runtime_stats", {}, contextFor(projectA));

        assert.ok(typeof stats.total_calls === "number");

    });


    await test("tool execution telemetry carries run and project attribution", async () => {

        const ctxA = contextFor(projectA);

        await tools.executeTool("fs_read", { path: "alpha.txt" }, ctxA);

        const scoped = tools.telemetry._buckets.get(ctxA.runId);

        assert.ok(scoped, "no per-run telemetry bucket was kept");

        const entry =
            scoped.recent.find(item => item.tool === "fs_read");

        assert.ok(entry, "the scoped entry is missing");
        assert.equal(entry.run_id, ctxA.runId);
        assert.equal(entry.project_id, projectA.id);

        assert.ok(
            tools.telemetry.executedToolNames(ctxA.runId).includes("fs_read")
        );

        assert.ok(
            !tools.telemetry.executedToolNames(`${ctxA.runId}-other`).length,
            "an unknown run id must report no tools"
        );

    });


    await test("no model-facing project tool exists anywhere", async () => {

        /* گام ۴: project selection is a Web API / UI concern only. */

        for (const name of tools.callableToolNames()) {
            assert.ok(
                !/project/i.test(name),
                `model-facing tool catalogue exposes a project tool: ${name}`
            );
        }

        const declarations =
            runtime.resolveTools("*").map(item => item.name || item.function?.name || "");

        for (const name of declarations) {
            assert.ok(
                !/project/i.test(name),
                `model-facing declarations expose a project tool: ${name}`
            );
        }

    });


    await test("two concurrent runs on two roots keep tools isolated end-to-end", async () => {
        process.env.AGENT_APPROVAL = "auto";

        /* scripted endpoint: each run writes its own artifact via
           fs_write, then claims it in its final answer; the unattended
           approval mode answers the write policy automatically, and it
           is restored below so later tests see the prompt default */

        const MARK_A = "zzp4alpha9d1";
        const MARK_B = "zzp4beta52f";

        const stub = {
            requests: [],
            server: http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => { body += chunk; });
                req.on("end", () => {

                    const parsed = JSON.parse(body);
                    const text = JSON.stringify(parsed.messages || []);

                    const marker =
                        text.includes(MARK_A) ? "A"
                        : text.includes(MARK_B) ? "B"
                        : "none";

                    stub.requests.push(marker);

                    /* the follow-up request after a tool call carries
                       the tool result -> answer final */
                    const cycled =
                        stub.requests.filter(item => item === marker).length;

                    const action =
                        cycled <= 1
                            ? toolCallAction("fs_write", {
                                  path: "artifact.txt",
                                  content: `written-by-${marker}`
                              })
                            : finalAction(
                                  `done-${marker}`,
                                  { tools: ["fs_write"] }
                              );

                    const message = {
                        role: "assistant",
                        content: JSON.stringify(action)
                    };

                    const respond = () => {

                        res.setHeader("content-type", "application/json");
                        res.end(JSON.stringify({ choices: [{ message }] }));
                    };

                    /* force genuine overlap */
                    if (cycled <= 1 && marker === "A") {
                        setTimeout(respond, 250);
                    } else {
                        respond();
                    }
                });
            })
        };

        await new Promise(resolve => stub.server.listen(0, "127.0.0.1", resolve));

        const settings = runtime.settings;

        settings.set("AGENT_BASE_URL", `http://127.0.0.1:${stub.server.address().port}/v1`);
        settings.set("AGENT_MODEL", "stub-model");

        try {

            const [resultA, resultB] =
                await Promise.all([
                    (async () => {
                        const outcome =
                            await runtime.runAgent({ task: `write artifact ${MARK_A}` });
                        return outcome;
                    })(),
                    runtime.runAgent({
                        task: `write artifact ${MARK_B}`,
                        projectId: projectB.id
                    })
                ]);

            assert.match(String(resultA.response.content), /done-A/);
            assert.match(String(resultB.response.content), /done-B/);

        } finally {

            settings.reset("AGENT_BASE_URL");
            settings.reset("AGENT_MODEL");
            await new Promise(resolve => stub.server.close(resolve));
        }

        /* artifacts landed in the right roots — and only there */

        assert.equal(
            fs.readFileSync(path.join(ROOT_A, "artifact.txt"), "utf8"),
            "written-by-A"
        );

        assert.equal(
            fs.readFileSync(path.join(ROOT_B, "artifact.txt"), "utf8"),
            "written-by-B"
        );

        assert.notEqual(
            fs.readFileSync(path.join(ROOT_A, "artifact.txt"), "utf8"),
            "written-by-B",
            "run B's write leaked into run A's workspace"
        );

        /* per-run telemetry: each run's claim check passed because its
           own bucket held fs_write — cross-contamination would have
           surfaced as a claim mismatch everywhere */

        const wroteRuns =
            [...tools.telemetry._buckets.entries()]
                .filter(([, bucket]) => bucket.per_tool.has("fs_write"));

        assert.ok(
            wroteRuns.length >= 2,
            "both runs should carry their own fs_write tally"
        );

        for (const [, bucket] of wroteRuns) {

            const entry =
                bucket.recent.find(item => item.tool === "fs_write");

            assert.ok(entry.run_id, "telemetry entry lost its run attribution");
            assert.ok(entry.project_id, "telemetry entry lost its project attribution");
        }
        delete process.env.AGENT_APPROVAL;

    });


    fs.rmSync(ROOT_A, { recursive: true, force: true });
    fs.rmSync(ROOT_B, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
