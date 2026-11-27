"use strict";

/*
| runtime.test.js: registries and schema
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function registriesAndSchemaCases(ctx) {

    const {
        arrayWithoutItems,
        runtime,
        strictViolations,
        test,
        throws
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nregistries and schema");

    const registries = {
        tools: require("../../../agent/registry/tools.json"),
        groups: require("../../../agent/registry/tool_groups.json"),
        skills: require("../../../agent/registry/skills.json"),
        agents: require("../../../agent/registry/agents.json"),
        personas: require("../../../agent/registry/personas.json"),
        policy: require("../../../agent/registry/policy.json")
    };

    await test("every tool belongs to a group and to at least one skill", async () => {

        const names =
            registries.tools.map(tool => tool.function.name);

        const grouped =
            Object.values(registries.groups)
                .flatMap(group => group.tools);

        const inSkills =
            new Set(
                registries.skills.flatMap(skill => skill.tools)
            );

        assert.deepEqual(
            names.filter(name => !grouped.includes(name)),
            []
        );

        /*
        | skill_get and skill_read are how a skill is read, so requiring
        | them to belong to one would be circular.
        */

        assert.deepEqual(
            names.filter(
                name =>
                    !["skill_get", "skill_read"].includes(name) &&
                    !inSkills.has(name)
            ),
            []
        );
    });

    await test("every tool and parameter is documented", async () => {

        for (const tool of registries.tools) {

            const definition = tool.function;

            assert.ok(
                definition.description.length >= 40,
                `${definition.name} has a thin description`
            );

            for (
                const [name, parameter]
                of Object.entries(definition.parameters.properties)
            ) {

                assert.ok(
                    parameter.description,
                    `${definition.name}.${name} has no description`
                );
            }

            for (const required of definition.parameters.required) {

                assert.ok(
                    definition.parameters.properties[required],
                    `${definition.name} requires an undeclared parameter`
                );
            }
        }
    });

    await test("every agent has a persona and every persona is used", async () => {

        const personas =
            new Set(registries.personas.map(persona => persona.name));

        const used = new Set();

        for (const agent of registries.agents) {

            assert.ok(
                agent.persona,
                `${agent.name} has no persona`
            );

            assert.ok(
                personas.has(agent.persona),
                `${agent.name} references an unknown persona`
            );

            assert.ok(
                Array.isArray(agent.output_contract) &&
                agent.output_contract.length > 0,
                `${agent.name} has no output contract`
            );

            used.add(agent.persona);
        }

        assert.deepEqual(
            [...personas].filter(name => !used.has(name)),
            []
        );
    });

    await test("at least one profile can actually change the workspace", async () => {

        const writers =
            registries.agents.filter(
                agent =>
                    agent.tools !== "*" &&
                    agent.tools.includes("fs_write")
            );

        assert.ok(
            writers.length > 0,
            "no sub-agent can write, so the orchestrator can never delegate an edit"
        );
    });

    await test("the default schema is a valid json schema", async () => {

        const schema =
            require("../../../agent/schema/response_format.json");

        assert.equal(schema.type, "json_schema");
        assert.equal(schema.json_schema.strict, false);

        assert.deepEqual(
            arrayWithoutItems(schema.json_schema.schema),
            [],
            "an array without items is not a valid schema"
        );

        assert.equal(
            schema.json_schema.schema.properties
                .tool_calls.anyOf[0].minItems,
            1,
            "tool_call must not advertise an empty active array"
        );

        assert.equal(
            schema.json_schema.schema.properties
                .delegations.anyOf[0].minItems,
            1,
            "delegate must not advertise an empty active array"
        );

        assert.match(
            schema.json_schema.schema.description,
            /one and only one active field/
        );

        const actionBranches =
            schema.json_schema.schema.allOf[0].anyOf;

        assert.deepEqual(
            actionBranches.map(
                branch => branch.properties.action.const
            ),
            ["tool_call", "delegate", "final"],
            "the relaxed schema must encode the action/field relationship, not only describe it"
        );

        assert.equal(
            actionBranches[0].properties.delegations.type,
            "null"
        );
        assert.equal(
            actionBranches[1].properties.tool_calls.type,
            "null"
        );
        assert.equal(
            actionBranches[2].properties.response.type,
            "object"
        );
    });

    await test("the strict schema satisfies strict mode", async () => {

        const schema =
            require("../../../agent/schema/response_format.strict.json");

        assert.equal(schema.json_schema.strict, true);

        const problems =
            strictViolations(schema.json_schema.schema);

        assert.deepEqual(problems, []);

        /* strict mode cannot express a free form object */
        const argumentsSchema =
            schema.json_schema.schema.properties
                .tool_calls.anyOf[0].items.properties.arguments;

        assert.equal(argumentsSchema.type, "string");
    });

    await test("string encoded arguments are accepted by the runtime", async () => {

        assert.deepEqual(
            runtime.parseArguments("{\"path\":\".\"}", "fs_list"),
            { path: "." }
        );

        assert.deepEqual(
            runtime.parseArguments({ path: "." }, "fs_list"),
            { path: "." }
        );

        assert.deepEqual(
            runtime.parseArguments("", "fs_list"),
            {}
        );

        throws(
            () => runtime.parseArguments("not json", "fs_list"),
            /not a JSON object/
        );
    });

    await test("the repository is detected instead of declared", async () => {

        const repository =
            runtime.detectRepository();

        /* the test workspace is a fresh directory, not a repository */
        assert.equal(repository.available, false);
        assert.equal(repository.type, "none");

        const context =
            runtime.createRuntimeContext();

        assert.equal(context.repository.available, false);
        assert.equal(
            context.environment.platform,
            process.platform
        );
        assert.equal(
            context.workspace.root,
            context.runtime.workspace_root
        );
    });

    await test("nothing in the prompt repeats what the request already carries", async () => {

        const messages =
            runtime.createMainAgentMessages("a task");

        const text =
            messages.map(message => message.content || "").join("\n");

        /* the schemas travel once, in the request's tools field */
        assert.equal(text.includes("additionalProperties"), false);

        /* and the group taxonomy is the policy's business, not the agent's */
        assert.equal(
            messages.some(
                message =>
                    typeof message.content === "string" &&
                    message.content.includes('"available_tools"')
            ),
            false
        );

        assert.equal(text.includes('"tool_groups"'), false);
    });

    await test("the fixed cost of a request stays inside its budget", async () => {

        /*
        | Measured before this suite existed: 39,727 characters of
        | messages plus 19,730 of schemas, about 14,900 tokens, before a
        | single word of conversation. Every one of these numbers is a
        | ceiling, not a target: they exist so a new registry entry
        | cannot quietly tax every iteration.
        |
        | The workspace root is folded to "<root>" before measuring. The
        | runtime context repeats it, so the same unchanged prompt crossed
        | its ceiling on a deep checkout path and passed on a shallow one:
        | that measures the machine, not the budget.
        */

        const messages =
            runtime.createMainAgentMessages("a task");

        const workspaceRoot =
            (() => {

                const context =
                    messages.find(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes('"runtime_context"')
                    );

                if (!context) {
                    return process.cwd();
                }

                try {
                    return JSON.parse(context.content).context.workspace.root || process.cwd();
                } catch {
                    return process.cwd();
                }
            })();

        const measured =
            content =>
                [
                    workspaceRoot,
                    workspaceRoot.replace(/\\/g, "\\\\"),
                    workspaceRoot.replace(/\\/g, "/")
                ].reduce(
                    (text, form) => text.split(form).join("<root>"),
                    content
                );

        const sizeOf = type =>
            messages
                .filter(
                    message =>
                        typeof message.content === "string" &&
                        message.content.includes(`"${type}"`)
                )
                .reduce(
                    (total, message) => total + measured(message.content).length,
                    0
                );

        /*
        | 2026-11-25: the index now also lists the shipped library's
        | recommended skills (persona, 12 of 218), each by its opening clause.
        | Its entries are bounded by SKILL_INDEX_MAX_CHARS (past it, names
        | only); the message adds its wrapper around them.
        */

        assert.ok(
            sizeOf("available_skills") < require("../../../agent/config").get("SKILL_INDEX_MAX_CHARS") + 400,
            `the skill index is ${sizeOf("available_skills")} chars; it should be names and descriptions`
        );

        assert.ok(
            sizeOf("available_agents") < 2500,
            `the agent catalogue is ${sizeOf("available_agents")} chars`
        );

        assert.ok(
            sizeOf("runtime_context") < 3000,
            `the runtime context is ${sizeOf("runtime_context")} chars`
        );

        const total =
            messages.reduce(
                (sum, message) => sum + measured(message.content || "").length,
                0
            );

        /*
        | 2026-10-05, path-normalised: 30,049 characters, of which the live
        | runtime context is about 2,480. The old 30,000 was crossed by the
        | catalogues that arrived since it was set, not by a stray paragraph,
        | so the whole-request ceiling moves to 31,000 and the per-part
        | ceilings above are what actually bind: a new skill, agent or persona
        | is caught there first, while it is still one line, not 1,000.
        |
        | 2026-11-25: 31,541 with the library's recommended skills in the
        | skill index (about 1,400 characters, asked for by the operator and
        | switchable per skill in the console), so the ceiling moves to 32,000.
        */

        assert.ok(
            total < 32000,
            `the fixed messages are ${total} chars, they used to be 39727`
        );
    });

    await test("every agent is told to use workspace relative paths", async () => {

        const rules =
            runtime.executionRules();

        assert.match(rules, /relative to the workspace root/);
        assert.match(rules, /do not prefix a command with cd/);

        const subPrompt =
            runtime.buildAgentSystemPrompt(
                runtime.resolveAgentProfile("implementation")
            );

        assert.match(subPrompt, /relative to the workspace root/);
    });

    await test("the orchestrator can see which agents actually do work", async () => {

        const messages =
            runtime.createMainAgentMessages("a task");

        /* the prompt text mentions available_agents too, so match the payload */

        const catalogue =
            JSON.parse(
                messages.find(
                    message =>
                        typeof message.content === "string" &&
                        message.content.startsWith("{") &&
                        JSON.parse(message.content).type === "available_agents"
                ).content
            );

        const byName =
            Object.fromEntries(
                catalogue.agents.map(agent => [agent.name, agent])
            );

        assert.equal(byName.implementation.can_write_files, true);
        assert.equal(byName.implementation.can_run_commands, true);

        /* an analyst is not advertised as a doer */
        assert.equal(byName.code_analysis.can_write_files, false);
        assert.equal(byName.git_analysis.can_write_files, false);
        assert.equal(byName.git_analysis.can_change_repository, false);
        assert.equal(byName.git_analysis.can_run_commands, false);
        assert.equal(byName.research.can_run_commands, false);
    });

    await test("the agent budget is reported as a balance, not only a limit", async () => {

        const limits =
            runtime.createRuntimeContext().runtime;

        assert.equal(limits.agents_spawned, 0);
        assert.equal(limits.agents_remaining, limits.max_total_agents);
        assert.equal(limits.iterations_per_agent, limits.max_iterations);
    });

    await test("delegation guidance names concrete triggers and real work", async () => {

        const prompt =
            require("fs").readFileSync(
                require("path").join(
                    __dirname, "..", "..", "..", "agent", "config", "system_prompt.txt"
                ),
                "utf8"
            );

        assert.match(prompt, /WHEN TO DELEGATE/);
        assert.match(prompt, /own iteration budget/);
        assert.match(prompt, /agents_remaining/);

        /* the examples must include work, not only analysis */
        assert.match(prompt, /"agent": "implementation"/);
        assert.match(prompt, /can_write_files/);
    });
};
