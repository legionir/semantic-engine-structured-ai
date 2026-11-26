"use strict";

/*
| p11.test.js: P1-1 provider abstraction
|
| Runs inside p11.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function p11ProviderAbstractionCases(ctx) {

    const {
        ENVELOPE,
        FIXTURES,
        ResponseRepair,
        TOOL_ENVELOPE,
        actions,
        envelopeOf,
        failure,
        headerOf,
        ok,
        prose,
        providers,
        rejection,
        request,
        resetProviderSettings,
        routerFor,
        serialize,
        settings,
        streamed,
        substitute,
        test,
        transport
    } = ctx;

    console.log("P1-1 provider abstraction");

    for (const [name, fixture] of Object.entries(FIXTURES.providers)) {

        await test(`${name}: chat answer is read by the unchanged action parser`, async () => {

            const t = transport(() => ok(substitute(fixture.chat, ENVELOPE)));

            const answer = await providers.createProvider(fixture.spec, { transport: t }).complete(request());

            assert.equal(t.calls.length, 1);
            assert.equal(t.calls[0].url, fixture.url);
            assert.equal(headerOf(t.calls[0], fixture.auth[0]), fixture.auth[1]);

            JSON.parse(t.calls[0].body);

            const action = actions.readModelAction(answer);

            assert.equal(action.structured.action, "final");
            assert.equal(action.structured.response.content, "done");
            assert.equal(answer.provider, name);
            assert.equal(answer.usage.prompt_tokens, 20);
            assert.equal(answer.usage.completion_tokens, 10);
        });

        await test(`${name}: streamed answer equals the deltas and parses`, async () => {

            const t = transport(() => streamed(substitute(fixture.stream, ENVELOPE)));

            const deltas = [];

            const answer =
                await providers.createProvider(fixture.spec, { transport: t })
                    .complete(request({ stream: true }), { onDelta: delta => deltas.push(delta) });

            assert.equal(t.calls[0].url, fixture.stream_url);

            if (fixture.stream_flag === "body") {
                assert.equal(JSON.parse(t.calls[0].body).stream, true);
            }

            assert.equal(deltas.filter(delta => delta.type === "text").map(delta => delta.text).join(""), ENVELOPE);
            assert.equal(answer.choices[0].message.content, ENVELOPE);
            assert.equal(actions.readModelAction(answer).structured.action, "final");
        });

        for (const mode of ["chat", "stream"]) {

            await test(`${name}: native tool call (${mode})`, async () => {

                const t = transport(() => (mode === "chat" ? ok(fixture.tool) : streamed(fixture.stream_tool)));

                const answer =
                    await providers.createProvider(fixture.spec, { transport: t })
                        .complete(request({ stream: mode === "stream" }));

                const parsed = actions.parseStructuredResponse(answer);

                assert.equal(parsed.source, "native_tool_calls");
                assert.equal(parsed.structured.tool_calls.length, 1);
                assert.equal(parsed.structured.tool_calls[0].name, "fs_read");
                assert.deepEqual(parsed.structured.tool_calls[0].arguments, { path: "x.txt" });
                assert.equal(answer.choices[0].finish_reason, "tool_calls");
            });
        }

        await test(`${name}: 429 is retried after the server's delay`, async () => {

            const t = transport((req, n) => (n === 1 ? failure(fixture.errors.rate_limit) : ok(substitute(fixture.chat, ENVELOPE))));

            const sleeps = [];

            const router = routerFor(fixture.spec, { transport: t, sleep: async ms => { sleeps.push(ms); } });

            const answer = await router.complete(request());

            assert.equal(t.calls.length, 2);
            assert.equal(sleeps.length, 1);

            const hinted = fixture.errors.rate_limit.headers || {};

            if (hinted["retry-after-ms"] !== undefined) {
                assert.equal(sleeps[0], Number(hinted["retry-after-ms"]));
            } else if (hinted["retry-after"] !== undefined) {
                assert.equal(sleeps[0], Number(hinted["retry-after"]) * 1000);
            } else {
                assert.equal(sleeps[0], 75);
            }

            assert.equal(answer.routing.attempts, 2);
            assert.equal(answer.routing.fallback, false);
            assert.equal(actions.readModelAction(answer).structured.action, "final");

            const error =
                await rejection(
                    providers.createProvider(fixture.spec, { transport: transport(() => failure(fixture.errors.rate_limit)) })
                        .complete(request())
                );

            assert.ok(error instanceof providers.ProviderError, String(error));
            assert.equal(error.status, 429);
            assert.equal(error.retryable, true);
            assert.equal(error.provider, name);
            assert.ok(!String(error.message).includes(fixture.spec.apiKey), "the API key leaked into the error");
        });

        await test(`${name}: 5xx uses up the retries, then the fallback answers`, async () => {

            const fallback = FIXTURES.providers[name === "ollama" ? "openai" : "ollama"];

            const t = transport(req => (req.url === fallback.url ? ok(substitute(fallback.chat, ENVELOPE)) : failure(fixture.errors.server)));

            const sleeps = [];

            const router =
                routerFor(fixture.spec, {
                    transport: t,
                    fallbacks: [fallback.spec],
                    baseMs: 10,
                    random: () => 0,
                    sleep: async ms => { sleeps.push(ms); }
                });

            const answer = await router.complete(request());

            assert.equal(t.calls.length, 4);
            assert.equal(sleeps.length, 2);
            assert.deepEqual(sleeps, [5, 10]);
            assert.equal(answer.routing.fallback, true);
            assert.equal(answer.routing.provider, fallback.spec.provider);
            assert.equal(actions.readModelAction(answer).structured.action, "final");
        });

        await test(`${name}: an action wrapped in prose is recovered by ResponseRepair`, async () => {

            for (const text of prose(ENVELOPE)) {

                const t = transport(() => ok(substitute(fixture.chat, text)));

                const answer = await providers.createProvider(fixture.spec, { transport: t }).complete(request());

                const action = actions.readModelAction(answer);

                assert.equal(action.structured.action, "final", text.slice(0, 40));
                assert.equal(answer.choices[0].message.content, ENVELOPE);
            }
        });
    }

    await test("prose without exactly one action still gets the correction path", () => {

        const cases = [
            "not json at all",
            `Either ${ENVELOPE} or ${TOOL_ENVELOPE}`,
            "Here: {\"foo\": 1}"
        ];

        for (const content of cases) {

            let thrown = null;

            try {
                actions.readModelAction(envelopeOf(content));
            } catch (error) {
                thrown = error;
            }

            assert.ok(thrown, content);
            assert.ok(thrown.message.startsWith("AI returned neither structured JSON nor a native tool call."), thrown.message);
            assert.equal(thrown.code, "UNREADABLE_RESPONSE");
        }

        assert.equal(ResponseRepair.salvageActionFromProse(`ok ${TOOL_ENVELOPE} bye`).action.action, "tool_call");
        assert.equal(ResponseRepair.salvageActionFromProse(`a ${ENVELOPE} b ${ENVELOPE}`).action.action, "final");
    });

    await test("AGENT_PROVIDER accepts exactly the registered providers; the default keeps the old endpoint", () => {

        assert.deepEqual(
            settings.definitionOf("AGENT_PROVIDER").values.slice().sort(),
            providers.providerNames().slice().sort()
        );

        assert.equal(providers.providerNames().length, 9);

        if (settings.sourceOf("AGENT_PROVIDER") === "default") {

            const config = providers.fromSettings();

            assert.equal(config.primary.provider, "openai-compatible");
            assert.equal(config.primary.baseUrl, settings.get("AGENT_BASE_URL"));
        }
    });

    await test("switching provider is a settings change only (all providers, same calling code)", async () => {

        const baseUrlFromEnvironment = settings.sourceOf("AGENT_BASE_URL") === "environment";

        try {

            for (const [name, fixture] of Object.entries(FIXTURES.providers)) {

                resetProviderSettings();

                settings.set("AGENT_PROVIDER", fixture.spec.provider);
                settings.set("AGENT_MODEL", fixture.spec.model);
                settings.set("AGENT_API_KEY", fixture.spec.apiKey);

                if (fixture.spec.baseUrl) {
                    settings.set("AGENT_BASE_URL", fixture.spec.baseUrl);
                }

                if (fixture.spec.region) {
                    settings.set("AGENT_PROVIDER_REGION", fixture.spec.region);
                }

                if (fixture.spec.apiVersion) {
                    settings.set("AZURE_OPENAI_API_VERSION", fixture.spec.apiVersion);
                }

                const t = transport(() => ok(substitute(fixture.chat, ENVELOPE)));

                const router = providers.createRouter({ transport: t });

                /* the body RequestBuilder sends today */
                const answer =
                    await router.chatCompletions({
                        model: fixture.spec.model,
                        messages: request().messages,
                        temperature: 0.2,
                        tools: request().tools,
                        parallel_tool_calls: true,
                        response_format: {
                            type: "json_schema",
                            json_schema: { name: "agent_action", schema: { type: "object" }, strict: false }
                        }
                    });

                if (!baseUrlFromEnvironment || fixture.spec.baseUrl) {
                    assert.equal(t.calls[0].url, fixture.url, name);
                }

                assert.equal(answer.routing.provider, fixture.spec.provider, name);
                assert.equal(actions.readModelAction(answer).structured.action, "final", name);
            }

        } finally {
            resetProviderSettings();
        }
    });

    await test("a model per role; the operator key is never sent to another vendor", async () => {

        try {

            resetProviderSettings();

            settings.set("AGENT_PROVIDER", "openai-compatible");
            settings.set("AGENT_API_KEY", "operator-key");
            settings.set("AGENT_BASE_URL", "http://127.0.0.1:4414/p/smart_routing/v1");
            settings.set("AGENT_MODEL", "auto-switch");

            settings.set("PROVIDER_ROLES", JSON.stringify({
                planner: "anthropic:claude-opus-4-1",
                coder: { provider: "openai", model: "gpt-4.1", apiKey: "coder-key" },
                observer: "small-local-model"
            }));

            const t = transport(req => {

                const fixture =
                    Object.values(FIXTURES.providers).find(item => item.url === req.url) ||
                    FIXTURES.providers["openai-compatible"];

                return ok(substitute(fixture.chat, ENVELOPE));
            });

            const router = providers.createRouter({ transport: t });

            await router.complete(request(), { role: "planner" });
            await router.complete(request(), { role: "coder" });
            await router.complete(request(), { role: "observer" });
            await router.complete(request(), { role: "not-configured" });

            assert.equal(t.calls[0].url, "https://api.anthropic.com/v1/messages");
            assert.equal(JSON.parse(t.calls[0].body).model, "claude-opus-4-1");
            assert.notEqual(headerOf(t.calls[0], "x-api-key"), "operator-key");

            assert.equal(t.calls[1].url, "https://api.openai.com/v1/chat/completions");
            assert.equal(headerOf(t.calls[1], "authorization"), "Bearer coder-key");

            assert.equal(t.calls[2].url, "http://127.0.0.1:4414/p/smart_routing/v1/chat/completions");
            assert.equal(JSON.parse(t.calls[2].body).model, "small-local-model");
            assert.equal(headerOf(t.calls[2], "authorization"), "Bearer operator-key");

            assert.equal(JSON.parse(t.calls[3].body).model, "auto-switch");

            const description = JSON.stringify(router.describe());

            assert.ok(!description.includes("operator-key") && !description.includes("coder-key"), "describe() exposes a key");

            settings.set("PROVIDER_FALLBACKS", JSON.stringify([{ provider: "gemini" }]));

            assert.throws(() => providers.fromSettings(), /needs a model/);

            settings.set("PROVIDER_FALLBACKS", "not json");

            assert.throws(() => providers.fromSettings(), /PROVIDER_FALLBACKS is not valid JSON/);

        } finally {
            resetProviderSettings();
        }
    });

    await test("a 400 is not retried and the error names provider, status and type", async () => {

        const fixture = FIXTURES.providers.anthropic;

        const t = transport(() => failure(fixture.errors.bad_request));

        const sleeps = [];

        const router = routerFor(fixture.spec, { transport: t, maxRetries: 3, sleep: async ms => { sleeps.push(ms); } });

        const error = await rejection(router.complete(request()));

        assert.ok(error instanceof providers.ProviderError, String(error));
        assert.equal(error.status, 400);
        assert.equal(error.retryable, false);
        assert.equal(error.provider, "anthropic");
        assert.equal(error.code, "invalid_request_error");
        assert.equal(t.calls.length, 1);
        assert.equal(sleeps.length, 0);
        assert.equal(error.attempts.length, 1);
    });

    await test("a cancelled request is not retried", async () => {

        const controller = new AbortController();

        const t = transport(() => {
            controller.abort();
            throw new Error("aborted by the caller");
        });

        const router = routerFor(FIXTURES.providers.openai.spec, { transport: t, maxRetries: 3 });

        const error = await rejection(router.complete(request(), { signal: controller.signal }));

        assert.equal(error && error.code, "aborted");
        assert.equal(t.calls.length, 1);
    });

    await test("a stream that already produced output is not retried", async () => {

        const bytes = serialize(substitute(FIXTURES.providers.openai.stream, ENVELOPE));

        const calls = [];

        const t = {
            async request(req) {

                calls.push(req);

                return {
                    status: 200,
                    header: () => null,
                    text: async () => "",
                    body: (async function* () {
                        yield bytes.subarray(0, Math.floor(bytes.length / 2));
                        throw new Error("connection reset");
                    })()
                };
            }
        };

        const deltas = [];

        const router = routerFor(FIXTURES.providers.openai.spec, { transport: t, maxRetries: 3 });

        const error = await rejection(router.complete(request(), { onDelta: delta => deltas.push(delta) }));

        assert.equal(error && error.code, "stream_failed");
        assert.equal(calls.length, 1);
        assert.ok(deltas.length > 0);
        assert.equal(deltas[0].provider, "openai");
    });

    await test("bedrock: a throttling exception frame is retried", async () => {

        const fixture = FIXTURES.providers.bedrock;

        const t = transport((req, n) => (n === 1 ? streamed(fixture.stream_exception) : streamed(substitute(fixture.stream, ENVELOPE))));

        const router = routerFor(fixture.spec, { transport: t });

        const answer = await router.complete(request(), { onDelta: () => {} });

        assert.equal(t.calls.length, 2);
        assert.equal(answer.choices[0].message.content, ENVELOPE);

        const error =
            await rejection(
                providers.createProvider(fixture.spec, { transport: transport(() => streamed(fixture.stream_exception)) })
                    .complete(request({ stream: true }))
            );

        assert.equal(error.status, 429);
        assert.equal(error.retryable, true);
    });
};
