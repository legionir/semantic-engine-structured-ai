"use strict";

/*
|--------------------------------------------------------------------------
| P1-1 Provider abstraction - contract tests
|--------------------------------------------------------------------------
|
| Recorded answers (test/fixtures/providers.json) for every adapter:
|
|   openai, openai-responses, anthropic, gemini, azure-openai, bedrock,
|   ollama, openrouter, openai-compatible
|
| For each one: chat, stream, native tool call (plain and streamed),
| 429 with retry, 5xx with retries and fallback, and an action wrapped in
| prose that ResponseRepair recovers. All answers go through the
| unchanged action parser. Plus: provider switch by settings only, a
| model per role, credential isolation, cancellation, SigV4, the AWS
| event stream, vision, token counting, prompt caching and the
| workspace-trust locks for the new settings.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "p11-providers-"));

process.env.STRUCTURED_AI_TRUST_FILE = path.join(WORKSPACE, "trusted-workspaces.json");

const providers = require(path.join(REPO, "agent", "providers"));
const settings = require(path.join(REPO, "agent", "config"));
const actions = require(path.join(REPO, "agent", "actions"));
const ResponseRepair = require(path.join(REPO, "agent", "actions", "ResponseRepair"));
const WorkspaceTrust = require(path.join(REPO, "agent", "projects", "WorkspaceTrust"));
const { crc32, decodeEventStream } = require(path.join(REPO, "agent", "providers", "EventStream"));
const { readSse } = require(path.join(REPO, "agent", "providers", "StreamReaders"));
const { signRequest } = require(path.join(REPO, "agent", "providers", "AwsSigV4"));
const { sanitizeSchema } = require(path.join(REPO, "agent", "providers", "GeminiProvider"));

const FIXTURES = JSON.parse(
    fs.readFileSync(path.join(REPO, "test", "fixtures", "providers.json"), "utf8")
);

const ENVELOPE = JSON.stringify({
    version: "1.0",
    action: "final",
    tool_calls: null,
    delegations: null,
    response: { type: "text", content: "done" },
    data: null,
    error: null,
    performed: null
});

const TOOL_ENVELOPE = JSON.stringify({
    version: "1.0",
    action: "tool_call",
    tool_calls: [{ id: "c9", name: "fs_read", arguments: { path: "y.txt" }, depends_on: [] }],
    delegations: null,
    response: null,
    data: null,
    error: null,
    performed: null
});

const results = [];

async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.message}`);
    }
}


/* ------------------------------ helpers ------------------------------ */

function pieces(text) {

    const a = Math.floor(text.length / 3);
    const b = Math.floor((2 * text.length) / 3);

    return [text.slice(0, a), text.slice(a, b), text.slice(b)];
}


function substitute(value, text) {

    const [t1, t2, t3] = pieces(text);

    const map = { "$TEXT": text, "$T1": t1, "$T2": t2, "$T3": t3 };

    const walk = item => {

        if (typeof item === "string") {
            return Object.prototype.hasOwnProperty.call(map, item) ? map[item] : item;
        }

        if (Array.isArray(item)) {
            return item.map(walk);
        }

        if (item && typeof item === "object") {

            const out = {};

            for (const [key, child] of Object.entries(item)) {
                out[key] = walk(child);
            }

            return out;
        }

        return item;
    };

    return walk(JSON.parse(JSON.stringify(value)));
}


function eventHeader(name, value) {

    const key = Buffer.from(name);
    const text = Buffer.from(value);

    const out = Buffer.alloc(1 + key.length + 1 + 2 + text.length);

    let offset = 0;

    out.writeUInt8(key.length, offset); offset += 1;
    key.copy(out, offset); offset += key.length;
    out.writeUInt8(7, offset); offset += 1;
    out.writeUInt16BE(text.length, offset); offset += 2;
    text.copy(out, offset);

    return out;
}


function eventFrame(headers, payload) {

    const head = Buffer.concat(Object.entries(headers).map(([key, value]) => eventHeader(key, value)));
    const body = Buffer.from(payload);

    const total = 16 + head.length + body.length;

    const prelude = Buffer.alloc(8);

    prelude.writeUInt32BE(total, 0);
    prelude.writeUInt32BE(head.length, 4);

    const preludeCrc = Buffer.alloc(4);

    preludeCrc.writeUInt32BE(crc32(prelude), 0);

    const message = Buffer.concat([prelude, preludeCrc, head, body]);

    const messageCrc = Buffer.alloc(4);

    messageCrc.writeUInt32BE(crc32(message), 0);

    return Buffer.concat([message, messageCrc]);
}


function serialize(stream) {

    if (stream.framing === "eventstream") {

        return Buffer.concat(stream.events.map(event =>
            event.exception
                ? eventFrame(
                    { ":message-type": "exception", ":exception-type": event.exception, ":content-type": "application/json" },
                    JSON.stringify(event.data)
                )
                : eventFrame(
                    { ":message-type": "event", ":event-type": event.event, ":content-type": "application/json" },
                    JSON.stringify(event.data)
                )
        ));
    }

    const eol = stream.framing === "sse-crlf" ? "\r\n" : "\n";

    const text =
        stream.events
            .map(event => {

                const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);

                if (stream.framing === "ndjson") {
                    return `${data}\n`;
                }

                const name =
                    event.event && stream.framing === "sse-event"
                        ? `event: ${event.event}${eol}`
                        : "";

                return `${name}data: ${data}${eol}${eol}`;
            })
            .join("");

    return Buffer.from(text, "utf8");
}


/* irregular chunk sizes, so lines, events and frames split anywhere */
function chunked(buffer, sizes = [7, 1, 13, 3, 29, 64]) {

    const out = [];

    let offset = 0;
    let index = 0;

    while (offset < buffer.length) {

        const size = sizes[index++ % sizes.length];

        out.push(buffer.subarray(offset, offset + size));

        offset += size;
    }

    return out;
}


function transport(handler) {

    const calls = [];

    return {
        calls,

        async request(req) {

            calls.push(req);

            const answer = await handler(req, calls.length);

            const headers = {};

            for (const [key, value] of Object.entries(answer.headers || {})) {
                headers[key.toLowerCase()] = String(value);
            }

            const bytes =
                answer.chunks
                    ? Buffer.concat(answer.chunks.map(chunk => Buffer.from(chunk)))
                    : Buffer.from(
                        typeof answer.body === "string"
                            ? answer.body
                            : JSON.stringify(answer.body === undefined ? {} : answer.body)
                    );

            return {
                status: answer.status || 200,
                header: name => (
                    Object.prototype.hasOwnProperty.call(headers, String(name).toLowerCase())
                        ? headers[String(name).toLowerCase()]
                        : null
                ),
                text: async () => bytes.toString("utf8"),
                body: (async function* () {
                    for (const chunk of answer.chunks || [bytes]) {
                        yield Buffer.from(chunk);
                    }
                })()
            };
        }
    };
}


const ok = body => ({ status: 200, body });

const streamed = stream => ({ status: 200, chunks: chunked(serialize(stream)) });

const failure = error => ({ status: error.status, headers: error.headers, body: error.body });


function headerOf(req, name) {

    for (const [key, value] of Object.entries(req.headers || {})) {

        if (key.toLowerCase() === name.toLowerCase()) {
            return value;
        }
    }

    return undefined;
}


function request(extra = {}) {

    return {
        messages: [
            { role: "system", content: "You are a test agent." },
            { role: "user", content: "Say done." }
        ],
        tools: [
            {
                type: "function",
                function: {
                    name: "fs_read",
                    description: "Read a file",
                    parameters: {
                        type: "object",
                        properties: { path: { type: "string" } },
                        required: ["path"],
                        additionalProperties: false
                    }
                }
            }
        ],
        ...extra
    };
}


function routerFor(primary, options = {}) {

    return new providers.ProviderRouter({
        config: {
            primary: { ...primary, origin: "primary" },
            roles: {},
            fallbacks: (options.fallbacks || []).map(spec => ({ ...spec, origin: "fallback" })),
            retry: { maxRetries: options.maxRetries === undefined ? 2 : options.maxRetries, baseMs: options.baseMs || 100 }
        },
        transport: options.transport,
        sleep: options.sleep || (async () => {}),
        random: options.random || (() => 0.5)
    });
}


function prose(envelope) {

    return [
        `Sure! Here is the action:\n\`\`\`json\n${envelope}\n\`\`\`\nLet me know if you need anything else.`,
        `<think>The user wants {"action":"tool_call"} maybe, but no.</think>\n${envelope}`,
        `Here you go: ${envelope}`,
        `${envelope}\n\nI have finished the task.`
    ];
}


const envelopeOf = content => ({ choices: [{ message: { role: "assistant", content } }] });


async function rejection(promise) {
    return promise.then(() => null, error => error);
}


const providerKeys = [
    "AGENT_PROVIDER",
    "AGENT_MODEL",
    "AGENT_API_KEY",
    "AGENT_BASE_URL",
    "AGENT_PROVIDER_REGION",
    "AZURE_OPENAI_API_VERSION",
    "PROVIDER_ROLES",
    "PROVIDER_FALLBACKS"
];


function resetProviderSettings() {

    for (const key of providerKeys) {
        settings.reset(key);
    }
}


/* -------------------------------- tests -------------------------------- */

async function main() {

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

    await test("bedrock: missing credentials fail closed without a request", async () => {

        const t = transport(() => ok({}));

        const error =
            await rejection(
                providers.createProvider({ provider: "bedrock", model: "amazon.nova-pro-v1:0" }, { transport: t }).complete(request())
            );

        assert.equal(error && error.code, "missing_credentials");
        assert.equal(error.retryable, false);
        assert.equal(t.calls.length, 0);
    });

    await test("SigV4 matches the AWS get-vanilla test vector", () => {

        const headers =
            signRequest({
                method: "GET",
                url: "https://example.amazonaws.com/",
                headers: {},
                body: "",
                region: "us-east-1",
                service: "service",
                accessKeyId: "AKIDEXAMPLE",
                secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
                now: new Date("2015-08-30T12:36:00Z")
            });

        assert.equal(headers["x-amz-date"], "20150830T123600Z");
        assert.equal(
            headers.authorization,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    });

    await test("bedrock: IAM credentials are SigV4-signed", async () => {

        const fixture = FIXTURES.providers.bedrock;

        const t = transport(() => ok(substitute(fixture.chat, ENVELOPE)));

        const spec = {
            provider: "bedrock",
            model: fixture.spec.model,
            region: "us-west-2",
            accessKeyId: "AKIDEXAMPLE",
            secretAccessKey: "not-a-real-secret",
            sessionToken: "session-token",
            now: "2025-01-01T00:00:00Z"
        };

        await providers.createProvider(spec, { transport: t }).complete(request());

        const authorization = headerOf(t.calls[0], "authorization");

        assert.ok(
            authorization.startsWith(
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20250101/us-west-2/bedrock/aws4_request, SignedHeaders=accept;content-type;host;x-amz-date;x-amz-security-token, Signature="
            ),
            authorization
        );

        assert.equal(headerOf(t.calls[0], "x-amz-security-token"), "session-token");
        assert.equal(headerOf(t.calls[0], "host"), undefined);
        assert.equal(t.calls[0].url, fixture.url);
    });

    await test("AWS event stream: CRC32 vector, byte-by-byte frames, corrupt frames refused", async () => {

        assert.equal(crc32(Buffer.from("123456789")), 0xCBF43926);

        const bytes = serialize(substitute(FIXTURES.providers.bedrock.stream, ENVELOPE));

        const frames = [];

        for await (const frame of decodeEventStream([...bytes].map(byte => Buffer.from([byte])))) {
            frames.push(frame);
        }

        assert.equal(frames.length, FIXTURES.providers.bedrock.stream.events.length);
        assert.equal(frames[0].headers[":event-type"], "messageStart");

        const corrupt = Buffer.from(bytes);

        corrupt[corrupt.length - 1] ^= 0xFF;

        await assert.rejects(async () => {
            for await (const frame of decodeEventStream([corrupt])) {
                void frame;
            }
        }, /checksum/);
    });

    await test("SSE keeps multi-byte characters split across chunks", async () => {

        const text = "سلام دنیا - مرحبا";

        const bytes = Buffer.from(`data: ${JSON.stringify({ t: text })}\r\n\r\n`, "utf8");

        const events = [];

        for await (const event of readSse([...bytes].map(byte => Buffer.from([byte])))) {
            events.push(event);
        }

        assert.equal(events.length, 1);
        assert.equal(JSON.parse(events[0].data).t, text);
    });

    await test("vision: an image part reaches every provider in its own format", async () => {

        const data = "iVBORw0KGgo=";
        const image = `data:image/png;base64,${data}`;

        const visionRequest = {
            messages: [
                { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: image } }] }
            ]
        };

        for (const [name, fixture] of Object.entries(FIXTURES.providers)) {

            const t = transport(() => ok(substitute(fixture.chat, ENVELOPE)));

            const provider = providers.createProvider(fixture.spec, { transport: t });

            assert.equal(provider.capabilities().vision, true, name);

            await provider.complete(visionRequest);

            const body = JSON.parse(t.calls[0].body);

            if (name === "anthropic") {
                assert.deepEqual(body.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data } });
            } else if (name === "gemini") {
                assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: "image/png", data } });
            } else if (name === "bedrock") {
                assert.deepEqual(body.messages[0].content[1], { image: { format: "png", source: { bytes: data } } });
            } else if (name === "ollama") {
                assert.deepEqual(body.messages[0].images, [data]);
            } else if (name === "openai-responses") {
                assert.deepEqual(body.input[0].content[1], { type: "input_image", image_url: image });
            } else {
                assert.equal(body.messages[0].content[1].image_url.url, image, name);
            }
        }
    });

    await test("conversation mapping: tool calls and results per provider", async () => {

        const conversation = {
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "read two files" },
                {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        { id: "c1", type: "function", function: { name: "fs_read", arguments: "{\"path\":\"a\"}" } },
                        { id: "c2", type: "function", function: { name: "fs_read", arguments: "{\"path\":\"b\"}" } }
                    ]
                },
                { role: "tool", tool_call_id: "c1", content: "A" },
                { role: "tool", tool_call_id: "c2", content: "B" },
                { role: "user", content: "now summarise" }
            ]
        };

        const bodyFor = async name => {

            const fixture = FIXTURES.providers[name];

            const t = transport(() => ok(substitute(fixture.chat, ENVELOPE)));

            await providers.createProvider(fixture.spec, { transport: t }).complete(conversation);

            return JSON.parse(t.calls[0].body);
        };

        const anthropic = await bodyFor("anthropic");

        assert.equal(anthropic.messages.length, 3);
        assert.deepEqual(anthropic.messages[1].content.map(block => block.input), [{ path: "a" }, { path: "b" }]);
        assert.equal(anthropic.messages[2].role, "user");
        assert.deepEqual(anthropic.messages[2].content.map(block => block.type), ["tool_result", "tool_result", "text"]);
        assert.equal(anthropic.messages[2].content[0].tool_use_id, "c1");
        assert.equal(anthropic.system[0].text, "sys");

        const gemini = await bodyFor("gemini");

        assert.equal(gemini.contents[1].role, "model");
        assert.deepEqual(gemini.contents[1].parts[0].functionCall.args, { path: "a" });
        assert.equal(gemini.contents[2].parts[0].functionResponse.name, "fs_read");
        assert.equal(gemini.systemInstruction.parts[0].text, "sys");

        const responses = await bodyFor("openai-responses");

        assert.equal(responses.instructions, "sys");
        assert.ok(responses.input.some(item => item.type === "function_call" && item.call_id === "c1"));
        assert.ok(responses.input.some(item => item.type === "function_call_output" && item.call_id === "c1" && item.output === "A"));

        const bedrock = await bodyFor("bedrock");

        assert.equal(bedrock.messages[2].content[0].toolResult.toolUseId, "c1");
        assert.equal(bedrock.messages[1].content[0].toolUse.name, "fs_read");

        const ollama = await bodyFor("ollama");

        assert.equal(ollama.stream, false);
        assert.equal(ollama.messages[3].role, "tool");
        assert.equal(ollama.messages[3].tool_name, "fs_read");
        assert.deepEqual(ollama.messages[2].tool_calls[0].function.arguments, { path: "a" });
    });

    await test("gemini: tool schemas are reduced to the subset the API accepts", () => {

        const out = sanitizeSchema({
            type: "object",
            additionalProperties: false,
            $schema: "http://json-schema.org/draft-07/schema#",
            properties: {
                a: { type: ["string", "null"], default: "q" },
                b: { type: "array", items: { type: "object", additionalProperties: true, properties: { c: { type: "integer" } } } }
            },
            required: ["a"]
        });

        assert.deepEqual(out, {
            type: "object",
            properties: {
                a: { type: "string", nullable: true },
                b: { type: "array", items: { type: "object", properties: { c: { type: "integer" } } } }
            },
            required: ["a"]
        });
    });

    await test("token counting: native for anthropic and gemini, estimate otherwise and on failure", async () => {

        for (const name of ["anthropic", "gemini"]) {

            const expected = FIXTURES.count_tokens[name];

            const t = transport(() => ok(expected.body));

            const result = await providers.createProvider(FIXTURES.providers[name].spec, { transport: t }).countTokens(request());

            assert.deepEqual(result, { tokens: 42, method: "native" }, name);
            assert.equal(t.calls[0].url, expected.url);
        }

        const failing =
            await providers.createProvider(FIXTURES.providers.anthropic.spec, {
                transport: transport(() => failure(FIXTURES.providers.anthropic.errors.server))
            }).countTokens(request());

        assert.equal(failing.method, "estimate");
        assert.ok(failing.tokens > 0);

        const estimate =
            await providers.createProvider(FIXTURES.providers.openai.spec, { transport: transport(() => ok({})) })
                .countTokens(request());

        assert.equal(estimate.method, "estimate");
        assert.ok(estimate.tokens > 0);

        assert.ok(providers.estimateTokens("سلام دنیا") >= 4);
    });

    await test("prompt caching marks the stable prefix where the provider needs it", async () => {

        const anthropic = FIXTURES.providers.anthropic;

        const on = transport(() => ok(substitute(anthropic.chat, ENVELOPE)));

        await providers.createProvider({ ...anthropic.spec, promptCaching: true }, { transport: on }).complete(request());

        const cached = JSON.parse(on.calls[0].body);

        assert.deepEqual(cached.system[0].cache_control, { type: "ephemeral" });
        assert.deepEqual(cached.tools[cached.tools.length - 1].cache_control, { type: "ephemeral" });
        assert.equal(typeof cached.max_tokens, "number");

        const off = transport(() => ok(substitute(anthropic.chat, ENVELOPE)));

        await providers.createProvider({ ...anthropic.spec, promptCaching: false }, { transport: off }).complete(request());

        assert.equal(JSON.parse(off.calls[0].body).system[0].cache_control, undefined);

        const bedrock = FIXTURES.providers.bedrock;

        const t = transport(() => ok(substitute(bedrock.chat, ENVELOPE)));

        await providers.createProvider(bedrock.spec, { transport: t }).complete(request());

        assert.deepEqual(JSON.parse(t.calls[0].body).system[1], { cachePoint: { type: "default" } });

        const answer =
            await providers.createProvider(anthropic.spec, { transport: transport(() => ok(substitute(anthropic.chat, ENVELOPE))) })
                .complete(request());

        assert.equal(answer.usage.cached_tokens, 8);
    });

    await test("the new endpoint settings are locked against project files", () => {

        for (const key of [
            "AGENT_PROVIDER",
            "AGENT_PROVIDER_REGION",
            "PROVIDER_ROLES",
            "PROVIDER_FALLBACKS",
            "BEDROCK_ACCESS_KEY_ID",
            "BEDROCK_SECRET_ACCESS_KEY",
            "BEDROCK_SESSION_TOKEN"
        ]) {
            assert.equal(WorkspaceTrust.classify(key, settings), "locked", key);
        }

        const { allowed, blocked } =
            WorkspaceTrust.filterProjectSettings(
                { AGENT_PROVIDER: "openrouter", PROVIDER_FALLBACKS: "[]", MAX_ITERATIONS: 10 },
                { trusted: true, settings }
            );

        assert.deepEqual(Object.keys(allowed), ["MAX_ITERATIONS"]);
        assert.deepEqual(blocked.map(item => item.key).sort(), ["AGENT_PROVIDER", "PROVIDER_FALLBACKS"]);
    });

    await test("provider sources read no environment variables and stay under 15KB", () => {

        const directory = path.join(REPO, "agent", "providers");

        const sources = fs.readdirSync(directory).filter(file => file.endsWith(".js"));

        assert.ok(sources.length >= 15);

        for (const file of sources) {

            const text = fs.readFileSync(path.join(directory, file), "utf8");

            assert.ok(!/process\.env/.test(text), `${file} reads process.env`);
            assert.ok(Buffer.byteLength(text) < 15 * 1024, `${file} is larger than 15KB`);
        }
    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        process.exitCode = 1;
    }
}


setTimeout(() => {
    console.log("  FAIL global timeout (60s) reached");
    process.exit(1);
}, 60000).unref();

main().then(
    () => setTimeout(() => process.exit(process.exitCode || 0), 200).unref(),
    error => {
        console.log(`  FAIL ${error && error.stack}`);
        process.exit(1);
    }
);
