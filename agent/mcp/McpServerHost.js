"use strict";

/*
|--------------------------------------------------------------------------
| structured-ai as an MCP server (roadmap P4-11)
|--------------------------------------------------------------------------
|
| Other MCP clients (Claude Desktop, Cursor, VS Code, another agent) can
| hand this runtime a task:
|
|   list_projects   the projects the caller's token may see
|   run_task        start a task in a project (queued behind a running
|                   one); wait_seconds > 0 waits for its answer
|   task_status     the project's current or last run: status, task,
|                   answer, error
|
| createHandler(adapter) answers JSON-RPC messages for one authenticated
| caller; the adapter is the console's (web/server/routes/mcp-serve.js),
| which checks every project against the caller's token (a project token
| reaches only its projects). Two transports carry it:
|
|   http   POST /mcp on the console (streamable HTTP, JSON answers)
|   stdio  agent mcp-serve — a bridge from stdin/stdout to a running
|          console's /mcp, so a desktop client starts it as a command
|--------------------------------------------------------------------------
*/

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = { name: "structured-ai", version: "1.0.0" };

const TOOLS = [
    {
        name: "list_projects",
        description: "List the structured-ai projects this token may use, with their ids, names and whether a run is in progress.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true }
    },
    {
        name: "run_task",
        description: "Run a task in a structured-ai project: the project's agent works on it in that project's workspace. Returns at once unless wait_seconds is given, in which case it waits (up to 600 seconds) for the final answer.",
        inputSchema: {
            type: "object",
            properties: {
                project: { type: "string", description: "Project id (or exact name) from list_projects." },
                task: { type: "string", description: "What the agent should do." },
                wait_seconds: { type: "integer", minimum: 0, maximum: 600, description: "Wait this long for the answer (0: return at once)." },
                plan_first: { type: "boolean", description: "Plan mode: the agent writes a plan and changes nothing." }
            },
            required: ["project", "task"],
            additionalProperties: false
        }
    },
    {
        name: "task_status",
        description: "The current or last run of a structured-ai project: status (idle, running, done, failed, stopped), the task, its final answer or error, and queued messages.",
        inputSchema: {
            type: "object",
            properties: {
                project: { type: "string", description: "Project id (or exact name) from list_projects." }
            },
            required: ["project"],
            additionalProperties: false
        },
        annotations: { readOnlyHint: true }
    }
];


function rpcError(id, code, message) {

    return { jsonrpc: "2.0", id, error: { code, message } };
}


function toolResult(value, isError = false) {

    return {
        content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
        structuredContent: value && typeof value === "object" ? value : undefined,
        ...(isError ? { isError: true } : {})
    };
}


/*
| adapter: {
|   listProjects()                       → [{id, name, running}]
|   resolveProject(idOrName)             → id (throws {status} when unknown / not allowed)
|   runTask(projectId, task, options)    → {accepted, queued, ...}
|   waitFor(projectId, ms)               → status once the run ends (or the wait does)
|   status(projectId)                    → {status, task, answer, error, ...}
| }
*/
function createHandler(adapter) {

    async function callTool(name, args = {}) {

        if (name === "list_projects") {
            return toolResult({ projects: await adapter.listProjects() });
        }

        if (name === "run_task") {

            const task = typeof args.task === "string" ? args.task.trim() : "";

            if (!task) return toolResult({ error: "task is required" }, true);

            const projectId = await adapter.resolveProject(args.project);
            const started = await adapter.runTask(projectId, task, { planFirst: args.plan_first === true });
            const wait = Math.min(Math.max(Number(args.wait_seconds) || 0, 0), 600);

            if (wait > 0 && started.accepted && !started.queued) {
                const finished = await adapter.waitFor(projectId, wait * 1000);
                return toolResult({ ...started, ...finished, waited: true });
            }

            return toolResult({ ...started, project_id: projectId, how_to_follow: "task_status {project}" });
        }

        if (name === "task_status") {
            const projectId = await adapter.resolveProject(args.project);
            return toolResult(await adapter.status(projectId));
        }

        throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
    }


    /* one JSON-RPC message → its answer (null for a notification) */
    return async function handle(message) {

        if (Array.isArray(message)) {
            const answers = (await Promise.all(message.map(item => handle(item)))).filter(Boolean);
            return answers.length ? answers : null;
        }

        if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
            return rpcError(message && message.id !== undefined ? message.id : null, -32600, "invalid JSON-RPC request");
        }

        const { id, method, params = {} } = message;
        const notification = id === undefined || id === null;

        if (notification) {
            return null;
        }

        try {

            switch (method) {

                case "initialize": {
                    const asked = params.protocolVersion;
                    return {
                        jsonrpc: "2.0",
                        id,
                        result: {
                            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                            capabilities: { tools: { listChanged: false } },
                            serverInfo: SERVER_INFO,
                            instructions: "structured-ai runs tasks in its projects. list_projects first, then run_task {project, task}; task_status follows a run."
                        }
                    };
                }

                case "ping":
                    return { jsonrpc: "2.0", id, result: {} };

                case "tools/list":
                    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

                case "tools/call": {
                    try {
                        return { jsonrpc: "2.0", id, result: await callTool(String(params.name || ""), params.arguments || {}) };
                    } catch (error) {
                        if (error.code === -32602) throw error;
                        /* a refused project or a busy one is the tool's answer, not a protocol fault */
                        return { jsonrpc: "2.0", id, result: toolResult({ error: error.message, status: error.status || 500 }, true) };
                    }
                }

                case "resources/list":
                    return { jsonrpc: "2.0", id, result: { resources: [] } };

                case "prompts/list":
                    return { jsonrpc: "2.0", id, result: { prompts: [] } };

                default:
                    return rpcError(id, -32601, `method not found: ${method}`);
            }

        } catch (error) {
            return rpcError(id, Number.isInteger(error.code) ? error.code : -32603, error.message || "internal error");
        }
    };
}


/*
| The stdio bridge: newline-delimited JSON-RPC on stdin/stdout, each
| message posted to a console's /mcp with the token. Used by
| `agent mcp-serve --url http://host:port` (token: --token or
| STRUCTURED_AI_TOKEN / AGENT_CONSOLE_TOKEN).
*/
function runStdioBridge({ url, token, input = process.stdin, output = process.stdout, log = text => process.stderr.write(`${text}\n`) }) {

    const endpoint = new URL(url);

    if (endpoint.pathname === "/" || endpoint.pathname === "") endpoint.pathname = "/mcp";

    let sessionId = null;
    let buffer = "";
    let chain = Promise.resolve();

    const write = message => output.write(`${JSON.stringify(message)}\n`);

    async function forward(message) {

        let response;

        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    authorization: `Bearer ${token}`,
                    ...(sessionId ? { "mcp-session-id": sessionId } : {})
                },
                body: JSON.stringify(message)
            });
        } catch (error) {
            if (message.id !== undefined) write(rpcError(message.id, -32603, `structured-ai console unreachable at ${endpoint.origin}: ${error.message}`));
            return;
        }

        sessionId = response.headers.get("mcp-session-id") || sessionId;

        if (response.status === 202 || message.id === undefined) return;

        const text = await response.text();

        if (!response.ok) {
            let reason = text.slice(0, 300);
            try { reason = JSON.parse(text).error || reason; } catch { /* plain text */ }
            write(rpcError(message.id, -32603, `structured-ai answered ${response.status}: ${reason}`));
            return;
        }

        try {
            write(JSON.parse(text));
        } catch {
            write(rpcError(message.id, -32603, "structured-ai answered with a body that is not JSON"));
        }
    }

    input.setEncoding && input.setEncoding("utf8");

    input.on("data", chunk => {

        buffer += chunk;

        let newline;

        while ((newline = buffer.indexOf("\n")) !== -1) {

            const line = buffer.slice(0, newline).trim();

            buffer = buffer.slice(newline + 1);

            if (!line) continue;

            let message;

            try {
                message = JSON.parse(line);
            } catch {
                write(rpcError(null, -32700, "parse error"));
                continue;
            }

            /* answers keep the order of the requests */
            chain = chain.then(() => forward(message)).catch(error => log(`mcp-serve: ${error.message}`));
        }
    });

    return new Promise(resolve => input.on("end", () => chain.then(resolve)));
}


module.exports = { PROTOCOL_VERSIONS, SERVER_INFO, TOOLS, createHandler, runStdioBridge };
