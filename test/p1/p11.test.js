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
    "AGENT_PROXY_URL",
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

    /* the cases live in ./p11-cases, run in this order */
    const ctx = {
        ENVELOPE,
        FIXTURES,
        REPO,
        ResponseRepair,
        TOOL_ENVELOPE,
        WORKSPACE,
        WorkspaceTrust,
        actions,
        crc32,
        decodeEventStream,
        envelopeOf,
        failure,
        headerOf,
        ok,
        prose,
        providers,
        readSse,
        rejection,
        request,
        resetProviderSettings,
        routerFor,
        sanitizeSchema,
        serialize,
        settings,
        signRequest,
        streamed,
        substitute,
        test,
        transport
    };

    await require("./p11-cases/01-p1-1-provider-abstraction")(ctx);
    await require("./p11-cases/02-bedrock-missing-credentials-fail-closed-without")(ctx);


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
