"use strict";

/*
| mvp.test.js: from "recovery: a crashed worker and a cancelled run leave the neighbour running"
|
| Runs inside mvp.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function recoveryACrashedWorkerAndACases(ctx) {

    const {
        MARKER_A,
        MARKER_B,
        createServer,
        ctxA,
        ctxB,
        finalAction,
        ids,
        memoryStore,
        messageText,
        recordA,
        recordB,
        request,
        runtime,
        stub,
        test,
        tools,
        workspaceHandler
    } = ctx;

    await test("recovery: a crashed worker and a cancelled run leave the neighbour running", async () => {

        runtime.observability.reset();
        runtime.observability.recordCrash(recordA.id, "worker-down");

        const healthA = runtime.observability.healthOf(recordA.id);
        const healthB = runtime.observability.healthOf(recordB.id);
        const gatewayHealth = runtime.observability.health();

        assert.equal(healthA.status, "down");
        assert.equal(healthB.status, "ok");
        assert.equal(gatewayHealth.status, "degraded");
        assert.notEqual(gatewayHealth.status, "down");

        stub.state.handler = (parsed) => {

            const text = messageText(parsed);

            return {
                delayMs: text.includes(MARKER_A) ? 500 : 0,
                action: finalAction(text.includes(MARKER_A) ? "hold-a" : "live-b")
            };

        };

        const holding = runtime.runAgent({
            projectId: recordA.id,
            task: `hold ${MARKER_A}`
        });

        await new Promise(done => setTimeout(done, 40));

        const inflight =
            runtime.runManager.activeRuns().find(run => run.projectId === recordA.id);

        if (inflight) {
            runtime.cancelRunById(inflight.runId, "mvp-recovery");
        }

        try {
            await holding;
        } catch {
            /* cancelled */
        }

        const neighbour = await runtime.runAgent({
            projectId: recordB.id,
            task: `live ${MARKER_B}`
        });

        assert.match(String(neighbour.response.content), /live-b/);

        stub.state.handler = workspaceHandler(ids);

    });


    await test("load: a full queue rejects instead of hanging", async () => {

        runtime.runScheduler.reset();
        runtime.settings.set("RUN_QUEUE_LIMIT", 1);
        runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);

        stub.state.handler = () => ({
            delayMs: 350,
            action: finalAction("slow")
        });

        const first = runtime.runAgent({
            projectId: recordA.id,
            task: `hold ${MARKER_A}`
        });

        await new Promise(done => setTimeout(done, 40));

        const second = runtime.runAgent({
            projectId: recordA.id,
            task: `queued ${MARKER_A}`
        });

        let rejected = null;

        try {

            await runtime.runAgent({
                projectId: recordA.id,
                task: `overflow ${MARKER_A}`
            });

        } catch (error) {

            rejected = error;

        }

        assert.ok(rejected, "overflow must be rejected");
        assert.equal(rejected.code, "RUN_QUEUE_FULL");
        assert.equal(rejected.status, 429);

        await first;
        await second;

        runtime.settings.set("RUN_QUEUE_LIMIT", 4);
        stub.state.handler = workspaceHandler(ids);

    });


    /* ------------------------------------------------ گام ۳: ten-step e2e */

    await test("ten-step end-to-end acceptance scenario", async () => {

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const token = server.token;

        try {

            /* 1. Gateway / Web Console is up */
            const home = await fetch(`${baseUrl}/`);

            assert.equal(home.status, 200);

            const html = await home.text();

            assert.match(html, /activeProjectName/);

            /* 2–3. A and B are registered and selectable */
            const listed = await request(baseUrl, "GET", "/api/projects", { token });

            assert.equal(listed.status, 200);

            const listedIds = listed.body.projects.map(item => item.id).sort();

            assert.ok(listedIds.includes("prj-a"));
            assert.ok(listedIds.includes("prj-b"));

            const gotA = await request(baseUrl, "GET", "/api/projects/prj-a", { token });
            const gotB = await request(baseUrl, "GET", "/api/projects/prj-b", { token });

            assert.equal(gotA.status, 200);
            assert.equal(gotB.status, 200);

            /* 4–5. two concurrent tasks, each confined to its workspace */
            stub.state.handler = workspaceHandler(ids);

            const [taskA, taskB] = await Promise.all([
                runtime.runAgent({
                    projectId: recordA.id,
                    task: `Read marker.txt in ${MARKER_A}`
                }),
                runtime.runAgent({
                    projectId: recordB.id,
                    task: `Read marker.txt in ${MARKER_B}`
                })
            ]);

            assert.match(String(taskA.response.content), new RegExp(MARKER_A));
            assert.ok(!String(taskA.response.content).includes(MARKER_B));
            assert.match(String(taskB.response.content), new RegExp(MARKER_B));
            assert.ok(!String(taskB.response.content).includes(MARKER_A));

            /* 6. memory / plan / session / archive stay independent */
            const planA = await tools.executeTool("plan_get", {}, ctxA);
            const planB = await tools.executeTool("plan_get", {}, ctxB);

            assert.notDeepEqual(
                planA.summary && planA.summary.objective,
                planB.summary && planB.summary.objective
            );

            assert.deepEqual(memoryStore.loadMemory(ctxB).decisions, []);

            /* 8–9. one run/worker fails; the other continues */
            runtime.observability.recordCrash(recordA.id, "simulated");

            const stillB = await runtime.runAgent({
                projectId: recordB.id,
                task: `Read marker.txt in ${MARKER_B}`
            });

            assert.match(String(stillB.response.content), /finding-B/);
            assert.equal(runtime.observability.healthOf(recordB.id).status, "ok");
            assert.notEqual(runtime.observability.health().status, "down");

            /* 10. UI serves both dashboards and health */
            const dashA = await fetch(`${baseUrl}/projects/prj-a`);
            const dashB = await fetch(`${baseUrl}/projects/prj-b`);

            assert.equal(dashA.status, 200);
            assert.equal(dashB.status, 200);
            assert.match(await dashA.text(), /activeProjectName/);

            const healthA = await request(
                baseUrl, "GET", "/api/projects/prj-a/health", { token }
            );
            const healthB = await request(
                baseUrl, "GET", "/api/projects/prj-b/health", { token }
            );
            const healthG = await request(baseUrl, "GET", "/api/health", { token });

            assert.equal(healthA.status, 200);
            assert.equal(healthA.body.project_id, "prj-a");
            assert.equal(healthB.status, 200);
            assert.equal(healthB.body.status, "ok");
            assert.equal(healthG.status, 200);
            assert.ok(healthG.body.gateway);

            /* single-project API still accepts the established route */
            const legacy = await request(
                baseUrl,
                "POST",
                "/api/tasks",
                { token, body: { task: "plain run" } }
            );

            assert.equal(legacy.status, 202);
            assert.deepEqual(legacy.body, { accepted: true });

            const deadline = Date.now() + 15000;

            while (Date.now() < deadline) {

                const state = await request(baseUrl, "GET", "/api/state", { token });

                if (state.body.status !== "running") {
                    break;
                }

                await new Promise(done => setTimeout(done, 50));

            }

        } finally {

            try {
                await server.close();
            } catch {
                /* best-effort */
            }

        }

    });


    await test("the MVP uses canonical context, prompt and MCP boundaries", async () => {

        for (const removed of [
            "PROJECT_CONTEXT_MODE",
            "RUN_CONTEXT_MODE",
            "PROMPT_BUILDER_MODE",
            "RUNTIME_ENGINE_MODE",
            "WEB_SERVER_MODE"
        ]) {
            assert.throws(
                () => runtime.settings.definitionOf(removed),
                /Unknown setting/
            );
        }

        assert.equal(typeof runtime.projects.createProjectContext, "function");
        assert.equal(typeof runtime.runManager.createRun, "function");
        assert.equal(typeof runtime.runtimeEngine.runAgentCore, "function");

    });
};
