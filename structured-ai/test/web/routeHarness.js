"use strict";

/*
|--------------------------------------------------------------------------
| Web route harness — EXECUTION_PLAN Phase 23, step 1
|--------------------------------------------------------------------------
|
| One place that knows how to boot the console server and how to describe a
| response, so recording the contract and asserting it cannot drift apart.
|
| The contract is deliberately a *shape*: status, content-type, the key tree of
| the JSON body, and the type of each leaf. Values are not compared — ids,
| timestamps and durations differ run to run, and a test that fails on those is
| a test that gets edited until it passes. A renamed field, a dropped field, a
| status that changed from 200 to 204, or a JSON body that became text is
| exactly what this catches, and those are the failures a handler-by-handler
| move (step 2) is most likely to cause.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-routes-"));

/*
| The inventory registers and unregisters a project, because the per-project routes
| need an id the registry accepts. Without its own data home those writes land in
| `~/.local/share/structured-ai/registry.json` — a machine-level file — so a run
| that died mid-suite would leave `GET /api/projects` non-empty and every later
| contract check on that route would fail for a reason that has nothing to do with
| the code. Isolation, not cleanup, is the fix: two probes cannot share a registry.
*/

const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-routes-data-"));

process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;

fs.writeFileSync(path.join(WORKSPACE, "app.js"), "const value = 1;\n");

/*
| The runtime reads its environment when it is first required, so all of it is
| set before the require below — same order web.test.js uses.
*/

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_APPROVAL = "prompt";
process.env.AGENT_VERBOSE = "0";
process.env.MAX_RUN_MS = "20000";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";


function typeOf(value) {

    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}


/*
| A stable description of a JSON body: objects become sorted key→shape maps,
| arrays become the shape of their first element (plus length bucket, so
| "always empty" vs "has rows" is caught).
*/

function shape(value) {

    const kind = typeOf(value);

    if (kind === "object") {

        const out = {};

        for (const key of Object.keys(value).sort()) {
            out[key] = shape(value[key]);
        }

        return { object: out };
    }

    if (kind === "array") {

        return {
            array: value.length === 0 ? "empty" : shape(value[0])
        };
    }

    return kind;
}


/*
| Probes are run in order and may claim a slot (`save`) or consume one
| (`${project}`) — that is how the per-project routes are reached without the
| test having to invent ids the registry would reject.
*/

async function request(context, probe) {

    const url =
        context.baseUrl + expand(probe.path, context.saved);

    const headers = {};

    if (probe.auth !== false) {
        headers.authorization = `Bearer ${context.server.token}`;
    }

    const body =
        probe.body === undefined
            ? undefined
            : JSON.stringify(probe.body);

    if (body !== undefined) {
        headers["content-type"] = "application/json";
    }

    const controller = new AbortController();

    const deadline =
        setTimeout(() => controller.abort(), probe.timeoutMs ?? 6000);

    if (probe.stream) {

        /*
        | The SSE routes must be read far enough to see the headers and then
        | cancelled; awaiting the whole body would hang the suite forever.
        */
        const response =
            await fetch(url, { method: probe.method, headers, signal: controller.signal });

        /*
        | Collect until the first complete frame, not a fixed number of bytes:
        | a snapshot frame is long, and comparing whatever happened to fall in
        | the first 120 characters would compare a timestamp and a sequence
        | number — a test like that fails on the previous probe, not on the
        | code under test.
        */
        let buffer = "";

        try {

            const reader = response.body.getReader();

            for (let i = 0; i < 8 && !buffer.includes("\n\n"); i += 1) {

                const next = await Promise.race([
                    reader.read(),
                    new Promise(resolve => setTimeout(() => resolve({ done: true }), 600))
                ]);

                if (next.done) break;

                buffer += new TextDecoder().decode(next.value);
            }

        } catch {
            /* an aborted stream is the expected outcome */
        }

        clearTimeout(deadline);
        controller.abort();

        return {
            status: response.status,
            contentType: (response.headers.get("content-type") || "").split(";")[0],
            streamFrame: firstFrame(buffer),
            body: null
        };
    }

    /*
    | A route that escalates to approval waits for the console — that is the
    | contract, not a hang. Probes that expect one answer it through the same
    | endpoint the browser uses, which also proves the approval round-trip
    | still works after a handler moves.
    */
    let answered = null;

    if (probe.approval) {

        answered = new Promise(resolve => {

            const bus = context.runtime.events.bus;

            const listener = event => {

                if (event.type !== "approval:request") return;

                bus.off("event", listener);

                resolve(fetch(`${context.baseUrl}/api/approvals/${event.id}`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${context.server.token}`
                    },
                    body: JSON.stringify({ approved: probe.approval === "allow" })
                }).catch(() => null));
            };

            context.runtime.events.bus.on("event", listener);
        });
    }

    let response;

    try {

        response =
            await fetch(url, { method: probe.method, headers, body, signal: controller.signal });

    } finally {

        clearTimeout(deadline);
    }

    const contentType =
        (response.headers.get("content-type") || "").split(";")[0];

    const text = await response.text();

    let parsed = null;

    if (contentType.includes("json") && text !== "") {
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = { __unparseable_json__: true };
        }
    }

    if (answered) {
        await answered;
    }

    const record = {
        status: response.status,
        contentType,
        body: parsed === null ? (text.length ? "text" : "empty") : shape(parsed)
    };

    if (probe.save && parsed) {
        context.saved[probe.save] =
            probe.savePath
                ? evalPath(parsed, probe.savePath)
                : parsed[probe.save];
    }

    return record;
}


/*
| The first SSE frame as a shape: the field names and value types, with the
| leading `event:`/`retry:` lines kept as names only. `type` is preserved
| because "which frame opens a stream" is exactly the thing a handler move can
| break, and it is not volatile.
*/

function firstFrame(buffer) {

    const chunk =
        buffer.split("\n\n")[0] || "";

    const lines =
        chunk.split("\n").filter(Boolean);

    const fields =
        lines.map(line => line.slice(0, line.indexOf(":") === -1 ? line.length : line.indexOf(":")));

    const dataLine =
        lines.find(line => line.startsWith("data:"));

    if (!dataLine) {
        return { fields };
    }

    try {
        return { fields, data: shape(JSON.parse(dataLine.slice(5).trim())) };
    } catch {
        return { fields, data: "unparseable" };
    }
}


function evalPath(value, dotted) {

    return dotted.split(".").reduce((current, key) => {
        return current === null || current === undefined ? undefined : current[key];
    }, value);
}


function expand(template, saved) {

    return template.replace(/\$\{(\w+)\}/g, (_m, key) => {

        const value = saved[key];

        if (value === undefined || value === null) {
            throw new Error(`route probe used \${${key}} before it was saved`);
        }

        return encodeURIComponent(value);
    });
}


async function boot() {

    const runtime = require(path.join(REPO_ROOT, "agent", "agent.js"));

    const { createServer } = require(path.join(REPO_ROOT, "web", "server.js"));

    const server = createServer(runtime, {});

    const address = await server.listen(0, "127.0.0.1");

    return {
        runtime,
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        saved: {},
        workspace: WORKSPACE
    };
}


async function shutdown(context) {

    /*
    | The server's own close() ends the open event streams and shuts the MCP
    | children down. Closing the raw http.Server instead waits forever, because
    | an SSE response never ends on its own — a harness that hangs at teardown
    | teaches nothing about the routes it was probing.
    */
    if (context.server && typeof context.server.close === "function") {

        await Promise.race([
            Promise.resolve(context.server.close()),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]);
    }

    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });
}


module.exports = { boot, shutdown, request, shape, REPO_ROOT };
