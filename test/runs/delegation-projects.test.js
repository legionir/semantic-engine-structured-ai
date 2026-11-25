"use strict";

/*
|--------------------------------------------------------------------------
| Cross-Project Delegation Tests — EXECUTION_PLAN Phase 12
|--------------------------------------------------------------------------
|
| Locks the phase-12 acceptance criteria:
|   1. optional projectId on delegate is accepted; missing it inherits
|      the active project; unknown extras are still rejected
|   2. two Sub-Agents on two projects run concurrently without mixing
|      tools or messages
|   3. failure of one project's Sub-Agent does not block the other
|   4. each labeled result carries projectId + success + findings, and
|      the final report attributes findings to their project
|   5. a write on a project other than the Sub-Agent/run project, and
|      any write in a multi-project task, issues a separate approval
|   6. an explicit projectId is resolved before a child starts
|
*/

const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p12-ws-"));

const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p12-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_RUN_MS = "20000";
process.env.MAX_REQUEST_MS = "10000";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const events = require(path.join(ROOT, "agent", "events"));

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


const MARKER_A = "zzp12alpha7c1e";
const MARKER_B = "zzp12beta9f2d";


function action(value) {

    return {
        version: "1.0",
        tool_calls: null,
        delegations: null,
        response: null,
        data: null,
        error: null,
        performed: null,
        ...value
    };

}


function finalAction(content) {

    return action({
        action: "final",
        response: { type: "text", content }
    });

}


function envelopeOf(structured) {

    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content: JSON.stringify(structured)
                }
            }
        ]
    };

}


function setModes() {

    /* Phase 30: context, prompt and project routing are always canonical. */

}


function messageText(request) {

    return JSON.stringify(request.messages || []);

}


function projectContextId(request) {

    for (const message of request.messages || []) {

        if (typeof message.content !== "string") {
            continue;
        }

        try {

            const parsed = JSON.parse(message.content);

            if (parsed.type === "project_context") {
                return parsed.project && parsed.project.id;
            }

        } catch {
            /* not json */
        }

    }

    return null;

}


function isSubAgent(request) {

    return (request.messages || []).some(
        message =>
            typeof message.content === "string" &&
            message.content.includes("\"agent_profile\"")
    );

}


function hasToolResults(request) {

    return (request.messages || []).some(
        message => message.role === "tool"
    );

}


function hasSubResults(request) {

    return (request.messages || []).some(
        message =>
            typeof message.content === "string" &&
            message.content.includes("sub_agent_results")
    );

}


function subAgentResultsOf(requests) {

    for (const request of requests) {

        for (const message of request.messages || []) {

            if (
                message.role !== "user" ||
                typeof message.content !== "string"
            ) {
                continue;
            }

            try {

                const parsed = JSON.parse(message.content);

                if (parsed.type === "sub_agent_results") {
                    return parsed.results;
                }

            } catch {
                /* not json */
            }

        }

    }

    return null;

}


const stub = {
    handler: null,
    requests: [],
    server: null
};


async function startStub() {

    stub.server = http.createServer((req, res) => {

        let body = "";

        req.on("data", chunk => {
            body += chunk;
        });

        req.on("end", () => {

            const parsed = JSON.parse(body);

            stub.requests.push(parsed);

            const reply =
                stub.handler
                    ? stub.handler(parsed, stub.requests.length)
                    : {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(finalAction("done"))
                        }
                    };

            const respond = () => {

                res.setHeader("content-type", "application/json");

                res.end(
                    JSON.stringify({
                        choices: [
                            {
                                message: reply.message
                            }
                        ]
                    })
                );

            };

            if (reply.delayMs) {
                setTimeout(respond, reply.delayMs);
            } else {
                respond();
            }

        });

    });

    await new Promise(
        resolve => stub.server.listen(0, "127.0.0.1", resolve)
    );

}


function twoProjectRoots() {

    const rootA =
        fs.mkdtempSync(path.join(os.tmpdir(), "agent-p12-a-"));

    const rootB =
        fs.mkdtempSync(path.join(os.tmpdir(), "agent-p12-b-"));

    fs.writeFileSync(
        path.join(rootA, "marker.txt"),
        `alpha-only ${MARKER_A}\n`
    );

    fs.writeFileSync(
        path.join(rootB, "marker.txt"),
        `beta-only ${MARKER_B}\n`
    );

    const recordA =
        runtime.projects.registry().register({
            name: "Phase12 Alpha",
            rootPath: rootA
        });

    const recordB =
        runtime.projects.registry().register({
            name: "Phase12 Beta",
            rootPath: rootB
        });

    return { rootA, rootB, recordA, recordB };

}


async function main() {

    await startStub();

    const settings = runtime.settings;

    settings.set(
        "AGENT_BASE_URL",
        `http://127.0.0.1:${stub.server.address().port}/v1`
    );
    settings.set("AGENT_MODEL", "stub-model");
    settings.set("AGENT_APPROVAL", "auto");
    settings.set("MAX_EMPTY_FINAL_NUDGES", 0);

    /* the cases live in ./delegation-projects-cases, run in this order */
    const ctx = {
        MARKER_A,
        MARKER_B,
        action,
        envelopeOf,
        events,
        finalAction,
        hasSubResults,
        hasToolResults,
        isSubAgent,
        messageText,
        projectContextId,
        runtime,
        setModes,
        settings,
        stub,
        subAgentResultsOf,
        test,
        twoProjectRoots
    };

    await require("./delegation-projects-cases/01-optional-projectid-is-accepted-unknown-extras")(ctx);
    await require("./delegation-projects-cases/02-failure-of-one-project-s-sub")(ctx);


    settings.reset("AGENT_BASE_URL");
    settings.reset("AGENT_MODEL");
    settings.reset("AGENT_APPROVAL");
    settings.reset("MAX_EMPTY_FINAL_NUDGES");

    await new Promise(resolve => stub.server.close(resolve));

    await runtime.eventstore.flush();
    await runtime.journal.flush();
    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(DATA_HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    const passed = results.filter(item => item.ok).length;

    console.log(`\n${passed}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }

}


main();
