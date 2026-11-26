#!/usr/bin/env node
"use strict";

/*
| A mock MCP server over stdio (newline-delimited JSON-RPC) for the
| roadmap group 6 tests. It offers every capability the client handles:
|
|   tools       echo (readOnlyHint), write_note (a writing tool),
|               slow_count (sends notifications/progress first),
|               ask_user (elicitation/create back to the client),
|               summarize (sampling/createMessage back to the client)
|   resources   note://welcome, plus a template note://{id}
|   prompts     review_code {language}
|
| MOCK_TOOL_COUNT=<n> adds n filler tools with long descriptions, for the
| lazy-loading budget test.
*/

const readline = require("readline");

let nextId = 1;
const waiting = new Map();
const fillers = Number(process.env.MOCK_TOOL_COUNT || 0);

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ask(method, params) {
    const id = `srv-${nextId++}`;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

const TOOLS = [
    { name: "echo", description: "Echo the text back.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } },
    { name: "write_note", description: "Write a note somewhere.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
    { name: "slow_count", description: "Count to three, reporting progress.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "ask_user", description: "Ask the user for their name.", inputSchema: { type: "object", properties: {} } },
    { name: "summarize", description: "Summarize text with the client's model.", inputSchema: { type: "object", properties: { text: { type: "string" } } } }
];

for (let index = 0; index < fillers; index++) {
    TOOLS.push({
        name: `filler_${index}`,
        description: `Filler tool number ${index}. ${"It exists to make the catalogue large. ".repeat(6)}`,
        inputSchema: { type: "object", properties: { a: { type: "string", description: "x".repeat(80) }, b: { type: "number" } } }
    });
}

async function callTool(name, args, meta) {

    if (name === "echo") return { content: [{ type: "text", text: String(args.text) }] };
    if (name === "write_note") return { content: [{ type: "text", text: `wrote ${args.text}` }] };

    if (name === "slow_count") {
        for (let step = 1; step <= 3; step++) {
            send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: meta && meta.progressToken, progress: step, total: 3, message: `step ${step}` } });
        }
        return { content: [{ type: "text", text: "counted" }] };
    }

    if (name === "ask_user") {
        const answer = await ask("elicitation/create", {
            message: "What is your name?",
            requestedSchema: { type: "object", properties: { name: { type: "string", title: "Name" } }, required: ["name"] }
        });
        return { content: [{ type: "text", text: answer.action === "accept" ? `hello ${answer.content.name}` : `no answer (${answer.action})` }] };
    }

    if (name === "summarize") {
        try {
            const answer = await ask("sampling/createMessage", {
                messages: [{ role: "user", content: { type: "text", text: `Summarize: ${args.text}` } }],
                maxTokens: 50000
            });
            return { content: [{ type: "text", text: `summary: ${answer.content.text}` }] };
        } catch (error) {
            return { content: [{ type: "text", text: `sampling refused: ${error.message}` }], isError: true };
        }
    }

    if (name.startsWith("filler_")) return { content: [{ type: "text", text: name }] };

    throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
}

async function handle(message) {

    const { method, params = {} } = message;

    switch (method) {
        case "initialize":
            process.env.MOCK_CLIENT_CAPABILITIES = JSON.stringify(params.capabilities || {});
            return { protocolVersion: params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "mock", version: "1.0.0" } };
        case "ping":
            return {};
        case "tools/list":
            return { tools: TOOLS };
        case "tools/call":
            if (params.name === "client_capabilities") return { content: [{ type: "text", text: process.env.MOCK_CLIENT_CAPABILITIES || "{}" }] };
            return callTool(params.name, params.arguments || {}, params._meta);
        case "resources/list":
            return { resources: [{ uri: "note://welcome", name: "welcome", mimeType: "text/plain" }] };
        case "resources/templates/list":
            return { resourceTemplates: [{ uriTemplate: "note://{id}", name: "note" }] };
        case "resources/read":
            return { contents: [{ uri: params.uri, mimeType: "text/plain", text: `contents of ${params.uri}` }] };
        case "prompts/list":
            return { prompts: [{ name: "review_code", description: "Review code", arguments: [{ name: "language", required: true }] }] };
        case "prompts/get":
            return { description: "Review code", messages: [{ role: "user", content: { type: "text", text: `Review this ${params.arguments.language} code carefully.` } }] };
        default:
            throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
    }
}

TOOLS.push({ name: "client_capabilities", description: "What the client advertised.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } });

readline.createInterface({ input: process.stdin }).on("line", line => {

    let message;

    try { message = JSON.parse(line); } catch { return; }

    if (message.id !== undefined && !message.method) {
        const pending = waiting.get(message.id);
        if (pending) {
            waiting.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
        }
        return;
    }

    if (message.id === undefined || message.id === null) return;

    Promise.resolve(handle(message)).then(
        result => send({ jsonrpc: "2.0", id: message.id, result }),
        error => send({ jsonrpc: "2.0", id: message.id, error: { code: Number.isInteger(error.code) ? error.code : -32603, message: error.message } })
    );
});
