"use strict";

/*
|--------------------------------------------------------------------------
| AUTO_CONTINUE keeps the project (plan phase 6 / step 2)
|--------------------------------------------------------------------------
|
| A console run started for project prj-a that continues on its own must run
| every later cycle for prj-a too, and it must judge "is the plan finished?"
| by prj-a's plan, not by the default project's.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "proj-cont-default-"));
const PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "proj-cont-a-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "proj-cont-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_APPROVAL = "auto";


function reply(payload) {

    return {
        role: "assistant",
        content: JSON.stringify({
            version: "1.0",
            delegations: null,
            data: null,
            error: null,
            ...payload
        })
    };
}

const final = text =>
    reply({
        action: "final",
        tool_calls: null,
        response: { type: "text", content: text }
    });

const call = (name, args) =>
    reply({
        action: "tool_call",
        tool_calls: [{ id: `c-${name}`, name, arguments: args, depends_on: [] }],
        response: null
    });


function startModelStub(handler) {

    return new Promise(resolve => {

        const requests = [];

        const server = http.createServer((req, res) => {

            let body = "";

            req.on("data", chunk => (body += chunk));

            req.on("end", () => {

                const parsed = JSON.parse(body || "{}");

                requests.push(parsed);

                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ choices: [{ message: handler(parsed) }] }));
            });
        });

        server.listen(0, "127.0.0.1", () =>
            resolve({
                requests,
                port: server.address().port,
                close: () => new Promise(done => server.close(done))
            })
        );
    });
}


const messagesOf = request => request.messages || [];

const projectIdIn = request => {

    for (const message of messagesOf(request)) {

        if (
            typeof message.content === "string" &&
            message.content.includes("\"type\":\"project_context\"")
        ) {
            const match = message.content.match(/"id":"([^"]+)"/);
            return match ? match[1] : null;
        }
    }

    return null;
};

const planIn = request => {

    for (const message of messagesOf(request)) {

        if (
            typeof message.content === "string" &&
            message.content.startsWith("{") &&
            message.content.includes("runtime_context")
        ) {
            return JSON.parse(message.content).context.plan || {};
        }
    }

    return {};
};


async function main() {

    const stub = await startModelStub(request => {

        const plan = planIn(request);

        if (!plan.exists) {

            return call("plan_set", {
                objective: "two small things",
                phases: [
                    {
                        id: "P1",
                        title: "work",
                        steps: [
                            { id: "P1.1", title: "one" },
                            { id: "P1.2", title: "two" }
                        ]
                    }
                ]
            });
        }

        if (messagesOf(request).some(message => message.role === "tool")) {

            return final("one step done, stopping this run");
        }

        if (plan.next_step) {

            return call("plan_update", {
                updates: [
                    { id: plan.next_step.id, status: "done", evidence: "finished in this cycle" }
                ]
            });
        }

        return final("nothing open");
    });

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
    process.env.AGENT_MODEL = "test-model";

    const projects = require(path.join(REPO_ROOT, "agent", "projects", "index.js"));

    projects.registry().register({ id: "prj-a", name: "Project A", rootPath: PROJECT_ROOT });

    const runtime = require(path.join(REPO_ROOT, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO_ROOT, "web", "server.js"));
    const planTools = require(path.join(REPO_ROOT, "agent", "tools", "planning"));

    const server = createServer(runtime, {});
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const token = server.token;

    const api = async (method, url, body) => {

        const response = await fetch(`${baseUrl}${url}`, {
            method,
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${token}`
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        return { status: response.status, body: await response.json() };
    };

    await api("POST", "/api/settings", { key: "AUTO_CONTINUE", value: true });
    await api("POST", "/api/settings", { key: "MAX_PLAN_CONTINUATIONS", value: 0 });

    const started = await api("POST", "/api/projects/prj-a/tasks", { task: "do the whole plan" });

    assert.strictEqual(started.status, 202);

    const projectPlan = () => {

        const context = runtime.resolveRunProjectContext({ projectId: "prj-a" });

        return runtime.runWithProject(context, () => planTools._summarise(planTools._loadPlan()));
    };

    let ok = true;
    let message = "";

    try {

        const deadline = Date.now() + 25000;

        while (Date.now() < deadline && !projectPlan().complete) {

            await new Promise(done => setTimeout(done, 200));
        }

        const plan = projectPlan();

        assert.strictEqual(plan.complete, true, "the project's plan was never completed by the auto cycles");
        assert.strictEqual(plan.done, 2);

        const ids = stub.requests.map(projectIdIn);

        assert.ok(stub.requests.length >= 3, "expected several cycles");
        assert.ok(ids.every(id => id === "prj-a"), `every cycle must run for prj-a, saw: ${JSON.stringify(ids)}`);

        console.log("  ok   auto-continue cycles all run for the same project and complete that project's plan");

    } catch (error) {

        ok = false;
        message = error.message;
        console.log("  FAIL auto-continue cycles all run for the same project and complete that project's plan");
        console.log(`       ${message}`);
    }

    console.log(`\n${ok ? 1 : 0}/1 passed`);

    try {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        await Promise.race([new Promise(done => server.close(done)), new Promise(done => setTimeout(done, 1000))]);
        await runtime.shutdown?.();
    } catch {
        /* best effort */
    }

    await stub.close();

    for (const dir of [WORKSPACE, PROJECT_ROOT, DATA_HOME]) {

        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }

    process.exit(ok ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
