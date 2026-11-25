"use strict";

/*
| runtime.test.js: registry
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function registryCases(ctx) {

    const {
        runtime,
        test
    } = ctx;

    await test("the strict schema obeys the rules strict mode imposes", async () => {

        /*
        | A gateway that enforces the schema rejects anything that is
        | not strict-clean: every property required, additionalProperties
        | false, no optional keys. Worth checking here, because the only
        | other place it is checked is a provider that answers 500.
        */

        const strict =
            JSON.parse(
                require("fs").readFileSync(
                    require("path").join(
                        __dirname, "..", "..", "..", "agent", "schema",
                        "response_format.strict.json"
                    ),
                    "utf8"
                )
            );

        assert.equal(strict.json_schema.strict, true);

        const problems = [];

        const walk = (node, where) => {

            if (!node || typeof node !== "object") {
                return;
            }

            if (node.type === "object" && node.properties) {

                const required = node.required || [];

                for (const key of Object.keys(node.properties)) {

                    if (!required.includes(key)) {
                        problems.push(`${where}.${key} is optional`);
                    }
                }

                if (node.additionalProperties !== false) {
                    problems.push(`${where} allows extra properties`);
                }
            }

            for (const [key, value] of Object.entries(node)) {

                if (value && typeof value === "object") {
                    walk(value, `${where}.${key}`);
                }
            }
        };

        walk(strict.json_schema.schema, "schema");

        assert.deepEqual(problems, []);

        /* and the default schema stays permissive, on purpose */
        const relaxed =
            JSON.parse(
                require("fs").readFileSync(
                    require("path").join(
                        __dirname, "..", "..", "..", "agent", "schema",
                        "response_format.json"
                    ),
                    "utf8"
                )
            );

        assert.equal(relaxed.json_schema.strict, false);

        assert.equal(
            relaxed.json_schema.schema.required.includes("performed"),
            false,
            "performed must stay optional where the schema is not enforced"
        );
    });

    await test("the orchestrator prompt stays short without losing a rule", async () => {

        const prompt =
            runtime.systemPrompt();

        assert.ok(
            prompt.length < 7000,
            `the orchestrator prompt is ${prompt.length} chars; it was 9,582 and the rules moved, they did not grow`
        );

        /*
        | Everything below was in the long version and has to survive
        | the short one. A rule that is gone is a behaviour that is gone.
        */

        for (
            const rule
            of [
                "agents_remaining",
                "do not depend on each other",
                "independent check",
                "can_write_files",
                "cannot see your conversation",
                "may only receive tools you already have",
                "cannot delegate further",
                "depends_on",
                "NEEDS_INPUT",
                "Do not ask which part",
                "smallest appropriate change",
                "Never force push",
                "runtime context"
            ]
        ) {
            assert.ok(
                prompt.includes(rule),
                `the prompt lost: ${rule}`
            );
        }

        /* and the ad-hoc example still resolves against the registries */
        assert.match(prompt, /"tools": \["fs_read", "search_start", "search_get"\]/);
    });

    await test("a claim the runtime cannot support is reported", async () => {

        const events =
            require("../../../agent/events");

        const seen = [];

        const listen = event => seen.push(event);

        events.bus.on("report:mismatch", listen);

        try {

            /* nothing has been executed in this process by this point */
            const problems =
                runtime.checkPerformedClaim(
                    {
                        action: "final",

                        performed: {
                            tools: ["fs_write", "terminal_exec"],
                            agents: ["implementation"],
                            files_changed: ["src/a.ts"]
                        }
                    },
                    { delegations: 0 },
                    "main_agent"
                );

            assert.ok(problems.length >= 3);

            assert.match(
                problems.join(" "),
                /claimed fs_write, which the runtime never executed/
            );

            assert.match(problems.join(" "), /nothing was delegated/);
            assert.match(problems.join(" "), /no write ran/);

            assert.equal(seen.length, 1);
            assert.equal(seen[0].agent, "main_agent");

            /* an answer that claims nothing is never accused */
            assert.equal(
                runtime.checkPerformedClaim(
                    { action: "final" },
                    { delegations: 0 },
                    "main_agent"
                ),
                null
            );

        } finally {

            events.bus.off("report:mismatch", listen);
        }
    });

    await test("a rule section only reaches the agents it applies to", async () => {

        /*
        | git_analysis has no plan tools and was told, in 1,424
        | characters of every request, how to keep a plan.
        */

        const git =
            runtime.executionRules(
                runtime.resolveAgentProfile("git_analysis")
            );

        const implementation =
            runtime.executionRules(
                runtime.resolveAgentProfile("implementation")
            );

        assert.equal(git.includes("PLAN AND PROGRESS"), false);
        assert.equal(implementation.includes("PLAN AND PROGRESS"), true);

        /* the condition itself is never shown to the model */
        assert.equal(git.includes("[needs:"), false);
        assert.equal(implementation.includes("[needs:"), false);

        /* an agent whose tools are all allowed is not lectured on policy */
        assert.equal(git.includes("POLICY AND APPROVAL"), false);
        assert.equal(implementation.includes("POLICY AND APPROVAL"), true);

        /* the root, which holds every tool, still reads everything */
        const root = runtime.executionRules();

        for (
            const section
            of [
                "ACTION CONTRACT",
                "TOOL EXECUTION IS A GRAPH",
                "PLAN AND PROGRESS",
                "SKILLS",
                "MEMORY AND RECALL",
                "POLICY AND APPROVAL",
                "VERIFICATION"
            ]
        ) {
            assert.ok(root.includes(section), `${section} is missing`);
        }

        assert.ok(
            git.length < root.length,
            "filtering saved nothing"
        );
    });

    await test("filtering keeps whole sections, never half of one", async () => {

        const { filterExecutionRules } = runtime;

        const text = [
            "ALWAYS",
            "",
            "first rule",
            "",
            "",
            "SOMETIMES [needs: plan_get]",
            "",
            "second rule",
            "",
            "",
            "ALSO ALWAYS",
            "",
            "third rule"
        ].join("\n");

        const without =
            filterExecutionRules(text, ["fs_read"], false);

        assert.match(without, /first rule/);
        assert.match(without, /third rule/);
        assert.equal(without.includes("second rule"), false);
        assert.equal(without.includes("SOMETIMES"), false);

        /* the heading after a dropped section survives */
        assert.match(without, /ALSO ALWAYS/);

        const with_ =
            filterExecutionRules(text, ["plan_get"], false);

        assert.match(with_, /second rule/);
        assert.match(with_, /^SOMETIMES$/m);

        /* the special condition is the policy, not a tool */
        assert.equal(
            filterExecutionRules(
                "GATED [needs: approval]\n\nrule",
                ["fs_read"],
                true
            ).includes("rule"),
            true
        );

        assert.equal(
            filterExecutionRules(
                "GATED [needs: approval]\n\nrule",
                ["fs_read"],
                false
            ).includes("rule"),
            false
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nregistry");

    await test("the shipped registries validate", async () => {

        runtime.validateRegistries();
    });
};
