"use strict";

/*
| mvp.test.js: from "project isolation: same basename and independent artifacts"
|
| Runs inside mvp.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function projectIsolationSameBasenameAndIndependentCases(ctx) {

    const {
        MARKER_A,
        MARKER_B,
        MARKER_C,
        ROOT_A,
        ROOT_B,
        WORKSPACE,
        archive,
        ctxA,
        ctxB,
        eventstore,
        finalAction,
        ids,
        manager,
        mcpConfig,
        memoryStore,
        messageText,
        recordA,
        recordB,
        recordC,
        runtime,
        sessions,
        stub,
        test,
        tools,
        workspaceHandler
    } = ctx;

    /* ------------------------------------------------ گام ۱: isolation */

    await test("project isolation: same basename and independent artifacts", async () => {

        const listed = runtime.projects.registry().list();

        assert.ok(listed.some(item => item.id === recordA.id));
        assert.ok(listed.some(item => item.id === recordB.id));
        assert.equal(path.basename(recordA.rootPath), "engine-core");
        assert.equal(path.basename(recordB.rootPath), "engine-core");

        await tools.executeTool(
            "fs_write",
            { path: "artifact.txt", content: `owned-by-a ${MARKER_A}\n` },
            ctxA
        );

        await tools.executeTool(
            "fs_write",
            { path: "artifact.txt", content: `owned-by-b ${MARKER_B}\n` },
            ctxB
        );

        assert.equal(
            fs.readFileSync(path.join(ROOT_A, "artifact.txt"), "utf8"),
            `owned-by-a ${MARKER_A}\n`
        );
        assert.equal(
            fs.readFileSync(path.join(ROOT_B, "artifact.txt"), "utf8"),
            `owned-by-b ${MARKER_B}\n`
        );


    });


    await test("tool isolation: read/write, terminal cwd, git, process sessions", async () => {

        const readA =
            await tools.executeTool("fs_read", { path: "marker.txt" }, ctxA);

        assert.match(readA.content, new RegExp(MARKER_A));

        let thrown = null;

        try {

            await tools.executeTool(
                "fs_read",
                { path: path.join(ROOT_B, "marker.txt") },
                ctxA
            );

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown, "A must not read B's absolute path");
        assert.match(thrown.message, /outside workspace/i);

        /*
        | `pwd` and `sleep` are shell builtins of a POSIX shell only; on
        | Windows the command printed nothing and the isolation check failed
        | on the platform, not on the boundary. Node is the one command every
        | run of this suite can count on.
        */
        const printCwd =
            `"${process.execPath}" -p "process.cwd()"`;

        const pwd =
            await tools.executeTool("terminal_exec", { command: printCwd }, ctxB);

        const normalizePath =
            value =>
                String(value || "").trim().replace(/[\\/]+$/, "").toLowerCase();

        assert.equal(
            normalizePath(pwd.stdout),
            normalizePath(fs.realpathSync(ROOT_B)),
            `terminal cwd escaped project B: ${JSON.stringify(pwd.stdout)}`
        );

        const log =
            await tools.executeTool("git_log", { limit: 5 }, ctxA);

        assert.match(log.stdout, /seed-a/);
        assert.ok(!String(log.stdout).includes("seed-b"));

        const started =
            await tools.executeTool(
                "process_start",
                {
                    command:
                        `"${process.execPath}" -e "setTimeout(() => {}, 30000)"`
                },
                ctxB
            );

        const listA =
            await tools.executeTool(
                "process_list",
                { include_finished: true },
                ctxA
            );

        assert.ok(
            !JSON.stringify(listA).includes(started.process_id),
            "A must not list B's process"
        );

        thrown = null;

        try {

            await tools.executeTool(
                "process_read",
                { process_id: started.process_id, peek: true },
                ctxA
            );

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown);
        assert.match(thrown.message, /Unknown process/);

        await tools.executeTool(
            "process_terminate",
            { process_id: started.process_id },
            ctxB
        );

    });


    await test("runtime isolation: concurrent runs, cancel, labelled delegation", async () => {

        runtime.runScheduler.reset();
        runtime.observability.reset();

        const [outA, outB] = await Promise.all([
            runtime.runAgent({
                projectId: recordA.id,
                task: `Read marker.txt in ${MARKER_A}`
            }),
            runtime.runAgent({
                projectId: recordB.id,
                task: `Read marker.txt in ${MARKER_B}`
            })
        ]);

        assert.match(String(outA.response.content), /finding-A/);
        assert.match(String(outA.response.content), new RegExp(MARKER_A));
        assert.ok(!String(outA.response.content).includes(MARKER_B));
        assert.match(String(outB.response.content), /finding-B/);
        assert.match(String(outB.response.content), new RegExp(MARKER_B));

        const ctxSlow = runtime.runManager.createRun({
            task: `hold ${MARKER_A}`,
            project: runtime.projects.createProjectContext(recordA)
        });

        void ctxSlow;

        stub.state.handler = (parsed) => {

            const text = messageText(parsed);

            return {
                delayMs: text.includes(MARKER_A) ? 400 : 0,
                action: finalAction(
                    text.includes(MARKER_A) ? "slow-a" : "fast-b"
                )
            };

        };

        const slow = runtime.runAgent({
            projectId: recordA.id,
            task: `hold ${MARKER_A}`
        });

        await new Promise(done => setTimeout(done, 40));

        const activeA =
            runtime.runManager.activeRuns().find(run => run.projectId === recordA.id);

        assert.ok(activeA, "run A should be inflight");

        runtime.cancelRunById(activeA.runId, "mvp");

        let cancelled = null;

        try {

            await slow;

        } catch (error) {

            cancelled = error;

        }

        assert.ok(cancelled, "cancelled run A must reject");

        const neighbour = await runtime.runAgent({
            projectId: recordB.id,
            task: `fast ${MARKER_B}`
        });

        assert.match(String(neighbour.response.content), /fast-b/);

        stub.state.handler = workspaceHandler(ids);

        const compared = await runtime.runAgent({
            projectId: recordA.id,
            task: `zzmvp-cross-compare ${MARKER_A} and ${MARKER_B}`
        });

        assert.match(String(compared.response.content), /synthesis/);
        assert.match(String(compared.response.content), /finding-A/);
        assert.match(String(compared.response.content), /finding-B/);

    });


    await test("MCP isolation: tools/list and tools/call stay on one project", async () => {

        assert.equal(
            mcpConfig.serverVisibleTo(
                { scope: "project", projects: [recordA.id] },
                recordB.id
            ),
            false
        );

        manager.workspaceRoot = WORKSPACE;
        manager.loadedAt = Date.now();
        manager.clients.set("alpha-only", {
            config: {
                name: "alpha-only",
                scope: "project",
                projects: [recordA.id],
                enabled: true
            }
        });
        manager.catalogue.set("mcp__alpha-only__echo", {
            name: "mcp__alpha-only__echo",
            server: "alpha-only",
            tool: "echo",
            description: "echo"
        });

        assert.equal(manager.catalogueEntries(recordA.id).length, 1);
        assert.equal(manager.catalogueEntries(recordB.id).length, 0);

        await assert.rejects(
            () => manager.call("alpha-only", "echo", {}, { projectId: recordB.id }),
            /not in scope/
        );


    });


    await test("persistence isolation: memory, plan, session, archive, events", async () => {

        await tools.executeTool(
            "plan_set",
            {
                objective: "objective a",
                phases: [{ title: "Phase one", steps: ["first"] }]
            },
            ctxA
        );

        const planB = await tools.executeTool("plan_get", {}, ctxB);

        assert.equal(planB.phases.length, 0, "B must not see A's plan");

        const memoryA = memoryStore.emptyMemory();

        memoryA.decisions.push("only a");
        memoryStore.saveMemory(memoryA, ctxA);

        assert.deepEqual(memoryStore.loadMemory(ctxB).decisions, []);

        const dataA = runtime.projects.createProjectContext(recordA).dataRoot;
        const dataB = runtime.projects.createProjectContext(recordB).dataRoot;

        const session = sessions.emptySession("s-mvp-a");

        session.messages.push({ role: "user", content: "hello a" });
        sessions.saveSession(session, dataA);

        assert.equal(sessions.listSessions(dataB).length, 0);
        assert.equal(sessions.loadSession("s-mvp-a", dataB), null);

        archive.archiveEvents(
            [{
                tool: "fs_read",
                title: "zzmvp-archive-only-a",
                body: "unique body zzmvp-archive-only-a"
            }],
            { root: dataA }
        );

        assert.equal(
            archive.searchArchive("zzmvp-archive-only-a", { root: dataB }).matches,
            0
        );
        assert.ok(
            archive.searchArchive("zzmvp-archive-only-a", { root: dataA }).matches >= 1
        );

        eventstore.append({
            type: "run:start",
            run_id: "run-mvp-central-a",
            project_id: recordA.id,
            at: Date.parse("2026-08-26T12:00:00Z")
        });

        assert.equal(
            eventstore.query({
                run_id: "run-mvp-central-a",
                root: dataA
            }).length,
            1
        );

        assert.deepEqual(
            eventstore.query({
                run_id: "run-mvp-central-a",
                root: dataB
            }),
            []
        );

    });


    /* ------------------------------------------------ گام ۲: load / recovery */

    await test("load: two heavy projects run, the third queues then finishes", async () => {

        runtime.runScheduler.reset();
        runtime.observability.reset();
        runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 2);

        const started = [];

        stub.state.handler = (parsed) => {

            const text = messageText(parsed);
            const side =
                text.includes(MARKER_A) ? "a" :
                text.includes(MARKER_B) ? "b" :
                text.includes(MARKER_C) ? "c" : "x";

            started.push(side);

            return {
                delayMs: side === "c" ? 0 : 220,
                action: finalAction(`done-${side}`)
            };

        };

        const [a, b, c] = await Promise.all([
            runtime.runAgent({ projectId: recordA.id, task: `heavy ${MARKER_A}` }),
            runtime.runAgent({ projectId: recordB.id, task: `heavy ${MARKER_B}` }),
            runtime.runAgent({ projectId: recordC.id, task: `queued ${MARKER_C}` })
        ]);

        assert.match(a.response.content, /done-a/);
        assert.match(b.response.content, /done-b/);
        assert.match(c.response.content, /done-c/);
        assert.ok(started.includes("c"));
        assert.ok(
            started[0] !== "c" || started[1] !== "c",
            "C must wait behind the concurrent-project cap"
        );

        stub.state.handler = workspaceHandler(ids);

    });
};
