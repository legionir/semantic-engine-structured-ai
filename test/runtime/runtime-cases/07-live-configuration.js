"use strict";

/*
| runtime.test.js: live configuration, context digest
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function liveConfigurationCases(ctx) {

    const {
        buildConversation,
        runtime,
        settings,
        test
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nlive configuration");

    await test("editing a registry file takes effect without a restart", async () => {

        const fs = require("fs");
        const file =
            require("path").join(
                __dirname, "..", "..", "..", "agent", "registry", "policy.json"
            );

        const original =
            fs.readFileSync(file, "utf8");

        try {

            assert.equal(
                runtime.policyEngine.evaluate(
                    "fs_read", { path: "x" }, "a"
                ).decision,
                "allow"
            );

            const edited = JSON.parse(original);

            edited.rules.push({
                id: "probe",
                tools: ["fs_read"],
                action: "deny",
                reason: "probe"
            });

            fs.writeFileSync(file, JSON.stringify(edited, null, 2));

            runtime.loadRegistries(false);

            assert.equal(
                runtime.policyEngine.evaluate(
                    "fs_read", { path: "x" }, "a"
                ).decision,
                "deny",
                "the policy engine kept the old rules"
            );

        } finally {

            fs.writeFileSync(file, original);

            runtime.loadRegistries(false);
        }

        assert.equal(
            runtime.policyEngine.evaluate(
                "fs_read", { path: "x" }, "a"
            ).decision,
            "allow"
        );
    });

    await test("editing a prompt file takes effect without a restart", async () => {

        const fs = require("fs");
        const file =
            require("path").join(
                __dirname, "..", "..", "..", "agent", "config", "execution_rules.txt"
            );

        const original =
            fs.readFileSync(file, "utf8");

        try {

            fs.writeFileSync(file, `${original}\nPROBE MARKER\n`);

            assert.match(runtime.executionRules(), /PROBE MARKER/);

        } finally {

            fs.writeFileSync(file, original);
        }

        assert.equal(
            /PROBE MARKER/.test(runtime.executionRules()),
            false
        );
    });

    await test("no runtime value is left outside the store", async () => {

        const fs = require("fs");
        const path = require("path");

        const files = [];

        const walk = directory => {

            for (
                const entry
                of fs.readdirSync(directory, { withFileTypes: true })
            ) {

                const full = path.join(directory, entry.name);

                if (entry.isDirectory()) {

                    if (!["node_modules", ".git"].includes(entry.name)) {
                        walk(full);
                    }

                } else if (entry.name.endsWith(".js")) {

                    files.push(full);
                }
            }
        };

        for (const root of ["agent", "bin", "web"]) {
            walk(path.join(__dirname, "..", "..", "..", root));
        }

        const problems = [];

        for (const file of files) {

            const source = fs.readFileSync(file, "utf8");
            const name = path.relative(path.join(__dirname, "..", "..", ".."), file);

            /* a setting captured once at module load goes stale */
            for (
                const match
                of source.matchAll(
                    /^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\n?\s*settings\.get/gm
                )
            ) {
                problems.push(`${name}: ${match[1]} is captured at load`);
            }

            /* a bare numeric constant at module level is configuration in hiding */
            for (
                const match
                of source.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*[0-9][0-9_ */]*;/gm)
            ) {

                if (file.endsWith("storage.js")) {
                    continue;
                }

                problems.push(`${name}: ${match[1]} is a hard coded constant`);
            }
        }

        assert.deepEqual(problems, []);
    });

    /* ---------------------------------------------------------------- */
    console.log("\ncontext digest");

    await test("old exchanges are replaced by one summary", async () => {

        const { digestOldest } =
            require("../../../agent/context");

        const messages =
            buildConversation(12, 3000);

        const seen = {};

        const report =
            await digestOldest(messages, {
                keepRecentExchanges: 3,

                summarise: async transcript => {

                    seen.transcript = transcript;

                    return "Read twelve files; the loader lives in src/boot.ts.";
                }
            });

        assert.equal(report.failed, false);
        assert.equal(report.digested_exchanges, 9);
        assert.ok(report.after < report.before / 2);

        /* the summariser saw the real material */
        assert.match(seen.transcript, /called: fs_read/);

        const digest =
            messages.find(
                message =>
                    typeof message.content === "string" &&
                    message.content.includes("context_digest")
            );

        assert.ok(digest);
        assert.match(
            JSON.parse(digest.content).digest,
            /src\/boot\.ts/
        );

        /* the three newest exchanges are untouched */
        const remaining =
            messages.filter(
                message => message.role === "tool"
            );

        assert.equal(remaining.length, 3);
    });

    await test("a failing summariser falls back instead of breaking the run", async () => {

        const { digestOldest } =
            require("../../../agent/context");

        const messages =
            buildConversation(8, 3000);

        const before = messages.length;

        const report =
            await digestOldest(messages, {
                summarise: async () => {

                    throw new Error("endpoint down");
                }
            });

        assert.equal(report.failed, true);
        assert.match(report.reason, /endpoint down/);

        /* nothing was lost */
        assert.equal(messages.length, before);
    });

    await test("state from one run does not leak into the next", async () => {

        const tools = require("../../../agent/tools");

        await tools.executeTool(
            "search_start",
            { path: ".", query: "zzz", wait_ms: 200 },
            { agent: "probe" }
        );

        const statsBefore =
            await tools.executeTool("runtime_stats", {}, { agent: "probe" });

        assert.ok(statsBefore.total_calls > 0);

        runtime.startRun();

        const sessions =
            await tools.executeTool("search_list", {}, { agent: "probe" });

        assert.equal(
            sessions.count,
            0,
            "a search session survived into the next run"
        );

        const statsAfter =
            await tools.executeTool("runtime_stats", {}, { agent: "probe" });

        assert.ok(
            statsAfter.total_calls <= 2,
            `telemetry carried ${statsAfter.total_calls} calls into the new run`
        );
    });

    await test("the summariser uses its own model, ceiling and timeout", async () => {

        const http = require("http");

        const seen = [];

        const server =
            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => {
                    body += chunk;
                });

                req.on("end", () => {

                    seen.push(JSON.parse(body));

                    res.setHeader(
                        "content-type",
                        "application/json"
                    );

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        role: "assistant",
                                        content: "a digest"
                                    }
                                }
                            ]
                        })
                    );
                });
            });

        await new Promise(
            resolve => server.listen(0, "127.0.0.1", resolve)
        );

        const previousUrl =
            process.env.AGENT_BASE_URL;

        settings.set(
            "AGENT_BASE_URL",
            `http://127.0.0.1:${server.address().port}/v1`
        );

        settings.set("AGENT_MODEL", "main-model");

        try {

            /* by default the agent's own model does the work */

            await runtime.summariseTranscript("some history");

            assert.equal(seen[0].model, "main-model");
            assert.equal(seen[0].temperature, 0);
            assert.equal(seen[0].max_tokens, 700);
            assert.equal(seen[0].tools, undefined);
            assert.equal(seen[0].response_format, undefined);

            /* and a cheaper one can be pointed at it */

            settings.set("ENDPOINT_SUMMARY_MODEL", "small-model");
            settings.set("CONTEXT_SUMMARY_MAX_TOKENS", 300);

            await runtime.summariseTranscript("some history");

            assert.equal(seen[1].model, "small-model");
            assert.equal(seen[1].max_tokens, 300);

            /* the agent's own requests are unaffected */
            assert.equal(runtime.activeModel({}), "main-model");

        } finally {

            settings.reset("ENDPOINT_SUMMARY_MODEL");
            settings.reset("CONTEXT_SUMMARY_MAX_TOKENS");
            settings.reset("AGENT_MODEL");

            if (previousUrl === undefined) {
                settings.reset("AGENT_BASE_URL");
            } else {
                settings.set("AGENT_BASE_URL", previousUrl);
            }

            await new Promise(resolve => server.close(resolve));
        }
    });
};
