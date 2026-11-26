"use strict";

/*
| Reactive console — drawing from the store and keeping what the operator did
|
| Runs inside reactive.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");
const path = require("path");
const harness = require("../harness");

const APP = path.join(harness.PUBLIC_DIR, "app");


module.exports = async function Rendering({ test, console_, settle, byId, card, requests }) {

    await test("a view that throws shows a notice in its panel and the others keep drawing", async () => {
        const { pathToFileURL } = require("url");
        const dom = await import(pathToFileURL(path.join(APP, "dom.js")).href);
        const store = await import(pathToFileURL(path.join(APP, "store.js")).href);
        const broken = document.createElement("div");
        const healthy = document.createElement("div");
        let fail = true;
        let draws = 0;
        const quiet = console.error;
        console.error = () => {};
        try {
            const stopBroken = dom.mount(broken, () => {
                if (fail) throw new Error("bad event");
                return dom.html`<p class="ok">fine again</p>`;
            }, ["history"]);
            const stopHealthy = dom.mount(healthy, () => dom.html`<span>${++draws}</span>`, ["history"]);
            assert.ok(broken.querySelector(".view-error"), "the broken panel says so");
            assert.equal(healthy.textContent, "1");
            store.touch("history");
            assert.equal(healthy.textContent, "2", "the other panel keeps drawing");
            fail = false;
            store.touch("history");
            assert.ok(broken.querySelector(".ok"), "the next good render replaces the notice");
            stopBroken();
            stopHealthy();
        } finally {
            console.error = quiet;
        }
    });

    await test("a discussion reads the same watched live or reopened from storage", async () => {
        const { pathToFileURL } = require("url");
        const load = file => import(pathToFileURL(path.join(APP, file)).href);
        const [dom, store, model, view] = await Promise.all([
            load("dom.js"), load("store.js"), load("discussion-model.js"), load("discussion-view.js")
        ]);

        const live = store.createState();
        const events = [
            { type: "discussion:start", id: "d1", task: "pick a db", personas: ["a", "b"], max_rounds: 3 },
            { type: "discussion:message", round: 1, persona: "a", persona_name: "Alice", content: "postgres" },
            { type: "discussion:message", round: 1, persona: "b", persona_name: "Bob", content: "sqlite" },
            { type: "discussion:observer", round: 1, decision: "CONTINUE", open_points: [{ topic: "no agreement", disagreeing: [] }] },
            { type: "discussion:message", round: 2, persona: "a", persona_name: "Alice", content: "postgres, with reasons" },
            { type: "discussion:observer", round: 2, decision: "FINISH", open_points: [] },
            { type: "discussion:finish", total_rounds: 2, hit_max_rounds: false,
                final_report: { summary: "use postgres", agreed_points: ["postgres"], unresolved: [], next_steps: [{ order: 1, layer: "L1", action: "migrate" }] } }
        ];
        for (const event of events) model.reduceDiscussion(live, event);

        /* the stored form lists decisions before rounds; the reading order must not follow it */
        const stored = store.createState();
        stored.discussion = {
            id: "d1", status: "done", task: "pick a db", personas: ["a", "b"], max_rounds: 3,
            total_rounds: 2, hit_max_rounds: false,
            observer_decisions: [
                { round: 1, decision: "CONTINUE", open_points: [{ topic: "no agreement", disagreeing: [] }] },
                { round: 2, decision: "FINISH", open_points: [] }
            ],
            rounds: [
                { round: 2, messages: [{ persona: "a", persona_name: "Alice", content: "postgres, with reasons", round: 2 }] },
                { round: 1, messages: [
                    { persona: "a", persona_name: "Alice", content: "postgres", round: 1 },
                    { persona: "b", persona_name: "Bob", content: "sqlite", round: 1 }
                ] }
            ],
            final_report: { summary: "use postgres", agreed_points: ["postgres"], unresolved: [], next_steps: [{ order: 1, layer: "L1", action: "migrate" }] }
        };

        const draw = state => {
            const container = document.createElement("div");
            dom.render(dom.h(view.Discussion, { state }), container);
            return container.textContent.replace(/\s+/g, " ").trim();
        };

        const watched = draw(live);
        assert.equal(draw(stored), watched);
        assert.ok(watched.indexOf("sqlite") < watched.indexOf("no agreement"), "a round's messages come before its decision");
        assert.ok(watched.indexOf("no agreement") < watched.indexOf("with reasons"), "and the decision before the next round");
        assert.match(watched, /use postgres/);
    });

    await test("a snapshot of 500 events is drawn once and quickly", async () => {
        const events = [];
        events.push({ type: "run:start", task: "big" });
        events.push({ type: "agent:start", agent: "main_agent", depth: 0 });
        for (let i = 0; i < 249; i++) {
            const call = { agent: "main_agent", graph_id: "g", iteration: 1, id: `c${i}`, name: "fs_read", wave: 0, call_key: `main_agent|g|c${i}` };
            events.push({ type: "tool:start", ...call, depends_on: [], arguments_preview: "{}" });
            events.push({ type: "tool:end", ...call, success: true, duration_ms: 3, result_preview: "{}" });
        }
        /* both modals open: the costly case, every view draws the snapshot */
        card.tree();
        card.log();
        const started = performance.now();
        console_.snapshot({ status: "idle", turns: 3, messages: [], events, approvals: [] });
        const elapsed = performance.now() - started;
        assert.ok(card.tree().querySelectorAll("button.tool").length >= 249, "every call is drawn");
        /* the old renderer redrew the tree per event; the budget is far above
           one render and far below 500 of them */
        if (process.env.UI_PERF) console.log(`       500-event snapshot: ${elapsed.toFixed(1)} ms`);
        assert.ok(elapsed < 1500, `took ${elapsed.toFixed(0)} ms`);
    });

    await test("a reconnect's snapshot replaces the conversation instead of adding to it", async () => {
        const messages = [
            { role: "user", kind: "message", content: "hello", at: 1 },
            { role: "assistant", kind: "response", content: "hi there", at: 2 }
        ];
        const snapshot = { status: "idle", turns: 1, messages, events: [{ type: "session:message", message: messages[0] }] };
        console_.snapshot(snapshot);
        const first = byId("chat").querySelectorAll(".bubble").length;
        const firstBubble = byId("chat").querySelector(".bubble");
        assert.equal(first, 2, "session:message replay does not double the bubbles");
        console_.snapshot(snapshot);
        assert.equal(byId("chat").querySelectorAll(".bubble").length, 2, "the same snapshot again changes nothing");
        assert.equal(byId("chat").querySelector(".bubble"), firstBubble, "and keeps the same nodes");
    });

    await test("a replayed snapshot does not re-run what its events once asked for", async () => {
        const settingsBefore = requests(/^\/api\/settings$/).length;
        const sessionsBefore = requests(/\/api\/sessions\//).length;
        console_.snapshot({
            status: "idle",
            turns: 1,
            messages: [],
            events: [
                { type: "settings:changed" },
                { type: "session:switched", session: { id: "s-other", title: "x" } }
            ]
        });
        await settle();
        assert.equal(requests(/^\/api\/settings$/).length, settingsBefore, "settings are not reloaded");
        assert.equal(requests(/\/api\/sessions\//).length, sessionsBefore, "no session is loaded");
    });

    await test("a plan phase the operator folded stays folded while the plan updates", async () => {
        const plan = done => ({
            exists: true, objective: "o", steps: 2, done, blocked: 0,
            phases: [{ id: "P1", title: "Core", status: "in_progress", steps: [{ id: "P1.1", title: "a", status: done ? "done" : "pending" }] }]
        });
        console_.send({ type: "plan:update", plan: plan(0) });
        const phase = byId("plan").querySelector("details.plan-phase");
        assert.equal(phase.open, true, "an in-progress phase starts open");
        phase.open = false;
        console_.send({ type: "plan:update", plan: plan(1) });
        const after = byId("plan").querySelector("details.plan-phase");
        assert.equal(after, phase, "the same element is kept");
        assert.equal(after.open, false, "and it stays the way the operator left it");
        assert.match(after.textContent, /done/);
    });

    await test("a thinking bubble the operator closed stays closed as the chat grows", async () => {
        console_.send({ type: "session:message", message: { role: "assistant", kind: "thinking", agent: "main_agent", content: "pondering", at: Date.now() } });
        const thinking = [...byId("chat").querySelectorAll(".bubble details")].at(-1);
        thinking.open = false;
        console_.send({ type: "session:message", message: { role: "assistant", kind: "response", content: "done", at: Date.now() } });
        assert.equal(thinking.isConnected, true, "the bubble is not rebuilt");
        assert.equal(thinking.open, false);
    });

    await test("the chat follows new messages only when it is already at the bottom", async () => {
        const chat = byId("chat");
        Object.defineProperty(chat, "scrollHeight", { configurable: true, get: () => 5000 });
        Object.defineProperty(chat, "clientHeight", { configurable: true, get: () => 400 });
        chat.scrollTop = 1000;
        console_.send({ type: "session:message", message: { role: "assistant", kind: "response", content: "while reading above", at: Date.now() } });
        assert.equal(chat.scrollTop, 1000, "reading position is kept");
        chat.scrollTop = 4600;
        console_.send({ type: "session:message", message: { role: "assistant", kind: "response", content: "at the bottom", at: Date.now() } });
        assert.equal(chat.scrollTop, 5000, "the newest message is followed");
        delete chat.scrollHeight;
        delete chat.clientHeight;
    });
};
