"use strict";

/*
| web.test.js: discussion
|
| Runs inside web.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function discussionCases(ctx) {

    const {
        REPO_ROOT,
        WORKSPACE,
        collectEvents,
        consoleServer,
        createServer,
        request,
        runtime,
        startModelStub,
        test,
        waitFor
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\ndiscussion");

    await test("the discussion endpoint lists the selectable personas", async () => {

        const listing =
            await request("GET", "/api/discussion/personas");

        assert.equal(listing.status, 200);
        assert.equal(listing.body.personas.length, 15);
        assert.ok(
            listing.body.personas.every(persona => persona.id && persona.name && persona.description)
        );
        assert.ok(
            !listing.body.personas.some(persona => persona.id === "observer"),
            "the observer is not selectable"
        );
    });

    await test("the discussion endpoint validates its request", async () => {

        const missingTask =
            await request("POST", "/api/discussion", {
                personas: ["security"]
            });

        assert.equal(missingTask.status, 400);

        const unknownPersona =
            await request("POST", "/api/discussion", {
                task: "design auth",
                personas: ["quantum"]
            });

        assert.equal(unknownPersona.status, 400);

        const badRounds =
            await request("POST", "/api/discussion", {
                task: "design auth",
                personas: ["security"],
                max_rounds: 0
            });

        assert.equal(badRounds.status, 400);
    });

    await test("a discussion runs, streams its rounds, and reports", async () => {

        /*
        | The stub plays the observer's protocol: after one round the
        | group continues with a targeted instruction, after two it
        | finishes with the disagreement surfaced.
        */

        const stub =
            await startModelStub(request_ => {

                const system =
                    request_.messages?.[0]?.content || "";
                const user =
                    request_.messages?.[1]?.content || "";

                if (system.startsWith("You are the Observer Agent")) {

                    const rounds =
                        (user.match(/=== Round/g) || []).length;

                    return {
                        content:
                            rounds >= 2
                                ? JSON.stringify({
                                    decision: "FINISH",
                                    agreements: ["no token in localStorage"],
                                    open_points: [],
                                    unaddressed: [],
                                    instructions: {},
                                    final_report: {
                                        summary: "httpOnly cookie for the JWT, /api/session for state.",
                                        agreed_points: ["no localStorage"],
                                        unresolved: [
                                            {
                                                topic: "CSRF",
                                                sides: [
                                                    { persona: "security", reasoning: "httpOnly needs a CSRF token" },
                                                    { persona: "frontend", reasoning: "the token dance is costly on the client" }
                                                ]
                                            }
                                        ],
                                        next_steps: [
                                            { order: 1, layer: "backend", action: "set an httpOnly cookie at login" }
                                        ]
                                    }
                                })
                                : JSON.stringify({
                                    decision: "CONTINUE",
                                    agreements: [],
                                    open_points: [
                                        { topic: "storage", disagreeing: ["security vs frontend"], why: "XSS vs CSRF" }
                                    ],
                                    unaddressed: [],
                                    instructions: { security: "state the CSRF mitigation" },
                                    final_report: null
                                })
                    };
                }

                return { content: "a position from my lens" };
            });

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        const stream = collectEvents();

        await waitFor(
            () => stream.seen.length > 0
        );

        const accepted =
            await request("POST", "/api/discussion", {
                task: "design session storage for a Next.js app with JWT",
                personas: ["security", "frontend", "backend"],
                max_rounds: 3
            });

        assert.equal(accepted.status, 202);
        assert.ok(accepted.body.id);

        const state =
            await waitFor(
                async () => {
                    const current =
                        await request("GET", "/api/state");

                    return current.body.discussion?.status === "done"
                        ? current.body.discussion
                        : null;
                },
                20000
            );

        assert.equal(state.task, "design session storage for a Next.js app with JWT");
        assert.equal(state.rounds.length, 2);
        assert.equal(state.rounds[0].messages.length, 3);
        assert.equal(state.observer_decisions.length, 2);
        assert.equal(state.observer_decisions[0].decision, "CONTINUE");
        assert.equal(state.observer_decisions[1].decision, "FINISH");
        assert.match(state.final_report.summary, /httpOnly/);
        assert.equal(state.final_report.unresolved[0].sides.length, 2);

        const types =
            stream.seen.map(event => event.type);

        for (const type of [
            "discussion:start",
            "discussion:message",
            "discussion:observer",
            "discussion:finish"
        ]) {
            assert.ok(types.includes(type), `missing ${type} in the stream`);
        }

        /* the conversation recorded the request and the report */

        const conversation =
            await request("GET", "/api/state");

        assert.ok(
            conversation.body.messages.some(
                message => message.kind === "discussion-request"
            )
        );
        assert.ok(
            conversation.body.messages.some(
                message => message.kind === "discussion-report"
            )
        );

        stream.stop();

        await stub.close();
    });

    await test("password protection gates browser console access and issues an HttpOnly session", async () => {
        const previousRequired = process.env.AGENT_CONSOLE_PASSWORD_REQUIRED;
        const previousPassword = process.env.AGENT_CONSOLE_PASSWORD;
        process.env.AGENT_CONSOLE_PASSWORD_REQUIRED = "true";
        delete process.env.AGENT_CONSOLE_PASSWORD;
        assert.throws(
            () => createServer(runtime, { apiRateLimit: 1000 }),
            /AGENT_CONSOLE_PASSWORD_REQUIRED is enabled.*AGENT_CONSOLE_PASSWORD is empty/
        );
        process.env.AGENT_CONSOLE_PASSWORD = "correct horse battery staple";

        const protectedServer = createServer(runtime, { apiRateLimit: 1000 });
        try {
            const address = await protectedServer.listen(0, "127.0.0.1");
            const protectedUrl = `http://127.0.0.1:${address.port}`;
            const status = await fetch(`${protectedUrl}/auth/status`).then(response => response.json());
            assert.deepEqual(status, { passwordRequired: true, authenticated: false });

            const deniedApi = await fetch(`${protectedUrl}/api/state`);
            assert.equal(deniedApi.status, 401);
            assert.equal((await fetch(`${protectedUrl}/api/state?token=${encodeURIComponent(protectedServer.token)}`)).status, 401);
            assert.equal((await fetch(`${protectedUrl}/api/state`, {
                headers: { cookie: `structured_ai_console=${encodeURIComponent(protectedServer.token)}` }
            })).status, 401, "a legacy token cookie cannot bypass the password screen");

            const tokenUrl = await fetch(`${protectedUrl}/auth/status?token=${encodeURIComponent(protectedServer.token)}`);
            assert.deepEqual(await tokenUrl.json(), { passwordRequired: true, authenticated: false });

            const badLogin = await fetch(`${protectedUrl}/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ password: "wrong" })
            });
            assert.equal(badLogin.status, 401);

            const goodLogin = await fetch(`${protectedUrl}/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ password: "correct horse battery staple" })
            });
            assert.equal(goodLogin.status, 200);
            const setCookie = goodLogin.headers.get("set-cookie");
            assert.match(setCookie, /structured_ai_console_password=/);
            assert.match(setCookie, /HttpOnly/);
            const cookie = setCookie.split(";")[0];

            const authenticatedStatus = await fetch(`${protectedUrl}/auth/status`, {
                headers: { cookie }
            }).then(response => response.json());
            assert.deepEqual(authenticatedStatus, { passwordRequired: true, authenticated: true });
            assert.equal((await fetch(`${protectedUrl}/api/state`, { headers: { cookie } })).status, 200);
            assert.equal((await fetch(`${protectedUrl}/api/state`, {
                headers: { authorization: `Bearer ${protectedServer.token}` }
            })).status, 200, "programmatic bearer-token authentication remains available");

            /* sign-out revokes the session itself, not just the browser's cookie */
            const crossOrigin = await fetch(`${protectedUrl}/auth/logout`, { method: "POST", headers: { cookie, origin: "https://evil.example" } });
            assert.equal(crossOrigin.status, 403, "a cross-origin page cannot sign the operator out");
            assert.equal((await fetch(`${protectedUrl}/api/state`, { headers: { cookie } })).status, 200, "the refused sign-out changed nothing");
            const logout = await fetch(`${protectedUrl}/auth/logout`, { method: "POST", headers: { cookie } });
            assert.equal(logout.status, 200);
            assert.deepEqual(await logout.json(), { ok: true, revoked: true });
            const cleared = logout.headers.getSetCookie();
            assert.ok(cleared.some(line => /^structured_ai_console_password=;.*Max-Age=0.*HttpOnly/.test(line)), "the session cookie is expired");
            assert.ok(cleared.some(line => /^structured_ai_console=;.*Max-Age=0/.test(line)), "the token cookie is expired too");
            assert.equal(logout.headers.get("cache-control"), "no-store");
            assert.equal((await fetch(`${protectedUrl}/api/state`, { headers: { cookie } })).status, 401, "a copy of the old cookie no longer works");
            assert.deepEqual(await fetch(`${protectedUrl}/auth/status`, { headers: { cookie } }).then(response => response.json()), { passwordRequired: true, authenticated: false });
            const again = await fetch(`${protectedUrl}/auth/logout`, { method: "POST", headers: { cookie } });
            assert.deepEqual([again.status, (await again.json()).revoked], [200, false], "signing out twice is harmless");
            assert.equal((await fetch(`${protectedUrl}/auth/logout`)).status !== 200, true, "GET does not sign out");
        } finally {
            await protectedServer.close();
            if (previousRequired === undefined) delete process.env.AGENT_CONSOLE_PASSWORD_REQUIRED;
            else process.env.AGENT_CONSOLE_PASSWORD_REQUIRED = previousRequired;
            if (previousPassword === undefined) delete process.env.AGENT_CONSOLE_PASSWORD;
            else process.env.AGENT_CONSOLE_PASSWORD = previousPassword;
        }
    });

    /* ---------------------------------------------------------------- */

    await consoleServer.close();

    require(path.join(REPO_ROOT, "agent", "tools")).shutdown();

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};
