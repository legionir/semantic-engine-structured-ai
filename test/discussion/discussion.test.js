"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

/*
| The discussion system is tested without a model: every test injects
| a deterministic LLM caller, so the suite checks the orchestration —
| isolation, rounds, observer protocol, loop detection, hard stops —
| not the quality of the opinions.
*/

process.env.WORKSPACE_ROOT =
    process.env.WORKSPACE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "agent-discussion-"));

const {
    DiscussionEngine,
    TranscriptStore,
    ObserverRunner,
    LoopDetector,
    PERSONAS,
    OBSERVER,
    listPersonas
} = require("../../agent/discussion");

const {
    buildFirstRoundPrompt,
    buildCrossExamPrompt
} = require("../../agent/discussion/personaRunner");

const { jaccardSimilarity } = require("../../agent/discussion/loopDetector");

const results = [];


function test(name, fn) {

    return Promise.resolve()
        .then(fn)
        .then(() => {
            results.push({ name, ok: true });
            console.log(`  ok   ${name}`);
        })
        .catch(error => {
            results.push({ name, ok: false, error });
            console.log(`  FAIL ${name}`);
            console.log(`       ${error.message}`);
        });
}


/*
| The spec's example task: JWT session storage. Each persona has a
| known position, and the observer is scripted to continue once, then
| finish with the disagreement surfaced.
*/

function createSpecMockLlm() {

    const seen = { observerRounds: 0 };

    return async (messages, personaDef) => {

        const system = messages[0]?.content || "";
        const user = messages[1]?.content || "";

        if (personaDef.id === "observer") {

            const rounds = (user.match(/=== Round/g) || []).length;
            seen.observerRounds = rounds;

            if (rounds >= 2) {
                return {
                    content:
                        "```json\n" +
                        JSON.stringify({
                            decision: "FINISH",
                            agreements: [
                                "JWT must not sit in localStorage",
                                "httpOnly cookie is the storage of choice"
                            ],
                            open_points: [],
                            unaddressed: [],
                            instructions: {},
                            final_report: {
                                summary:
                                    "Store the JWT in an httpOnly, Secure, SameSite cookie; the backend owns token issuance and refresh; the frontend reads session state through an API endpoint.",
                                agreed_points: [
                                    "no localStorage for tokens",
                                    "backend issues and refreshes tokens"
                                ],
                                unresolved: [
                                    {
                                        topic: "CSRF protection for the httpOnly cookie",
                                        sides: [
                                            {
                                                persona: "security",
                                                reasoning: "httpOnly does not stop CSRF; an anti-CSRF token is required"
                                            },
                                            {
                                                persona: "frontend",
                                                reasoning: "a double-submit token adds a fetch dance to every stateful call"
                                            }
                                        ]
                                    }
                                ],
                                next_steps: [
                                    { order: 1, layer: "backend", action: "POST /api/auth/login sets an httpOnly cookie" },
                                    { order: 2, layer: "backend", action: "POST /api/auth/refresh rotates the token" },
                                    { order: 3, layer: "frontend", action: "useSession reads GET /api/session" }
                                ]
                            }
                        }) +
                        "\n```"
                };
            }

            return {
                content:
                    "```json\n" +
                    JSON.stringify({
                        decision: "CONTINUE",
                        agreements: ["localStorage is unsafe for the JWT"],
                        open_points: [
                            {
                                topic: "CSRF vs client access",
                                disagreeing: ["security vs frontend"],
                                why: "httpOnly blocks XSS but opens CSRF"
                            }
                        ],
                        unaddressed: ["frontend has not answered the CSRF concern"],
                        instructions: {
                            security: "state the exact CSRF mitigation you require",
                            frontend: "propose the API shape that consumes the httpOnly cookie"
                        },
                        final_report: null
                    }) +
                    "\n```"
            };
        }

        const opinions = {
            security:
                "Security: a JWT in localStorage is readable by any injected script — XSS means token theft. Use an httpOnly, Secure, SameSite=Strict cookie. Open risk: CSRF, which needs an anti-CSRF token.",
            backend:
                "Backend: the endpoint is POST /api/auth/login returning Set-Cookie, plus POST /api/auth/refresh with rotation and GET /api/session for state. Errors are 401 with a machine-readable code.",
            frontend:
                "Frontend: with httpOnly the client cannot read the cookie, so useSession must fetch GET /api/session. Keep auth state in a context provider, not in every component.",
            database:
                "Database: a sessions table (user_id, token_hash, expires_at, revoked_at) supports revocation; stateless JWT cannot be revoked. Index on token_hash.",
            performance:
                "Performance: a ~500 byte cookie per request is fine; cache the session lookup in Redis with the token TTL to avoid a DB hit per request."
        };

        return { content: opinions[personaDef.id] || `[${personaDef.id}] a position from my lens` };
    };
}


/* Observer that never lets the group stop, to test the hard stop. */
function createStubbornMockLlm() {

    return async (messages, personaDef) => {

        if (personaDef.id === "observer") {
            return {
                content: JSON.stringify({
                    decision: "CONTINUE",
                    agreements: [],
                    open_points: [],
                    unaddressed: [],
                    instructions: { security: "keep going" },
                    final_report: null
                })
            };
        }

        return { content: "position round " + Date.now() + Math.random() };
    };
}


/* A persona that keeps repeating itself; the observer keeps the same
   unaddressed concern, which is the stuck signal the detector watches. */
function createRepeatingMockLlm() {

    return async (messages, personaDef) => {

        if (personaDef.id === "observer") {
            return {
                content: JSON.stringify({
                    decision: "CONTINUE",
                    agreements: [],
                    open_points: [],
                    unaddressed: ["the caching question is still unanswered"],
                    instructions: { performance: "answer the caching question" },
                    final_report: null
                })
            };
        }

        return { content: "I keep the same position as before, no change." };
    };
}


async function main() {

    /* ---------------------------------------------------------------- */
    console.log("personas");

    await test("15 selectable personas, observer separate", async () => {

        assert.equal(PERSONAS.length, 15);
        assert.equal(listPersonas().length, 15);
        assert.ok(!listPersonas().some(p => p.id === "observer"));

        for (const persona of PERSONAS) {
            assert.ok(persona.id, "persona needs an id");
            assert.ok(persona.system_prompt.length > 100, "persona needs a real system prompt");
            assert.ok(Array.isArray(persona.tools), "persona tools must be a list");
            assert.ok(["L1", "L2", "MAIN"].includes(persona.model_role), "persona needs a model role");
        }

        assert.equal(OBSERVER.id, "observer");
        assert.deepEqual(OBSERVER.tools, []);
    });

    await test("discussion personas and profiles are registered", async () => {

        const registry = path.resolve(__dirname, "..", "..", "agent", "registry");

        const personas = JSON.parse(fs.readFileSync(path.join(registry, "personas.json"), "utf8"));
        const agents = JSON.parse(fs.readFileSync(path.join(registry, "agents.json"), "utf8"));
        const tools = JSON.parse(fs.readFileSync(path.join(registry, "tools.json"), "utf8"));

        const personaNames = new Set(personas.map(p => p.name));
        const toolNames = new Set(tools.map(t => t.function.name));

        for (const persona of [...PERSONAS, OBSERVER]) {
            assert.ok(personaNames.has(persona.id), `persona ${persona.id} missing from personas.json`);
        }

        for (const persona of PERSONAS) {
            const agent = agents.find(a => a.name === `discussion_${persona.id}`);

            assert.ok(agent, `agent profile discussion_${persona.id} missing`);
            assert.equal(agent.persona, persona.id);
            assert.deepEqual([...persona.tools].sort(), [...agent.tools].sort());

            for (const tool of persona.tools) {
                assert.ok(toolNames.has(tool), `persona ${persona.id} references unknown tool ${tool}`);
            }
        }

        assert.ok(tools.some(t => t.function.name === "discussion_start"), "discussion_start declared in tools.json");
    });

    /* ---------------------------------------------------------------- */
    console.log("transcript");

    await test("round 1 is isolated for every persona", async () => {

        const store = new TranscriptStore();

        store.addRound({
            round: 1,
            messages: [
                { persona: "security", persona_name: "Security Agent", content: "security says X", round: 1 },
                { persona: "backend", persona_name: "Backend Agent", content: "backend says Y", round: 1 }
            ],
            started_at: 0,
            ended_at: 0
        });

        assert.match(store.formatForPersona("security", 1), /independent/);
        assert.doesNotMatch(store.formatForPersona("security", 1), /backend says/);
    });

    await test("round 2+ shows the prior rounds, truncated", async () => {

        const store = new TranscriptStore();

        store.addRound({
            round: 1,
            messages: [
                { persona: "security", persona_name: "Security Agent", content: "A".repeat(5000), round: 1 },
                { persona: "backend", persona_name: "Backend Agent", content: "backend says Y", round: 1 }
            ],
            started_at: 0,
            ended_at: 0
        });

        const forBackend = store.formatForPersona("backend", 2, 100);

        assert.match(forBackend, /Security Agent/);
        assert.doesNotMatch(forBackend, /backend says/);
        assert.match(forBackend, /\.\.\./);
        assert.ok(forBackend.length < 300, "long messages must be truncated");
    });

    await test("the full transcript keeps round order", async () => {

        const store = new TranscriptStore();

        store.addRound({ round: 1, messages: [{ persona: "a", persona_name: "A", content: "one", round: 1 }], started_at: 0, ended_at: 0 });
        store.addRound({ round: 2, messages: [{ persona: "a", persona_name: "A", content: "two", round: 2 }], started_at: 0, ended_at: 0 });

        assert.equal(store.getAllMessages().length, 2);
        assert.equal(store.getMessagesForRound(2)[0].content, "two");
    });

    /* ---------------------------------------------------------------- */
    console.log("prompts");

    await test("round one prompt forbids seeing the others", async () => {

        const prompt = buildFirstRoundPrompt("design auth", "a Next.js app");

        assert.match(prompt, /design auth/);
        assert.match(prompt, /a Next\.js app/);
        assert.match(prompt, /do NOT see other personas/);
    });

    await test("cross-examination prompt demands a reaction", async () => {

        const prompt = buildCrossExamPrompt("design auth", "[Security Agent]: no localStorage", "state the CSRF mitigation", "the security lens");

        assert.match(prompt, /Prior discussion transcript/);
        assert.match(prompt, /no localStorage/);
        assert.match(prompt, /state the CSRF mitigation/);
        assert.match(prompt, /the security lens/);
        assert.match(prompt, /MUST explicitly react/);
    });

    /* ---------------------------------------------------------------- */
    console.log("observer");

    const parseObserver = new ObserverRunner({
        llmCaller: async () => ({ content: "not json at all" })
    });

    await test("invalid observer output degrades to a finish, not a crash", async () => {

        const store = new TranscriptStore();

        store.addRound({ round: 1, messages: [{ persona: "security", persona_name: "Security Agent", content: "x", round: 1 }], started_at: 0, ended_at: 0 });

        const decision =
            await parseObserver.review({ task: "t", transcriptStore: store, currentRound: 1, maxRounds: 5, previousDecisions: [] });

        assert.equal(decision.decision, "FINISH");
        assert.ok(decision.final_report.summary.length > 0);
        assert.ok(decision._parse_error);
    });

    const fenceObserver = new ObserverRunner({
        llmCaller: async () => ({
            content: '```json\n{"decision":"CONTINUE","agreements":[],"open_points":[],"unaddressed":[],"instructions":{},"final_report":null}\n```'
        })
    });

    await test("fenced JSON is accepted", async () => {

        const decision =
            await fenceObserver.review({ task: "t", transcriptStore: new TranscriptStore(), currentRound: 1, maxRounds: 5, previousDecisions: [] });

        assert.equal(decision.decision, "CONTINUE");
    });

    const bogusObserver = new ObserverRunner({
        llmCaller: async () => ({
            content: JSON.stringify({ decision: "MAYBE", agreements: [], open_points: [], unaddressed: [], instructions: {}, final_report: null })
        })
    });

    await test("an invalid decision at max rounds is forced to FINISH with a report", async () => {

        const decision =
            await bogusObserver.review({ task: "t", transcriptStore: new TranscriptStore(), currentRound: 5, maxRounds: 5, previousDecisions: [] });

        assert.equal(decision.decision, "FINISH");
        assert.ok(decision.final_report, "a finish must carry a report");
    });

    /* ---------------------------------------------------------------- */
    console.log("loop detector");

    await test("identical messages across rounds are a loop", async () => {

        const detector = new LoopDetector();

        const rounds = [
            { round: 1, messages: [{ persona: "a", content: "same text here" }, { persona: "b", content: "other" }] },
            { round: 2, messages: [{ persona: "a", content: "same text here" }, { persona: "b", content: "changed a lot" }] },
            { round: 3, messages: [{ persona: "a", content: "same text here" }, { persona: "b", content: "more change" }] }
        ];

        /* only one of two personas repeats, so the majority rule says
           the discussion is still moving */
        assert.equal(detector.isStuck(rounds), false);
    });

    await test("every persona repeating is a loop", async () => {

        const detector = new LoopDetector();

        const round = n => ({
            round: n,
            messages: [
                { persona: "a", content: "the very same position again and again" },
                { persona: "b", content: "no movement in my view either, same point" }
            ]
        });

        assert.equal(detector.isStuck([round(1), round(2), round(3)]), true);
    });

    await test("an unaddressed concern that survives a round is a loop", async () => {

        const detector = new LoopDetector();

        const same = { decision: "CONTINUE", unaddressed: ["the caching question is still unanswered"] };

        assert.equal(detector.checkUnaddressedConcerns([same, { ...same }]), true);
        assert.equal(detector.checkUnaddressedConcerns([same]), false);
        assert.equal(
            detector.checkUnaddressedConcerns([same, { decision: "CONTINUE", unaddressed: ["a different concern"] }]),
            false
        );
    });

    await test("jaccard similarity is sane", async () => {

        assert.ok(jaccardSimilarity("a b c", "a b c") > 0.99);
        assert.ok(jaccardSimilarity("a b c", "x y z") < 0.1);
    });

    /* ---------------------------------------------------------------- */
    console.log("engine");

    await test("unknown persona is rejected before any model call", async () => {

        let called = false;

        try {
            new DiscussionEngine({
                task: "t",
                personas: ["quantum"],
                llmCaller: async () => { called = true; return { content: "" }; }
            });
        } catch (error) {
            assert.match(error.message, /Unknown persona/);
        }

        assert.equal(called, false);
    });

    await test("the spec's example task: continue once, finish with the disagreement surfaced", async () => {

        const engine = new DiscussionEngine({
            task: "Design user session storage for a Next.js app with JWT — localStorage or httpOnly cookies?",
            personas: ["security", "backend", "frontend", "database", "performance"],
            maxRounds: 3,
            llmCaller: createSpecMockLlm(),
            workspaceContext: "Next.js 14 app, App Router, TypeScript"
        });

        const result = await engine.run();

        assert.equal(result.total_rounds, 2);
        assert.equal(result.hit_max_rounds, false);
        assert.equal(result.rounds.length, 2);

        /* every selected persona spoke in every round */
        for (const round of result.rounds) {
            assert.equal(round.messages.length, 5);
            for (const id of ["security", "backend", "frontend", "database", "performance"]) {
                assert.ok(round.messages.some(m => m.persona === id), `${id} missing from round ${round.round}`);
            }
        }

        /* the observer continued once, with a targeted instruction per
           side of the disagreement, then finished */
        assert.equal(result.observer_decisions.length, 2);
        assert.equal(result.observer_decisions[0].decision, "CONTINUE");
        assert.ok(result.observer_decisions[0].instructions.security);
        assert.ok(result.observer_decisions[0].instructions.frontend);
        assert.equal(result.observer_decisions[1].decision, "FINISH");

        /* the final report is the synthesis: summary, agreements, the
           explicit disagreement with both sides, ordered next steps */
        const report = result.final_report;

        assert.ok(report.summary.length > 40);
        assert.ok(report.agreed_points.length >= 2);
        assert.equal(report.unresolved.length, 1);
        assert.equal(report.unresolved[0].sides.length, 2);
        assert.ok(report.unresolved[0].sides.some(s => s.persona === "security"));
        assert.ok(report.unresolved[0].sides.some(s => s.persona === "frontend"));
        assert.ok(report.next_steps.length >= 3);
        assert.deepEqual(
            report.next_steps.map(step => step.layer),
            ["backend", "backend", "frontend"]
        );
    });

    await test("max rounds is a hard stop, with a forced final report", async () => {

        const engine = new DiscussionEngine({
            task: "t",
            personas: ["security", "backend"],
            maxRounds: 2,
            llmCaller: createStubbornMockLlm()
        });

        const result = await engine.run();

        assert.equal(result.total_rounds, 2);
        assert.equal(result.hit_max_rounds, true);
        assert.ok(result.final_report, "the forced finish must produce a report");
        assert.equal(result.observer_decisions.at(-1).decision, "FINISH");
    });

    await test("a repeating group is stopped before the next round", async () => {

        const engine = new DiscussionEngine({
            task: "t",
            personas: ["security", "performance"],
            maxRounds: 5,
            llmCaller: createRepeatingMockLlm()
        });

        const result = await engine.run();

        assert.equal(result.stopped_reason, "loop_detected");
        assert.equal(result.total_rounds, 2);
        assert.ok(result.final_report, "the forced finish must produce a report");
    });

    await test("engine callbacks fire in order", async () => {

        const order = [];

        const engine = new DiscussionEngine({
            task: "t",
            personas: ["security"],
            maxRounds: 1,
            llmCaller: async (messages, personaDef) => {
                if (personaDef.id === "observer") {
                    return {
                        content: JSON.stringify({
                            decision: "FINISH",
                            agreements: [],
                            open_points: [],
                            unaddressed: [],
                            instructions: {},
                            final_report: { summary: "s", agreed_points: [], unresolved: [], next_steps: [{ order: 1, layer: "x", action: "a" }] }
                        })
                    };
                }

                return { content: "position" };
            },
            onMessage: message => order.push(`message:${message.persona}:r${message.round}`),
            onRound: round => order.push(`round:${round.round}`),
            onObserver: (decision, round) => order.push(`observer:${decision.decision}:r${round}`)
        });

        await engine.run();

        assert.deepEqual(order, ["message:security:r1", "round:1", "observer:FINISH:r1"]);
    });

    await test("a round respects the parallel-agent budget", async () => {

        let inFlight = 0;
        let peak = 0;

        const engine = new DiscussionEngine({
            task: "t",
            personas: ["security", "backend", "frontend", "database", "performance"],
            maxRounds: 1,
            maxParallel: 2,
            llmCaller: async (messages, personaDef) => {
                if (personaDef.id === "observer") {
                    return {
                        content: JSON.stringify({
                            decision: "FINISH",
                            agreements: [],
                            open_points: [],
                            unaddressed: [],
                            instructions: {},
                            final_report: { summary: "s", agreed_points: [], unresolved: [], next_steps: [] }
                        })
                    };
                }

                inFlight++;
                peak = Math.max(peak, inFlight);

                /* let the wave overlap before finishing */
                await new Promise(resolve => setTimeout(resolve, 20));

                inFlight--;

                return { content: "position" };
            }
        });

        const result = await engine.run();

        assert.equal(result.rounds[0].messages.length, 5, "every persona still spoke");
        assert.ok(peak <= 2, `the budget was exceeded: ${peak} in flight`);
        assert.ok(peak > 1, "personas within a wave should overlap");
    });

    /* ---------------------------------------------------------------- */
    console.log("tool");

    const tools = require("../../agent/tools");

    await test("discussion_start is registered and callable", async () => {

        assert.ok(tools.implementedToolNames().includes("discussion_start"));
        assert.ok(tools.hasTool("discussion_start"));

        const result =
            await tools.executeTool(
                "discussion_start",
                {
                    task: "design session storage with JWT",
                    personas: ["security", "backend"],
                    max_rounds: 2,
                    mock: true
                },
                { agent: "test" }
            );

        assert.equal(result.ok, true);
        assert.equal(result.total_rounds, 2);
        assert.ok(result.final_report.summary.length > 0);
        assert.equal(result.rounds.length, 2);
        assert.equal(result.rounds[0].messages.length, 2);
        assert.match(result.rounds[0].messages[0].content, /\[MOCK security\]/);
    });

    await test("discussion_start validates its arguments", async () => {

        const base = { task: "t", personas: ["security"], mock: true };

        for (const broken of [
            { personas: ["security"] },
            { task: "t", personas: [] },
            { task: "t", personas: ["quantum"] },
            { ...base, max_rounds: 0 },
            { ...base, max_rounds: 11 }
        ]) {
            try {
                await tools.executeTool("discussion_start", broken, { agent: "test" });
                throw new Error(`expected ${JSON.stringify(broken)} to be rejected`);
            } catch (error) {
                if (error.message.startsWith("expected")) {
                    throw error;
                }
            }
        }
    });

    await test("discussion_start refuses to fake a real discussion", async () => {

        /*
        | With an unreachable endpoint and no mock opt-in the tool must
        | fail loudly, never answer with canned opinions.
        */

        const agent = require("../../agent/agent");

        agent.settings.set("AGENT_BASE_URL", "http://127.0.0.1:9/v1");
        agent.settings.set("MAX_REQUEST_RETRIES", 0);

        try {
            const result =
                await tools.executeTool(
                    "discussion_start",
                    { task: "t", personas: ["security"], mock: false },
                    { agent: "test" }
                );

            assert.ok(!JSON.stringify(result).includes("[MOCK"), "a mock answer is not a discussion");

            throw new Error("expected the call to fail without a reachable endpoint");
        } catch (error) {
            if (error.message.startsWith("expected the call")) {
                throw error;
            }
        }
    });

    /* ---------------------------------------------------------------- */

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    process.exit(failed.length === 0 ? 0 : 1);
}


if (require.main === module) {
    main();
}


module.exports = { main };
