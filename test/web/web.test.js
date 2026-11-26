const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const ProcessOutputBus = require("../../agent/tools/process/ProcessOutputBus");

/*
| The console is tested through its own HTTP surface: the event stream,
| the task endpoint, and the approval endpoint that the buttons call.
*/

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-web-")
    );

fs.writeFileSync(
    path.join(WORKSPACE, "app.js"),
    "const value = 1;\n"
);

/*
| The console records what the run did to the repository, so the fixture has
| to be one: outside a repo the report says "not a git repository" and never
| describes a file, and the conversation test asserts on a report it cannot
| match. Identity travels per command, so no machine's global git config is a
| dependency of this suite.
*/
(function seedRepository(dir) {

    const { spawnSync } = require("child_process");

    if (spawnSync("git", ["--version"], { cwd: dir }).status !== 0) {
        return;
    }

    const identity =
        ["-c", "user.email=fixture@invalid", "-c", "user.name=fixture"];

    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", [...identity, "add", "-A"], { cwd: dir });
    spawnSync("git", [...identity, "commit", "-qm", "fixture"], { cwd: dir });
})(WORKSPACE);

const results = [];


function startModelStub(handler) {

    return new Promise(resolve => {

        const state = { requests: [] };

        const server =
            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => {
                    body += chunk;
                });

                req.on("end", () => {

                    const parsed = JSON.parse(body);

                    state.requests.push(parsed);

                    res.setHeader(
                        "content-type",
                        "application/json"
                    );

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message:
                                        handler(
                                            parsed,
                                            state.requests.length
                                        )
                                }
                            ]
                        })
                    );
                });
            });

        server.listen(0, "127.0.0.1", () =>
            resolve({
                state,
                port: server.address().port,
                close: () =>
                    new Promise(done => server.close(done))
            })
        );
    });
}


const action = value => ({
    role: "assistant",

    content:
        JSON.stringify({
            version: "1.0",
            tool_calls: null,
            delegations: null,
            response: null,
            data: null,
            error: null,
            ...value
        })
});


const finalAction = text =>
    action({
        action: "final",

        response: {
            type: "text",
            content: text
        }
    });


/*
| The runtime reads its configuration when it is loaded, so the
| environment has to be complete before the first require.
*/

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_APPROVAL = "prompt";
process.env.AGENT_VERBOSE = "0";
process.env.MAX_RUN_MS = "20000";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";

let runtime;
let consoleServer;
let baseUrl;


async function request(method, url, body) {

    const response =
        await fetch(`${baseUrl}${url}`, {
            method,

            headers: {
                ...(body ? { "content-type": "application/json" } : {}),
                authorization: `Bearer ${consoleServer.token}`
            },

            body:
                body
                    ? JSON.stringify(body)
                    : undefined
        });

    const text =
        await response.text();

    return {
        status: response.status,

        body:
            text
                ? JSON.parse(text)
                : null
    };
}


function collectEvents() {

    const seen = [];

    const controller =
        new AbortController();

    const ready =
        fetch(`${baseUrl}/api/events`, {
            signal: controller.signal,
            headers: {
                authorization: `Bearer ${consoleServer.token}`
            }
        }).then(async response => {

            const reader =
                response.body.getReader();

            const decoder =
                new TextDecoder();

            let buffer = "";

            for (;;) {

                const { value, done } =
                    await reader.read();

                if (done) {
                    return;
                }

                buffer += decoder.decode(value, { stream: true });

                const chunks =
                    buffer.split("\n\n");

                buffer = chunks.pop();

                for (const chunk of chunks) {

                    if (!chunk.startsWith("data: ")) {
                        continue;
                    }

                    seen.push(
                        JSON.parse(chunk.slice(6))
                    );
                }
            }
        }).catch(() => {});

    return {
        seen,

        ready,

        stop: () => controller.abort()
    };
}


/*
| A run keeps streaming after the assertion that started it, and every test
| here shares one server. Two runs overlapping on one stream is what made this
| suite fail a random tail of itself: a green run one minute, six unrelated
| failures the next. The deadline is therefore tunable, and every test drains
| its own run before the next one starts.
*/
const WAIT_MS =
    Number(process.env.WEB_TEST_TIMEOUT_MS) || 15000;

const BUSY =
    new Set(["running", "queued", "starting", "cancelling"]);


async function waitFor(predicate, timeoutMs = WAIT_MS) {

    const deadline =
        Date.now() + timeoutMs;

    for (;;) {

        const value =
            await predicate();

        if (value) {
            return value;
        }

        if (Date.now() > deadline) {

            throw new Error(`timed out after ${timeoutMs}ms waiting for a condition`);
        }

        await new Promise(
            resolve => setTimeout(resolve, 50)
        );
    }
}


/*
| Waits for the run this test started to leave the server busy. A test that
| deliberately leaves a run blocked (an approval nobody answers) must not be
| failed for it, so this cancels after its own budget and reports, never
| throws: the assertions inside the test are still the only verdict.
*/
async function settleRun() {

    const patient =
        Date.now() + WAIT_MS;

    for (;;) {

        const current =
            await request("GET", "/api/state").catch(() => null);

        if (!current || !BUSY.has(current.body.status)) {
            return "settled";
        }

        if (Date.now() > patient) {

            await request("POST", "/api/cancel", {}).catch(() => {});

            try {
                await waitFor(
                    async () => {
                        const state = await request("GET", "/api/state");
                        return !BUSY.has(state.body.status) ? true : null;
                    },
                    5000
                );
            } catch {
                /* the run is still live; say so, do not hide it */
                return "stuck";
            }

            return "cancelled";
        }

        await new Promise(
            resolve => setTimeout(resolve, 25)
        );
    }
}


const TERMINAL =
    new Set(["done", "failed", "cancelled"]);


/*
| The run's events are all streamed before its terminal run:status, because
| the stream is ordered. Waiting for the first run:status — the one that
| OPENS a run — therefore asserts on events that may not have arrived yet,
| which is exactly how this suite managed to fail a different test each run.
|
| The terminal run:status is correlated to the run that started in THIS test by
| its turn_id. A run finishing on the shared server leaks one last run:status
| into the next test's stream (its finally drains after /api/state already
| reads done); keying on turn_id means that leaked status — from a different
| run — never ends the wait early.
*/
async function waitForRunEnd(stream, timeoutMs = WAIT_MS) {

    return waitFor(
        () => {
            const started =
                stream.seen.filter(event => event.type === "run:start");

            if (started.length === 0) {
                return null;
            }

            const current = started[started.length - 1].turn_id;

            return stream.seen.some(
                event =>
                    event.type === "run:status" &&
                    TERMINAL.has(event.status) &&
                    event.turn_id === current
            );
        },
        timeoutMs
    );
}


async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }

    /* whatever just happened, the next test starts with an idle server */
    const drained =
        await settleRun();

    if (drained !== "settled") {
        console.log(`       (run ${drained} before the next test)`);
    }
}


async function main() {

    console.log("web console");

    runtime =
        require(path.join(REPO_ROOT, "agent", "agent.js"));

    const { createServer } =
        require(path.join(REPO_ROOT, "web", "server.js"));

    consoleServer =
        createServer(runtime, { apiRateLimit: 1000 });

    const address =
        await consoleServer.listen(0, "127.0.0.1");

    baseUrl =
        `http://127.0.0.1:${address.port}`;

    /* the cases live in ./web-cases, run in this order */
    const ctx = {
        ProcessOutputBus,
        REPO_ROOT,
        WORKSPACE,
        action,
        baseUrl,
        collectEvents,
        consoleServer,
        createServer,
        finalAction,
        request,
        runtime,
        startModelStub,
        test,
        waitFor,
        waitForRunEnd
    };

    await require("./web-cases/01-the-console-serves-its-own-page")(ctx);
    await require("./web-cases/02-a-loop-is-reported-as-an")(ctx);
    await require("./web-cases/03-a-second-task-is-refused-while")(ctx);
    await require("./web-cases/04-reasoning-reaches-a-live-console-not")(ctx);
    await require("./web-cases/05-discussion")(ctx);


    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
