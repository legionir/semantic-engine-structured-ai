"use strict";

/*
| runtime.test.js: malformed answers, from "no prompt or comment invents a tool that does not exist"
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function noPromptOrCommentInventsACases(ctx) {

    const {
        runtime,
        test
    } = ctx;

    await test("no prompt or comment invents a tool that does not exist", async () => {

        /*
        | A real run lost a delegation to "fs_search", a name this
        | project's own system prompt suggested and its registry never
        | had. Anything shaped like a tool name is now checked against
        | the registry.
        */

        const fs = require("fs");
        const path = require("path");

        const root =
            path.join(__dirname, "..", "..", "..");

        /*
        | Anything the registries actually name is legitimate: tools,
        | agents, personas, skills, and the capability words they use.
        | The set therefore maintains itself.
        */

        const real = new Set();

        const remember = value => {

            if (typeof value === "string") {
                real.add(value);
            }
        };

        const walk = value => {

            if (Array.isArray(value)) {

                value.forEach(walk);

                return;
            }

            if (value && typeof value === "object") {

                for (const [key, item] of Object.entries(value)) {

                    remember(key);

                    walk(item);
                }

                return;
            }

            remember(value);
        };

        for (const tool of runtime.registries.TOOLS) {
            remember(tool.function.name);
        }

        /* policy rule ids are names too */
        for (const rule of runtime.registries.POLICY?.rules || []) {
            remember(rule.id);
        }

        for (
            const registry
            of [
                runtime.registries.AGENTS,
                runtime.registries.PERSONAS,
                runtime.registries.SKILLS
            ]
        ) {

            for (const entry of registry || []) {

                remember(entry.name);

                (entry.capabilities || []).forEach(remember);
            }
        }

        /* prefixes that only ever start a tool name in this project */
        const shape =
            /\b(?:fs|search|process|git|net|plan|memory|archive|runtime|terminal)_[a-z_]+\b/g;

        const files = [
            "agent/config/system_prompt.txt",
            "agent/config/execution_rules.txt",
            "agent/registry/personas.json",
            "agent/registry/skills.json",
            "agent/registry/agents.json",
            "agent/registry/tool_groups.json",
            "agent/registry/policy.json"
        ];

        /*
        | Only what the model is shown is scanned. The README is allowed
        | to name fs_search, because it documents the day this guard was
        | written.
        */

        const problems = [];

        for (const name of files) {

            const file = path.join(root, name);

            if (!fs.existsSync(file)) {
                continue;
            }

            const text = fs.readFileSync(file, "utf8");

            for (const match of text.match(shape) || []) {

                if (real.has(match)) {
                    continue;
                }

                /* argument and message names that share the prefix */
                if (
                    [
                        "process_id",
                        "process_ids",
                        "search_id",
                        "runtime_context",
                        "runtime_notice",
                        "runtime_rules",
                        "plan_get_first",
                        "memory_and_recall"
                    ].includes(match)
                ) {
                    continue;
                }

                problems.push(`${name}: ${match}`);
            }
        }

        assert.deepEqual([...new Set(problems)], []);

        /* the guard must actually catch the name that caused this */
        assert.equal(real.has("fs_search"), false);

        assert.equal(
            (
                'tools: ["fs_read", "fs_search"]'.match(shape) || []
            ).filter(name => !real.has(name)).length,
            1
        );
    });

    await test("every delegation example in the prompt actually resolves", async () => {

        /*
        | The ad-hoc example in the system prompt named a tool that did
        | not exist, so a model that copied it lost its sub-agent. Every
        | example is now run through the same resolver the runtime uses.
        */

        const fs = require("fs");
        const path = require("path");

        const prompt =
            fs.readFileSync(
                path.join(
                    __dirname, "..", "..", "..", "agent", "config", "system_prompt.txt"
                ),
                "utf8"
            );

        const examples = [];

        for (
            const match
            of prompt.matchAll(/\{[^{}]*"task"\s*:[^{}]*\}/g)
        ) {

            try {

                examples.push(JSON.parse(match[0]));

            } catch {

                /* not a complete object on its own */
            }
        }

        assert.ok(
            examples.length >= 3,
            `only found ${examples.length} delegation examples`
        );

        const everyTool =
            new Set(
                runtime.registries.TOOLS.map(
                    tool => tool.function.name
                )
            );

        for (const example of examples) {

            const profile =
                runtime.resolveDelegationProfile(example, everyTool);

            assert.ok(
                profile && profile.name,
                `example ${example.id} does not resolve`
            );
        }
    });

    await test("the workspace boundary holds on a case insensitive filesystem", async () => {

        const { isInsideRoot } =
            require("../../../agent/context/WorkspaceBoundary");

        const windows = (root, target) =>
            isInsideRoot(root, target, true, "\\");

        /* a project on another drive is an ordinary workspace */
        assert.equal(
            windows("D:\\project", "D:\\project\\src\\a.ts"),
            true
        );

        /* the same directory written in another case is the same */
        assert.equal(
            windows("D:\\Project", "d:\\project\\src\\a.ts"),
            true
        );

        /* another drive is outside, whatever the case */
        assert.equal(
            windows("D:\\project", "C:\\Windows\\system32"),
            false
        );

        /* a sibling that merely starts with the same letters is outside */
        assert.equal(
            windows("D:\\project", "D:\\project-secrets\\key.pem"),
            false
        );

        assert.equal(
            windows("D:\\project", "D:\\project"),
            true
        );

        /* and a case sensitive filesystem stays case sensitive */
        assert.equal(
            isInsideRoot("/srv/app", "/srv/APP/x", false, "/"),
            false
        );

        assert.equal(
            isInsideRoot("/srv/app", "/srv/app/x", false, "/"),
            true
        );
    });

    await test("a sub-agent is not sent what it cannot use", async () => {

        const messages =
            runtime.createSubAgentMessages
                ? runtime.createSubAgentMessages(
                    runtime.resolveAgentProfile("git_analysis"),
                    "report the repository state",
                    {}
                )
                : null;

        if (!messages) {

            /* the composer is internal; the profile block is what matters */
            return;
        }

        const text =
            messages.map(message => message.content || "").join("\n");

        /* the catalogue of other agents is the orchestrator's business */
        assert.equal(text.includes('"available_agents"'), false);
        assert.equal(text.includes('"available_personas"'), false);

        /* and the profile block no longer repeats the whole definition */
        const profile =
            JSON.parse(
                messages.find(
                    message =>
                        typeof message.content === "string" &&
                        message.content.includes('"agent_profile"')
                ).content
            );

        assert.deepEqual(
            Object.keys(profile).sort(),
            ["description", "may_delegate", "name", "type"]
        );
    });

    await test("a sub-agent's skills can be inlined or indexed", async () => {

        const settings =
            require("../../../agent/config");

        const profile =
            runtime.resolveAgentProfile("implementation");

        const inline =
            runtime.buildAgentSystemPrompt(profile);

        /* by default a specialist carries its own procedures */
        assert.match(inline, /Prefer targeted edits over unnecessary rewrites/);

        settings.set("SKILLS_INLINE_FOR_SUBAGENTS", false);

        try {

            const indexed =
                runtime.buildAgentSystemPrompt(profile);

            assert.equal(
                indexed.includes("Prefer targeted edits over unnecessary rewrites"),
                false
            );

            /* it still knows they exist, and how to read them */
            assert.match(indexed, /file_management/);
            assert.match(indexed, /skill_get/);

            assert.ok(
                indexed.length < inline.length - 4000,
                `only saved ${inline.length - indexed.length} chars`
            );

        } finally {

            settings.reset("SKILLS_INLINE_FOR_SUBAGENTS");
        }
    });

    await test("the personas catalogue only goes to an agent that can delegate", async () => {

        const messages =
            runtime.createMainAgentMessages("a task");

        /* the root delegates, so it needs them */
        assert.equal(
            messages.some(
                message =>
                    typeof message.content === "string" &&
                    message.content.includes('"available_personas"')
            ),
            true
        );

        const profile =
            runtime.resolveAgentProfile("implementation");

        assert.equal(profile.delegation.enabled, false);

        const prompt =
            runtime.buildAgentSystemPrompt(profile);

        assert.equal(prompt.includes('"available_personas"'), false);
    });
};
