"use strict";

/*
| p11.test.js: P1-1 provider abstraction, from "bedrock: missing credentials fail closed without a request"
|
| Runs inside p11.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function bedrockMissingCredentialsFailClosedWithoutCases(ctx) {

    const {
        ENVELOPE,
        FIXTURES,
        REPO,
        WORKSPACE,
        WorkspaceTrust,
        crc32,
        decodeEventStream,
        failure,
        headerOf,
        ok,
        providers,
        readSse,
        rejection,
        request,
        sanitizeSchema,
        serialize,
        settings,
        signRequest,
        substitute,
        test,
        transport
    } = ctx;

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
};
