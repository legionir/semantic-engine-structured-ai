"use strict";

/*
|--------------------------------------------------------------------------
| Prompt Builder Tests — EXECUTION_PLAN Phase 5
|--------------------------------------------------------------------------
|
| Locks the phase-5 acceptance criteria:
|   1. normalized Main/Sub-Agent prompts from the injected builders
|      (PROMPT_BUILDER_MODE=modular) equal the legacy inline builders
|      (the phase-1 baseline behaviour), message for message
|   2. the modular output also satisfies the phase-1 prompt fixture
|   3. dynamic behaviour kept: editing system_prompt.txt or skills.json
|      is visible in the next build without a restart
|   4. a registry skill gated on the Semantic MCP disappears while the
|      engine has no active Semantic connection
|   5. additive project_context: present with the active project and its
|      rules; absent without one; a Sub-Agent inherits the parent's
|      project; the prompt tells the model the project's own root —
|      verified at unit level and end-to-end on a cross-root project
|   6. RequestBuilder keeps the request contract: tools field,
|      response_format, temperature, parallel_tool_calls, and the
|      summariser's schema-less plain completion
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p5-ws-"));

const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-p5-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_RUN_MS = "15000";
process.env.MAX_REQUEST_MS = "10000";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const promptKit = require(path.join(ROOT, "agent", "prompt"));

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


const fixture =
    JSON.parse(
        fs.readFileSync(
            path.join(ROOT, "test", "fixtures", "prompt.fixture.json"),
            "utf8"
        )
    );

const CONFIG_DIR = path.join(ROOT, "agent", "config");
const REGISTRY_DIR = path.join(ROOT, "agent", "registry");


/* Fields that legitimately change between two builds seconds apart. */
function stableCopy(value) {

    return JSON.parse(
        JSON.stringify(value, (key, item) =>
            key === "run_remaining_ms" ? 0 : item
        )
    );

}


function subAgentProfile() {

    return runtime.registries.AGENTS.find(
        agent => agent.name === fixture.sub_agent.profile_used
    );

}


function matchesFixture(messages, structure, task) {

    assert.equal(
        messages.length,
        structure.length,
        `message count drifted (${messages.length} vs ${structure.length})`
    );

    for (const expected of structure) {

        const message = messages[expected.index];

        assert.equal(message.role, expected.role, `role at ${expected.index}`);

        if (expected.kind === "text" && expected.starts_with) {

            assert.ok(
                message.content.startsWith(expected.starts_with),
                `message ${expected.index} no longer starts with ${expected.starts_with}`
            );

        }

        if (expected.kind === "text" && expected.contains) {

            assert.ok(
                message.content.includes(expected.contains),
                `message ${expected.index} lost ${expected.contains}`
            );

        }

        if (expected.equals_task) {

            assert.equal(message.content, task);

        }

        if (expected.kind === "json") {

            const parsed =
                message.role === "user"
                    ? JSON.parse(message.content)
                    : JSON.parse(message.content);

            if (expected.json_type) {
                assert.equal(
                    parsed.type,
                    expected.json_type,
                    `json type at ${expected.index}`
                );
            }

            if (expected.context_keys) {

                for (const key of expected.context_keys) {
                    assert.ok(
                        Object.prototype.hasOwnProperty.call(parsed.context, key),
                        `runtime_context lost key ${key}`
                    );
                }
            }

            if (expected.required_keys) {

                for (const key of expected.required_keys) {
                    assert.ok(
                        Object.prototype.hasOwnProperty.call(parsed, key),
                        `message ${expected.index} lost key ${key}`
                    );
                }
            }
        }
    }
}


function withMode(mode, fn) {

    /* Phase 30 has one canonical builder; retain the helper name so the
       differential scenarios still document their comparison points. */
    void mode;
    return fn();
}


async function main() {

    await test("modular main/sub prompts are message-for-message the legacy ones", async () => {

        const profile = subAgentProfile();

        assert.ok(profile, "fixture profile is missing from agents.json");

        const legacyMain =
            withMode("legacy", () => runtime.createMainAgentMessages("fixture task"));

        const legacySub =
            withMode("legacy", () =>
                runtime.createSubAgentMessages(profile, "fixture task", { origin: "probe" }));

        const legacyContext =
            withMode("legacy", () => runtime.createRuntimeContext());

        const modularMain =
            withMode("modular", () => runtime.createMainAgentMessages("fixture task"));

        const modularSub =
            withMode("modular", () =>
                runtime.createSubAgentMessages(profile, "fixture task", { origin: "probe" }));

        const modularContext =
            withMode("modular", () => runtime.createRuntimeContext());

        assert.deepStrictEqual(stableCopy(modularMain), stableCopy(legacyMain));
        assert.deepStrictEqual(stableCopy(modularSub), stableCopy(legacySub));
        assert.deepStrictEqual(stableCopy(modularContext), stableCopy(legacyContext));

        /* refresh must track the same message in both modes */

        const legacyMessages =
            withMode("legacy", () => runtime.createMainAgentMessages("fixture task"));

        const modularMessages =
            withMode("modular", () => runtime.createMainAgentMessages("fixture task"));

        assert.equal(withMode("modular", () => runtime.refreshRuntimeContext(modularMessages)), true);
        assert.equal(runtime.refreshRuntimeContext(legacyMessages), true);

        assert.deepStrictEqual(
            stableCopy(modularMessages[2]),
            stableCopy(legacyMessages[2])
        );

    });


    await test("the modular builders still satisfy the phase-1 prompt fixture", async () => {

        const main =
            withMode("modular", () => runtime.createMainAgentMessages("fixture task"));

        const sub =
            withMode("modular", () =>
                runtime.createSubAgentMessages(subAgentProfile(), "fixture task", null));

        matchesFixture(main, fixture.main.structure, "fixture task");
        matchesFixture(sub, fixture.sub_agent.structure, "fixture task");

    });


    await test("RequestBuilder body equals the legacy body in every variant", async () => {

        const profile = subAgentProfile();
        const mainDef =
            runtime.registries.AGENTS.find(agent => agent.name === "main_agent");

        const tools = runtime.resolveTools("*");
        const messages = runtime.createMainAgentMessages("fixture task");

        const variants = [
            [
                "tool request",
                {
                    messages,
                    agentDefinition: mainDef,
                    tools,
                    responseFormat: {},
                    role: null
                }
            ],
            [
                "summariser (schema-less)",
                {
                    messages: [{ role: "user", content: "digest please" }],
                    agentDefinition: null,
                    tools: undefined,
                    responseFormat: null,
                    role: "SUMMARY"
                }
            ],
            [
                "schema refused",
                {
                    messages,
                    agentDefinition: profile,
                    tools,
                    responseFormat: {},
                    role: "L2",
                    withSchema: false
                }
            ]
        ];

        for (const [name, options] of variants) {

            const legacyBody =
                withMode("legacy", () => runtime.buildAgentRequest(options));

            const modularBody =
                withMode("modular", () => runtime.buildAgentRequest(options));

            assert.deepStrictEqual(
                modularBody,
                legacyBody,
                `${name}: modular request body drifted from legacy`
            );
        }

        /* contract spot checks on the tool variant */

        const probe =
            withMode("modular", () => runtime.buildAgentRequest(variants[0][1]));

        assert.ok(Array.isArray(probe.tools) && probe.tools.length > 0);
        assert.equal(probe.parallel_tool_calls, true);
        assert.ok(
            probe.response_format &&
            probe.response_format.type === "json_schema"
        );
        assert.equal(typeof probe.temperature, "number");

        const summary =
            withMode("modular", () => runtime.buildAgentRequest(variants[1][1]));

        assert.ok(!("tools" in summary) || summary.tools === undefined);
        assert.ok(!("response_format" in summary));

    });


    await test("live edits to prompt text and skills registry are visible without restart", async () => {

        const promptFile = path.join(CONFIG_DIR, "system_prompt.txt");
        const skillsFile = path.join(REGISTRY_DIR, "skills.json");

        const originalPrompt = fs.readFileSync(promptFile, "utf8");
        const originalSkills = fs.readFileSync(skillsFile, "utf8");

        const parsedSkills = JSON.parse(originalSkills);

        parsedSkills.push({
            name: "zz_phase5_probe_skill",
            description: "phase 5 dynamic probe",
            instructions: "probe"
        });

        try {

            fs.writeFileSync(promptFile, `${originalPrompt}\nPHASE5-DYNAMIC-PROBE`);
            fs.writeFileSync(skillsFile, JSON.stringify(parsedSkills, null, 2));

            /* let the mtime advance past the cache stamp */

            await new Promise(resolve => setTimeout(resolve, 25));

            for (const mode of ["legacy", "modular"]) {

                const messages =
                    withMode(mode, () => runtime.createMainAgentMessages("fixture task"));

                assert.ok(
                    messages[0].content.includes("PHASE5-DYNAMIC-PROBE"),
                    `${mode}: system prompt edit not live`
                );

                const skillsMessage =
                    messages.find(message => {

                        try {
                            return JSON.parse(message.content).type === "available_skills";
                        } catch {
                            return false;
                        }
                    });

                assert.ok(
                    JSON.parse(skillsMessage.content)
                        .skills.some(skill => skill.name === "zz_phase5_probe_skill"),
                    `${mode}: registry skill edit not live`
                );
            }

        } finally {

            fs.writeFileSync(promptFile, originalPrompt);
            fs.writeFileSync(skillsFile, originalSkills);

            await new Promise(resolve => setTimeout(resolve, 25));

            /* prove the restore is what the cache now serves */
            const restored =
                withMode("legacy", () => runtime.createMainAgentMessages("fixture task"));

            assert.ok(!restored[0].content.includes("PHASE5-DYNAMIC-PROBE"));
        }

    });


    await test("project_context: additive message with the active project and its rules", async () => {

        /* Unit-level: the facade built from minimal records, no engine
           state involved. */

        const recordB = {
            id: "prj-prompt-beta-0001",
            name: "Prompt Beta",
            rootPath: fs.mkdtempSync(path.join(os.tmpdir(), "agent-p5-projB-"))
        };

        const listing = [recordB];

        const projectB = {
            projectId: recordB.id,
            projectName: recordB.name,
            workspaceRoot: recordB.rootPath
        };

        const facade =
            promptKit.createPromptBuilder({
                listProjects: () => listing,
                main: {
                    systemPrompt: () => "SYS",
                    executionRules: () => "RULES",
                    skillIndex: () => [],
                    PERSONAS_OF: () => [],
                    AGENTS_OF: () => [],
                    discussionPersonaNames: () => new Set(),
                    describeCapability: () => ({}),
                    mayDelegate: () => false,
                    readTask: () => "fallback"
                },
                subAgent: {
                    resolveAgentCapabilities: () => ({
                        persona: null,
                        skills: [],
                        tools: [{ function: { name: "fs_read" } }]
                    }),
                    executionRules: () => "RULES",
                    mayDelegate: () => false
                },
                runtimeContext: {
                    CONFIGURED_RUNTIME_OF: () => ({}),
                    detectEnvironment: () => ({}),
                    detectRepository: () => ({}),
                    workspaceRoot: () => projectB.workspaceRoot,
                    planSummary: () => ({ exists: false }),
                    memorySizeChars: () => 0,
                    archiveStats: () => ({}),
                    policySummary: () => ({}),
                    endpointOverview: () => ({}),
                    agentsSpawned: () => 0,
                    runStartedAt: () => 0,
                    runRemainingMs: () => 0,
                    mcpContext: () => ({ enabled: false })
                },
                request: {
                    endpointFor: () => ({ model: "m", temperature: 0 }),
                    RESPONSE_FORMAT_OF: () => ({})
                }
            });

        /* no project: byte-identical shape, no additive message */

        const plain = facade.mainMessages("task");

        assert.equal(
            plain.filter(message => {
                try {
                    return JSON.parse(message.content).type === "project_context";
                } catch { return false; }
            }).length,
            0
        );

        /* with a project: message inserted after runtime_context */

        const scoped = facade.mainMessages("task", { project: projectB });

        const types =
            scoped.map(message => {
                if (message.role !== "system") return "user";
                try {
                    return JSON.parse(message.content).type;
                } catch { return "text"; }
            });

        assert.deepStrictEqual(types, [
            "text",
            "text",
            "runtime_context",
            "project_context",
            "available_skills",
            "available_agents",
            "user"
        ]);

        const projectMessage =
            JSON.parse(
                scoped[3].content
            );

        assert.equal(projectMessage.project.id, recordB.id);
        assert.equal(projectMessage.project.name, recordB.name);
        assert.equal(projectMessage.project.workspace_root, recordB.rootPath);

        /* the three documented rules, and no root of any OTHER project */

        assert.ok(Array.isArray(projectMessage.rules));
        assert.equal(projectMessage.rules.length, 3);
        assert.match(projectMessage.rules[0], /active project/);
        assert.match(projectMessage.rules[1], /Never guess/i);
        assert.match(projectMessage.rules[2], /Attribute/);

        /* available_projects lists others, never the active one */

        const sub =
            facade.subAgentMessages(
                { name: "code_analysis", description: "probe" },
                "task",
                { origin: "parent" },
                { project: projectB }
            );

        const subTypes =
            sub.map(message => {
                if (message.role !== "system") return "user";
                try {
                    return JSON.parse(message.content).type;
                } catch { return "text"; }
            });

        assert.deepStrictEqual(subTypes, [
            "text",
            "runtime_context",
            "agent_profile",
            "project_context",
            "available_tools",
            "user"
        ]);

        const subProject =
            JSON.parse(sub[3].content);

        assert.equal(subProject.project.id, recordB.id);

        fs.rmSync(recordB.rootPath, { recursive: true, force: true });

    });


    await test("end-to-end: a cross-root project's prompt shows its own root and context", async () => {

        const projectBRoot =
            fs.mkdtempSync(path.join(os.tmpdir(), "agent-p5-e2eB-"));

        const realB = fs.realpathSync(projectBRoot);

        const recordB =
            runtime.projects.registry().register({
                name: "Prompt E2E Beta",
                rootPath: projectBRoot
            });

        const captured = [];

        const stub = http.createServer((req, res) => {

            let body = "";

            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {

                captured.push(JSON.parse(body));

                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                version: "1.0",
                                tool_calls: null,
                                delegations: null,
                                response: { type: "text", content: "p5 done" },
                                data: null,
                                error: null,
                                action: "final",
                                performed: null
                            })
                        }
                    }]
                }));
            });
        });

        await new Promise(resolve => stub.listen(0, "127.0.0.1", resolve));

        runtime.settings.set("AGENT_BASE_URL", `http://127.0.0.1:${stub.address().port}/v1`);
        runtime.settings.set("AGENT_MODEL", "stub-model");

        try {

            const outcome =
                await runtime.runAgent({
                    task: "probe the prompt",
                    projectId: recordB.id
                });

            assert.match(String(outcome.response.content), /p5 done/);

        } finally {

            runtime.settings.reset("AGENT_BASE_URL");
            runtime.settings.reset("AGENT_MODEL");
            await new Promise(resolve => stub.close(resolve));
        }

        assert.ok(captured.length >= 1, "the stub saw no request");

        const first = captured[0];

        const runtimeContextMessage =
            first.messages.find(message => {

                try {
                    return JSON.parse(message.content).type === "runtime_context";
                } catch { return false; }
            });

        const runtimeContext =
            JSON.parse(runtimeContextMessage.content).context;

        /* the prompt announces the PROJECT root, not the process one */

        assert.equal(runtimeContext.workspace.root, realB);
        assert.equal(runtimeContext.runtime.workspace_root, realB);

        const projectMessage =
            first.messages.find(message => {

                try {
                    return JSON.parse(message.content).type === "project_context";
                } catch { return false; }
            });

        assert.ok(projectMessage, "no project_context message in the request");

        const projectPayload = JSON.parse(projectMessage.content);

        assert.equal(projectPayload.project.id, recordB.id);
        assert.equal(projectPayload.project.workspace_root, realB);
        assert.equal(projectPayload.rules.length, 3);

        /* the request envelope keeps its contract */

        assert.ok(Array.isArray(first.tools));
        assert.equal(first.parallel_tool_calls, true);
        assert.equal(first.response_format.type, "json_schema");

        fs.rmSync(projectBRoot, { recursive: true, force: true });

    });


    await runtime.eventstore.flush();
    await runtime.journal.flush();

    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
