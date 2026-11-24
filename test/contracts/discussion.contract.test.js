"use strict";

/*
|--------------------------------------------------------------------------
| Discussion contract tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| Discussion is an application boundary: callers inject the model function,
| runtime event bus and trusted project context. The engine must not accept
| model-supplied workspace identity, and transcript reads remain scoped to
| the owning project's data root.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const projectA = {
    projectId: "prj-contract-a",
    projectName: "Contract Alpha",
    workspaceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "phase29-discussion-a-")),
    dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "phase29-discussion-data-a-"))
};
const projectB = {
    projectId: "prj-contract-b",
    projectName: "Contract Beta",
    workspaceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "phase29-discussion-b-")),
    dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "phase29-discussion-data-b-"))
};

const discussion = require(path.join(ROOT, "agent", "discussion"));
const { DiscussionService, validateRequest } = require(path.join(ROOT, "agent", "discussion", "DiscussionService"));
const { resolveDiscussionContext } = require(path.join(ROOT, "agent", "discussion", "DiscussionContext"));
const { TranscriptRepository } = require(path.join(ROOT, "agent", "discussion", "TranscriptRepository"));

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

function runtime(events = []) {
    return {
        events: {
            emit(type, payload) {
                events.push({ type, payload });
            }
        },
        settings: { get: key => key === "MAX_PARALLEL_AGENTS" ? 2 : null }
    };
}

async function main() {
    await test("the discussion facade exposes the stable specialist and lifecycle boundary", async () => {
        assert.equal(typeof discussion.DiscussionService, "function");
        assert.equal(typeof discussion.DiscussionEngine, "function");
        assert.equal(typeof discussion.TranscriptRepository, "function");
        assert.equal(typeof discussion.createLlmCaller, "function");
        assert.ok(discussion.listPersonas().some(persona => persona.id === "security"));
        assert.ok(!discussion.listPersonas().some(persona => persona.id === "observer"));
    });

    await test("discussion request validation keeps task, persona and round limits explicit", async () => {
        assert.doesNotThrow(() => validateRequest({ task: "inspect", personas: ["security"], maxRounds: 1 }));
        assert.throws(() => validateRequest({ task: "", personas: ["security"], maxRounds: 1 }), /task is required/);
        assert.throws(() => validateRequest({ task: "inspect", personas: [], maxRounds: 1 }), /personas is required/);
        assert.throws(() => validateRequest({ task: "inspect", personas: ["not-real"], maxRounds: 1 }), /unknown persona/);
        assert.throws(() => validateRequest({ task: "inspect", personas: ["security"], maxRounds: 11 }), /between 1 and 10/);
    });

    await test("the injected LLM adapter returns only the discussion content contract", async () => {
        const caller = discussion.createLlmCaller({
            callAI: async request => {
                assert.equal(request.agentDefinition.name, "security");
                assert.equal(request.role, "L1");
                return { choices: [{ message: { content: "injected answer" } }] };
            }
        });
        const result = await caller([{ role: "user", content: "inspect" }], {
            id: "security",
            model_role: "L1"
        });
        assert.deepStrictEqual(result, { content: "injected answer" });
        assert.throws(() => discussion.createLlmCaller(), /needs a callAI function/);
    });

    await test("DiscussionService uses trusted project context and labels every lifecycle event", async () => {
        const events = [];
        class FakeEngine {
            constructor(options) {
                this.options = options;
            }

            async run() {
                this.options.onMessage({ round: 1, persona: "security", persona_name: "Security", content: "finding" });
                this.options.onRound({ round: 1, messages: [{ persona: "security", persona_name: "Security", content: "finding" }] });
                this.options.onObserver({ decision: "FINISH", agreements: [], open_points: [], unaddressed: [], instructions: {} }, 1);
                return {
                    final_report: { summary: "finished", agreed_points: [], unresolved: [], next_steps: [] },
                    total_rounds: 1,
                    hit_max_rounds: false,
                    stopped_reason: "observer_finish"
                };
            }
        }

        const service = new DiscussionService({
            runtime: runtime(events),
            engineClass: FakeEngine,
            repository: new TranscriptRepository(),
            now: (() => { let value = 100; return () => ++value; })()
        });
        const session = service.createSession({
            task: "inspect alpha",
            personas: ["security"],
            maxRounds: 1,
            projectContext: projectA,
            workspace: "/tmp/forged-by-model"
        });
        assert.equal(session.context.projectId, projectA.projectId);
        assert.equal(session.context.workspaceRoot, projectA.workspaceRoot);
        const result = await service.execute(session, { llmCaller: async () => ({ content: "unused" }) });
        assert.equal(result.project_id, projectA.projectId);
        assert.equal(session.record.rounds.length, 1);
        assert.ok(events.length >= 4);
        for (const event of events) assert.equal(event.payload.project_id, projectA.projectId);
    });

    await test("list and load never cross a project's transcript boundary", async () => {
        const repository = new TranscriptRepository();
        repository.save({ id: "alpha-discussion", project_id: projectA.projectId, task: "alpha", status: "done" }, projectA.dataRoot);
        repository.save({ id: "beta-discussion", project_id: projectB.projectId, task: "beta", status: "done" }, projectB.dataRoot);
        const service = new DiscussionService({ runtime: runtime(), repository });
        const alpha = service.list({ projectContext: projectA });
        assert.deepStrictEqual(alpha.map(item => item.id), ["alpha-discussion"]);
        assert.equal(service.load("beta-discussion", { projectContext: projectA }), null);
        assert.equal(service.load("alpha-discussion", { projectContext: projectA }).project_id, projectA.projectId);
    });

    await test("context resolution never treats a forged workspace argument as project identity", async () => {
        const context = resolveDiscussionContext(runtime(), {
            projectContext: projectB,
            projectId: projectB.projectId,
            workspace: "/tmp/forged",
            workspace_root: "/tmp/also-forged"
        });
        assert.equal(context.projectId, projectB.projectId);
        assert.equal(context.workspaceRoot, projectB.workspaceRoot);
        assert.equal(context.dataRoot, projectB.dataRoot);
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    fs.rmSync(projectA.workspaceRoot, { recursive: true, force: true });
    fs.rmSync(projectA.dataRoot, { recursive: true, force: true });
    fs.rmSync(projectB.workspaceRoot, { recursive: true, force: true });
    fs.rmSync(projectB.dataRoot, { recursive: true, force: true });
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
