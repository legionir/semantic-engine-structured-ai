"use strict";

/*
| delegation-projects.test.js: from "optional projectId is accepted; unknown extras still rejected"
|
| Runs inside delegation-projects.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");


module.exports = async function optionalProjectidIsAcceptedUnknownExtrasCases(ctx) {

    const {
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
        stub,
        subAgentResultsOf,
        test,
        twoProjectRoots
    } = ctx;

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

        fs.rmSync(rootA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        fs.rmSync(rootB, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

        setModes(null, null, null);

    });
};
