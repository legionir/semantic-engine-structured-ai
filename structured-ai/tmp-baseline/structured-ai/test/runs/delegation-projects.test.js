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

const assert = require("assert");
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


    await test("optional projectId is accepted; unknown extras still rejected", async () => {

        setModes(null, null, null);

        const withProject = {
            version: "1.0",
            action: "delegate",
            tool_calls: null,
            delegations: [
                {
                    id: "d1",
                    agent: "code_analysis",
                    persona: null,
                    skills: null,
                    tools: null,
                    task: "inspect",
                    depends_on: [],
                    projectId: "prj-example"
                }
            ],
            response: null,
            data: null,
            error: null,
            performed: null
        };

        runtime.validateAction(withProject);

        const parsed =
            runtime.readModelAction(envelopeOf(withProject));

        assert.equal(
            parsed.structured.delegations[0].projectId,
            "prj-example"
        );

        const withSnake = {
            ...withProject,
            delegations: [
                {
                    ...withProject.delegations[0],
                    projectId: undefined
                }
            ]
        };

        delete withSnake.delegations[0].projectId;
        withSnake.delegations[0].project_id = "prj-snake";

        runtime.validateAction(withSnake);

        const missing = {
            ...withProject,
            delegations: [
                {
                    id: "d1",
                    agent: "code_analysis",
                    persona: null,
                    skills: null,
                    tools: null,
                    task: "inspect",
                    depends_on: []
                }
            ]
        };

        runtime.validateAction(missing);

        let thrown = null;

        try {

            runtime.validateAction({
                ...withProject,
                delegations: [
                    {
                        ...withProject.delegations[0],
                        extra_field: "nope"
                    }
                ]
            });

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown, "unknown delegation field was accepted");
        assert.match(thrown.message, /unknown field/);

        let empty = null;

        try {

            runtime.validateAction({
                ...withProject,
                delegations: [
                    {
                        ...withProject.delegations[0],
                        projectId: ""
                    }
                ]
            });

        } catch (error) {

            empty = error;

        }

        assert.ok(empty, "empty projectId was accepted");
        assert.match(empty.message, /projectId/);

    });


    await test("two Sub-Agents on two projects run concurrently without mixing", async () => {

        setModes("modular", "modular", "modular");

        const { rootA, rootB, recordA, recordB } = twoProjectRoots();

        assert.notEqual(recordA.id, recordB.id);

        stub.requests = [];

        stub.handler = (parsed) => {

            if (isSubAgent(parsed)) {

                const projectId = projectContextId(parsed);
                const text = messageText(parsed);

                const side =
                    projectId === recordA.id || text.includes(MARKER_A)
                        ? "A"
                        : projectId === recordB.id || text.includes(MARKER_B)
                            ? "B"
                            : "unknown";

                if (!hasToolResults(parsed)) {

                    return {
                        delayMs: side === "A" ? 250 : 0,
                        message: {
                            role: "assistant",
                            content: JSON.stringify(
                                action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: `read_${side}`,
                                            name: "fs_read",
                                            arguments: { path: "marker.txt" },
                                            depends_on: []
                                        }
                                    ]
                                })
                            )
                        }
                    };

                }

                const tool =
                    [...parsed.messages]
                        .reverse()
                        .find(message => message.role === "tool");

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(
                                `finding-${side}: ${tool ? tool.content : "none"}`
                            )
                        )
                    }
                };

            }

            if (hasSubResults(parsed)) {

                const payload =
                    parsed.messages
                        .filter(message => message.role === "user")
                        .map(message => message.content)
                        .join("\n");

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(`synthesis ${payload}`)
                        )
                    }
                };

            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(
                        action({
                            action: "delegate",
                            delegations: [
                                {
                                    id: "analyze-a",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Read marker.txt in ${MARKER_A}`,
                                    depends_on: [],
                                    projectId: recordA.id
                                },
                                {
                                    id: "analyze-b",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Read marker.txt in ${MARKER_B}`,
                                    depends_on: [],
                                    projectId: recordB.id
                                }
                            ]
                        })
                    )
                }
            };

        };

        const captured = [];
        const listen = event => captured.push(event);
        events.bus.on("event", listen);

        let outcome;

        const startedAt = Date.now();

        try {

            outcome = await runtime.runAgent({
                task: "compare both projects",
                projectId: recordA.id
            });

        } finally {

            events.bus.off("event", listen);

        }

        const elapsed = Date.now() - startedAt;

        assert.match(String(outcome.response.content), /synthesis/);
        assert.match(String(outcome.response.content), /finding-A/);
        assert.match(String(outcome.response.content), /finding-B/);
        assert.match(String(outcome.response.content), new RegExp(MARKER_A));
        assert.match(String(outcome.response.content), new RegExp(MARKER_B));

        /* labeled results reached the parent */
        const labeled = subAgentResultsOf(stub.requests);

        assert.ok(labeled, "parent never received sub_agent_results");
        assert.equal(labeled.length, 2);

        const byId = Object.fromEntries(
            labeled.map(item => [item.id, item])
        );

        assert.equal(byId["analyze-a"].success, true);
        assert.equal(byId["analyze-b"].success, true);
        assert.equal(byId["analyze-a"].projectId, recordA.id);
        assert.equal(byId["analyze-b"].projectId, recordB.id);
        assert.ok(Array.isArray(byId["analyze-a"].findings));
        assert.ok(Array.isArray(byId["analyze-b"].findings));
        assert.match(byId["analyze-a"].findings.join(" "), /finding-A/);
        assert.match(byId["analyze-b"].findings.join(" "), /finding-B/);

        /* tools did not mix: each request stays on one project */
        for (const request of stub.requests) {

            if (!isSubAgent(request)) {
                continue;
            }

            const text = messageText(request);
            const projectId = projectContextId(request);

            if (projectId === recordA.id || text.includes(MARKER_A)) {

                assert.ok(
                    !text.includes(MARKER_B),
                    "sub-agent A saw project B material"
                );

            }

            if (projectId === recordB.id || text.includes(MARKER_B)) {

                assert.ok(
                    !text.includes(MARKER_A),
                    "sub-agent B saw project A material"
                );

            }

        }

        const toolStarts =
            captured.filter(event => event.type === "tool:start");

        const startA =
            toolStarts.find(event => event.id === "read_A");

        const startB =
            toolStarts.find(event => event.id === "read_B");

        assert.ok(startA && startB, "both project tools did not start");
        assert.equal(startA.project_id, recordA.id);
        assert.equal(startB.project_id, recordB.id);

        /* A was delayed 250ms; if they ran sequentially the whole
           pair of first requests would take well over 250ms plus B.
           Concurrent execution finishes closer to the slower child. */
        assert.ok(
            elapsed < 1800,
            `two independent delegations took ${elapsed} ms; they were not concurrent`
        );

        const toolA =
            captured.find(
                event =>
                    event.type === "tool:end" &&
                    event.id === "read_A" &&
                    event.success
            );

        const toolB =
            captured.find(
                event =>
                    event.type === "tool:end" &&
                    event.id === "read_B" &&
                    event.success
            );

        assert.match(JSON.stringify(toolA.result), new RegExp(MARKER_A));
        assert.match(JSON.stringify(toolB.result), new RegExp(MARKER_B));
        assert.ok(!JSON.stringify(toolA.result).includes(MARKER_B));
        assert.ok(!JSON.stringify(toolB.result).includes(MARKER_A));

        fs.rmSync(rootA, { recursive: true, force: true });
        fs.rmSync(rootB, { recursive: true, force: true });

        setModes(null, null, null);

    });


    await test("failure of one project's Sub-Agent does not block the other", async () => {

        setModes("modular", "modular", "modular");

        const { rootA, rootB, recordA, recordB } = twoProjectRoots();

        stub.requests = [];

        stub.handler = (parsed) => {

            if (isSubAgent(parsed)) {

                if (!hasToolResults(parsed)) {

                    return {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(
                                action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "read_ok",
                                            name: "fs_read",
                                            arguments: { path: "marker.txt" },
                                            depends_on: []
                                        }
                                    ]
                                })
                            )
                        }
                    };

                }

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(`survived ${MARKER_A}`)
                        )
                    }
                };

            }

            if (hasSubResults(parsed)) {

                const payload =
                    parsed.messages
                        .filter(message => message.role === "user")
                        .map(message => message.content)
                        .join("\n");

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(`partial ${payload}`)
                        )
                    }
                };

            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(
                        action({
                            action: "delegate",
                            delegations: [
                                {
                                    id: "good",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Read marker.txt in ${MARKER_A}`,
                                    depends_on: [],
                                    projectId: recordA.id
                                },
                                {
                                    id: "bad",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: "inspect the missing project",
                                    depends_on: [],
                                    projectId: "prj-does-not-exist"
                                }
                            ]
                        })
                    )
                }
            };

        };

        const outcome = await runtime.runAgent({
            task: "one will fail",
            projectId: recordB.id
        });

        assert.match(String(outcome.response.content), /partial/);
        assert.match(String(outcome.response.content), /survived/);

        const labeled = subAgentResultsOf(stub.requests);

        assert.ok(labeled);
        assert.equal(labeled.length, 2);

        const good = labeled.find(item => item.id === "good");
        const bad = labeled.find(item => item.id === "bad");

        assert.equal(good.success, true);
        assert.equal(good.projectId, recordA.id);
        assert.match(good.findings.join(" "), /survived/);

        assert.equal(bad.success, false);
        assert.equal(bad.projectId, "prj-does-not-exist");
        assert.match(bad.error.message, /Unknown project/);
        assert.deepEqual(bad.findings, []);

        fs.rmSync(rootA, { recursive: true, force: true });
        fs.rmSync(rootB, { recursive: true, force: true });

        setModes(null, null, null);

    });


    await test("cross-project and multi-project writes issue a separate approval", async () => {

        setModes("modular", "modular", "modular");

        const { rootA, rootB, recordA, recordB } = twoProjectRoots();

        const approvals = [];

        runtime.setApprovalHandler(async (evaluation) => {

            approvals.push({
                tool: evaluation.tool,
                reason: evaluation.reason,
                rule: evaluation.rule,
                project_id: evaluation.project_id
            });

            return true;

        });

        settings.set("AGENT_APPROVAL", "prompt");

        stub.requests = [];

        stub.handler = (parsed) => {

            if (isSubAgent(parsed)) {

                const text = messageText(parsed);
                const writes =
                    text.includes(MARKER_B) ||
                    text.includes("implementation");

                if (writes && !hasToolResults(parsed)) {

                    return {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(
                                action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "write_b",
                                            name: "fs_write",
                                            arguments: {
                                                path: "from-sub.txt",
                                                content: `written-on-b ${MARKER_B}\n`
                                            },
                                            depends_on: []
                                        }
                                    ]
                                })
                            )
                        }
                    };

                }

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(
                                writes
                                    ? `wrote on ${recordB.id}`
                                    : `noted ${MARKER_A}`
                            )
                        )
                    }
                };

            }

            const alreadyWrote =
                parsed.messages.some(message => message.role === "tool");

            if (alreadyWrote) {

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction("wrote after multi-project delegation")
                        )
                    }
                };

            }

            if (hasSubResults(parsed)) {

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "write_multi",
                                        name: "fs_write",
                                        arguments: {
                                            path: "from-main.txt",
                                            content: "after two projects\n"
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                        )
                    }
                };

            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(
                        action({
                            action: "delegate",
                            delegations: [
                                {
                                    id: "read-a",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Note ${MARKER_A}`,
                                    depends_on: [],
                                    projectId: recordA.id
                                },
                                {
                                    id: "write-b",
                                    agent: "implementation",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Write a file on ${MARKER_B}`,
                                    depends_on: [],
                                    projectId: recordB.id
                                }
                            ]
                        })
                    )
                }
            };

        };

        try {

            const outcome = await runtime.runAgent({
                task: "cross write then multi write",
                projectId: recordA.id
            });

            assert.match(
                String(outcome.response.content),
                /wrote after multi-project/
            );

        } finally {

            runtime.setApprovalHandler(null);
            settings.set("AGENT_APPROVAL", "auto");
            setModes(null, null, null);

        }

        const cross =
            approvals.filter(item => item.rule === "cross_project_write");

        const multi =
            approvals.filter(item => item.rule === "multi_project_write");

        assert.ok(
            cross.length >= 1,
            `expected a cross-project write approval, got ${JSON.stringify(approvals)}`
        );

        assert.equal(cross[0].tool, "fs_write");
        assert.equal(cross[0].project_id, recordB.id);
        assert.match(cross[0].reason, /cross-project write/);

        assert.ok(
            multi.length >= 1,
            `expected a multi-project write approval, got ${JSON.stringify(approvals)}`
        );

        assert.equal(multi[0].tool, "fs_write");
        assert.match(multi[0].reason, /multi-project task/);

        /* the extra approval is in addition to the ordinary policy one */
        const policyWrites =
            approvals.filter(
                item =>
                    item.tool === "fs_write" &&
                    item.rule !== "cross_project_write" &&
                    item.rule !== "multi_project_write"
            );

        assert.ok(
            policyWrites.length >= 1,
            "ordinary write approval was replaced instead of kept separate"
        );

        assert.equal(
            fs.readFileSync(path.join(rootB, "from-sub.txt"), "utf8"),
            `written-on-b ${MARKER_B}\n`
        );

        assert.equal(
            fs.readFileSync(path.join(rootA, "from-main.txt"), "utf8"),
            "after two projects\n"
        );

        fs.rmSync(rootA, { recursive: true, force: true });
        fs.rmSync(rootB, { recursive: true, force: true });

        setModes(null, null, null);

    });


    await test("the canonical runtime validates an explicit delegation project", async () => {

        setModes();
        stub.requests = [];
        stub.handler = parsed => {
            if (isSubAgent(parsed) || hasSubResults(parsed)) {
                return { message: { role: "assistant", content: JSON.stringify(finalAction("done")) } };
            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(action({
                        action: "delegate",
                        delegations: [{
                            id: "d-canonical-project",
                            agent: "code_analysis",
                            persona: null,
                            skills: null,
                            tools: null,
                            task: "this must not run",
                            depends_on: [],
                            projectId: "prj-removed-mode-test"
                        }]
                    }))
                }
            };
        };

        const output =
            await runtime.runAgent({ task: "canonical delegation project" });

        assert.match(String(output.response.content), /done/);
        assert.equal(
            stub.requests.length,
            2,
            "the invalid delegation should be reported to the parent without starting a child"
        );
        assert.ok(
            !stub.requests[1].messages.some(message =>
                typeof message.content === "string" &&
                message.content.includes("agent_profile")
            ),
            "an unknown project must not start a child agent"
        );

    });

    settings.reset("AGENT_BASE_URL");
    settings.reset("AGENT_MODEL");
    settings.reset("AGENT_APPROVAL");
    settings.reset("MAX_EMPTY_FINAL_NUDGES");

    await new Promise(resolve => stub.server.close(resolve));

    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

    const passed = results.filter(item => item.ok).length;

    console.log(`\n${passed}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }

}


main();
