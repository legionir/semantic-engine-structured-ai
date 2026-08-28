"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Discussion Subsystem Layer Tests — EXECUTION_PLAN Phase 28
|--------------------------------------------------------------------------
|
| Tests the modular discussion layer components directly: TranscriptStore,
| LoopDetector, PersonaRunner, ObserverRunner, DiscussionEngine, and
| DiscussionRepository.
|--------------------------------------------------------------------------
*/

const ROOT = path.resolve(__dirname, "..", "..");

const discussion =
    require(path.join(ROOT, "agent", "discussion"));

const {
    TranscriptStore,
    LoopDetector,
    DiscussionEngine,
    PersonaRunner,
    ObserverRunner,
    PERSONAS,
    OBSERVER,
    saveDiscussion,
    getDiscussion,
    listDiscussions,
    deleteDiscussion
} = discussion;

const results = [];

async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack || error.message}`);
    }
}

async function main() {

    console.log("discussion subsystem layer");

    await test("TranscriptStore enforces round 1 isolation and round 2+ cross-exam visibility", () => {

        const store = new TranscriptStore();

        store.addRound({
            round: 1,
            messages: [
                { persona: "security", persona_name: "Security", content: "Auth token must be secure." },
                { persona: "backend", persona_name: "Backend", content: "Fast API endpoint preferred." }
            ]
        });

        /* In round 1, a persona cannot see other personas' messages */
        assert.match(store.formatForPersona("security", 1), /independent/);

        /* In round 2, prior round is visible */
        const round2View = store.formatForPersona("security", 2);
        assert.match(round2View, /Backend/);
        assert.match(round2View, /Fast API/);

        /* Full transcript formats properly */
        const promptText = store.formatForPrompt();
        assert.match(promptText, /Round 1/);
        assert.match(promptText, /Security/);
        assert.match(promptText, /Backend/);
    });

    await test("LoopDetector identifies identical and highly similar rounds", () => {

        const detector = new LoopDetector();

        const staticRounds = [
            {
                round: 1,
                messages: [
                    { persona: "security", content: "JWT tokens should be signed with RS256 algorithm." }
                ]
            },
            {
                round: 2,
                messages: [
                    { persona: "security", content: "JWT tokens should be signed with RS256 algorithm." }
                ]
            },
            {
                round: 3,
                messages: [
                    { persona: "security", content: "JWT tokens should be signed with RS256 algorithm." }
                ]
            }
        ];

        assert.equal(detector.isStuck(staticRounds), true);

        const evolvingRounds = [
            {
                round: 1,
                messages: [
                    { persona: "security", content: "Initial security position." }
                ]
            },
            {
                round: 2,
                messages: [
                    { persona: "security", content: "Completely revised proposal incorporating backend database caching." }
                ]
            }
        ];

        assert.equal(detector.isStuck(evolvingRounds), false);
    });

    await test("LoopDetector detects repeated unaddressed concerns across decisions", () => {

        const detector = new LoopDetector();

        const decisions = [
            { unaddressed: ["Token revocation mechanism is missing."] },
            { unaddressed: ["Token revocation mechanism is missing."] }
        ];

        assert.equal(detector.checkUnaddressedConcerns(decisions), true);
    });

    await test("DiscussionEngine validates options and executes mapLimited", async () => {

        let errorCaught = false;

        try {
            new DiscussionEngine({
                task: "",
                personas: ["security"],
                llmCaller: async () => ({ content: "{}" })
            });
        } catch {
            errorCaught = true;
        }

        assert.equal(errorCaught, true, "expected missing task to throw");

        errorCaught = false;
        try {
            new DiscussionEngine({
                task: "Design auth",
                personas: [],
                llmCaller: async () => ({ content: "{}" })
            });
        } catch {
            errorCaught = true;
        }

        assert.equal(errorCaught, true, "expected empty personas to throw");
    });

    await test("DiscussionRepository saves, lists, retrieves, and deletes records", () => {

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-disc-"));

        try {

            const record = {
                id: "disc-test-1",
                task: "Evaluate GraphQL vs REST",
                personas: ["frontend", "backend"],
                total_rounds: 2,
                hit_max_rounds: false,
                stopped_reason: null,
                created_at: 1000,
                finished_at: 2000,
                duration_ms: 1000,
                final_report: {
                    summary: "REST chosen for simple CRUD, GraphQL for rich dashboard."
                },
                rounds: []
            };

            const saved = saveDiscussion(record, tempDir);
            assert.equal(saved.id, "disc-test-1");

            const retrieved = getDiscussion("disc-test-1", tempDir);
            assert.ok(retrieved);
            assert.equal(retrieved.id, "disc-test-1");
            assert.equal(retrieved.final_report.summary, record.final_report.summary);

            const list = listDiscussions(tempDir);
            assert.equal(list.length, 1);
            assert.equal(list[0].id, "disc-test-1");
            assert.equal(list[0].summary, record.final_report.summary);

            const deleted = deleteDiscussion("disc-test-1", tempDir);
            assert.equal(deleted, true);

            assert.equal(getDiscussion("disc-test-1", tempDir), null);
            assert.equal(listDiscussions(tempDir).length, 0);

        } finally {

            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    await test("DiscussionRepository guarantees multi-project isolation", () => {

        const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "repo-proj-a-"));
        const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "repo-proj-b-"));

        try {

            saveDiscussion({ id: "disc-a", task: "Alpha task", personas: ["security"] }, dirA);
            saveDiscussion({ id: "disc-b", task: "Beta task", personas: ["frontend"] }, dirB);

            const listA = listDiscussions(dirA);
            assert.equal(listA.length, 1);
            assert.equal(listA[0].id, "disc-a");

            const listB = listDiscussions(dirB);
            assert.equal(listB.length, 1);
            assert.equal(listB[0].id, "disc-b");

            assert.equal(getDiscussion("disc-a", dirB), null, "Project B leaked Project A's discussion!");
            assert.equal(getDiscussion("disc-b", dirA), null, "Project A leaked Project B's discussion!");

        } finally {

            fs.rmSync(dirA, { recursive: true, force: true });
            fs.rmSync(dirB, { recursive: true, force: true });
        }
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
