#!/usr/bin/env node
"use strict";

/*
|--------------------------------------------------------------------------
| Real-provider smoke test (roadmap P1-1, nightly)
|--------------------------------------------------------------------------
|
| One fixed scenario per provider whose credentials are present:
|
|   1. the model must call fs_read on notes.txt (native tool call)
|   2. the tool result says the secret word is PINEAPPLE
|   3. the final answer must contain PINEAPPLE
|
| Credentials come from the CI environment, one set per provider:
|
|   SMOKE_<NAME>_API_KEY, SMOKE_<NAME>_MODEL, SMOKE_<NAME>_BASE_URL (optional)
|   NAME = OPENAI, OPENAI_RESPONSES, ANTHROPIC, GEMINI, AZURE_OPENAI,
|          BEDROCK (+ SMOKE_BEDROCK_REGION), OLLAMA, OPENROUTER
|
| Exit 1 when fewer than SMOKE_MIN_PROVIDERS (default 4) pass. With no
| credentials at all the run is skipped (exit 0) unless SMOKE_REQUIRED=1.
| Never prints a key.
|--------------------------------------------------------------------------
*/

const path = require("path");

const providers = require(path.join(__dirname, "..", "agent", "providers"));
const actions = require(path.join(__dirname, "..", "agent", "actions"));


const candidates = [
    "openai",
    "openai-responses",
    "anthropic",
    "gemini",
    "azure-openai",
    "bedrock",
    "ollama",
    "openrouter"
];


function specFor(name) {

    const prefix = `SMOKE_${name.toUpperCase().replace(/-/g, "_")}_`;

    const apiKey = process.env[`${prefix}API_KEY`];
    const model = process.env[`${prefix}MODEL`];
    const baseUrl = process.env[`${prefix}BASE_URL`];

    if (!model || (!apiKey && name !== "ollama")) {
        return null;
    }

    return {
        provider: name,
        model,
        apiKey: apiKey || "",
        baseUrl: baseUrl || undefined,
        region: process.env[`${prefix}REGION`] || undefined,
        timeoutMs: 90000
    };
}


const tools = [{
    type: "function",
    function: {
        name: "fs_read",
        description: "Read a text file from the workspace.",
        parameters: {
            type: "object",
            properties: { path: { type: "string", description: "File path" } },
            required: ["path"]
        }
    }
}];


async function scenario(spec) {

    const router =
        new providers.ProviderRouter({
            config: { primary: { ...spec, origin: "primary" }, roles: {}, fallbacks: [], retry: { maxRetries: 2, baseMs: 1000 } }
        });

    const messages = [
        { role: "system", content: "You are a careful assistant. Use the fs_read tool to read files; never guess their content." },
        { role: "user", content: "Read notes.txt with the fs_read tool and then tell me the secret word it contains." }
    ];

    const first = await router.complete({ messages, tools, temperature: 0 });

    const parsed = actions.parseStructuredResponse(first);

    const call = parsed.structured.tool_calls && parsed.structured.tool_calls[0];

    if (!call || call.name !== "fs_read" || !String(call.arguments.path || "").includes("notes")) {
        throw new Error(`step 1: expected an fs_read call on notes.txt, got ${JSON.stringify(parsed.structured).slice(0, 300)}`);
    }

    const second =
        await router.complete({
            messages: [
                ...messages,
                first.choices[0].message,
                { role: "tool", tool_call_id: first.choices[0].message.tool_calls[0].id, content: "The secret word is PINEAPPLE." }
            ],
            tools,
            temperature: 0,
            stream: true
        }, { onDelta: () => {} });

    const text = String(second.choices[0].message.content || "");

    if (!/PINEAPPLE/i.test(text)) {
        throw new Error(`step 3: the answer does not contain the secret word: ${text.slice(0, 300)}`);
    }

    return { usage: second.usage };
}


async function main() {

    const minimum = Number(process.env.SMOKE_MIN_PROVIDERS || 4);

    const configured = candidates.map(name => [name, specFor(name)]).filter(([, spec]) => spec);

    if (configured.length === 0) {

        console.log("provider smoke: no provider credentials configured; skipped");

        process.exit(process.env.SMOKE_REQUIRED === "1" ? 1 : 0);
    }

    let passed = 0;

    for (const [name, spec] of configured) {

        const started = Date.now();

        try {

            await scenario(spec);

            passed++;

            console.log(`  ok   ${name} (${spec.model}) ${Date.now() - started} ms`);

        } catch (error) {

            console.log(`  FAIL ${name} (${spec.model}): ${error && error.message}`);
        }
    }

    console.log(`\n${passed}/${configured.length} providers passed (minimum ${minimum})`);

    process.exit(passed >= Math.min(minimum, configured.length) && passed >= minimum ? 0 : 1);
}


main().catch(error => {
    console.log(`  FAIL ${error && error.stack}`);
    process.exit(1);
});
