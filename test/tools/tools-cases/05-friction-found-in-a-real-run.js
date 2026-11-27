"use strict";

/*
| tools.test.js: friction found in a real run
|
| Runs inside tools.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function frictionFoundInARealRunCases(ctx) {

    const {
        rejects,
        run,
        test,
        tools
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nfriction found in a real run");

    await test("one plan update may be written flat", async () => {

        await run("plan_set", {
            objective: "finish the input package",
            phases: [
                {
                    id: "P1",
                    title: "input",
                    steps: [
                        { id: "P1.1", title: "write the manager" }
                    ]
                }
            ]
        });

        /*
        | A real run lost two iterations to this shape being refused.
        | The intent is unambiguous, so the runtime accepts it.
        */

        const flat =
            await run("plan_update", {
                id: "P1.1",
                status: "done",
                evidence: "npx tsc --build exited 0"
            });

        assert.deepEqual(flat.updated, ["P1.1"]);
        assert.equal(flat.summary.done, 1);

        /* a single object instead of an array is accepted too */
        const single =
            await run("plan_update", {
                updates: {
                    id: "P1.1",
                    status: "in_progress"
                }
            });

        assert.deepEqual(single.updated, ["P1.1"]);

        /* and an empty call still says what the shapes are */
        await rejects(
            run("plan_update", {}),
            /Provide updates, add_steps, or both/
        );
    });

    await test("a skill is an index in the prompt and full text on demand", async () => {

        const skills =
            require("../../../agent/tools/skills");

        /* what every request carries */
        const index = skills._skillIndex();

        assert.ok(index.length >= 9);

        assert.deepEqual(
            Object.keys(index[0]).sort(),
            ["description", "name"]
        );

        /* the runtime's own skills stay as small as they were */
        const own = index.filter(entry => !skills._activeSkills().some(skill => skill.name === entry.name && skill.origin === "library"));

        assert.ok(
            JSON.stringify(own).length < 1500,
            `the index is ${JSON.stringify(own).length} chars`
        );

        /* the recommended library skills come in by their opening clause, inside the budget */
        assert.ok(
            JSON.stringify(index).length <= require("../../../agent/config").get("SKILL_INDEX_MAX_CHARS"),
            `the whole index is ${JSON.stringify(index).length} chars`
        );

        /* what arrives when it is asked for */
        const loaded =
            await run("skill_get", { names: ["git", "planning"] });

        assert.deepEqual(
            loaded.skills.map(skill => skill.name),
            ["git", "planning"]
        );

        assert.ok(loaded.skills[0].instructions.length > 0);
        assert.ok(loaded.skills[0].constraints.length > 0);
        assert.ok(loaded.skills[0].tools.length > 0);

        /* a wrong name says what the right ones are */
        await rejects(
            run("skill_get", { name: "no_such_skill" }),
            /Unknown skill: no_such_skill\. Available skills: .*planning/
        );

        await rejects(
            run("skill_get", {}),
            /skill_get needs a name/
        );

        /* one known and one unknown returns the known one and says so */
        const partial =
            await run("skill_get", { names: ["git", "nope"] });

        assert.deepEqual(partial.missing, ["nope"]);
    });

    await test("a skill may carry data, and the data stays where it belongs", async () => {

        /*
        | A skill with resources lives in its own directory. The prompt
        | never sees the data, skill_get lists what exists, and
        | skill_read returns one slice of one file.
        */

        const loaded =
            await run("skill_get", { name: "ui_ux_pro_max" });

        const skill = loaded.skills[0];

        assert.deepEqual(
            skill.resources.map(resource => resource.id),
            ["spacing", "contrast"]
        );

        /* the listing carries titles, never the text */
        assert.equal(
            JSON.stringify(skill).includes("Every gap, padding"),
            false
        );

        assert.match(loaded.note, /skill_read/);

        const read =
            await run("skill_read", {
                name: "ui_ux_pro_max",
                resource: "spacing",
                limit: 5
            });

        assert.equal(read.resource, "spacing");
        assert.match(read.content, /4, 8, 12, 16, 24, 32, 48, 64/);
        assert.equal(read.end_line, 5);
        assert.ok(read.total_lines > 5);

        /* a resource is addressed by id, so a path cannot be smuggled in */
        await rejects(
            run("skill_read", {
                name: "ui_ux_pro_max",
                resource: "../../../etc/passwd"
            }),
            /Unknown resource .*It has: spacing/
        );

        await rejects(
            run("skill_read", {
                name: "ui_ux_pro_max",
                resource: "resources/spacing.md"
            }),
            /Unknown resource/
        );

        /* a skill without resources says so instead of failing oddly */
        await rejects(
            run("skill_read", { name: "git", resource: "anything" }),
            /has no resources/
        );

        /* and a data skill is in the index like any other */
        const skills = require("../../../agent/tools/skills");

        assert.ok(
            skills._skillIndex().some(
                item => item.name === "ui_ux_pro_max"
            )
        );
    });

    await test("loading a skill is an event, attributed to the agent", async () => {

        const events =
            require("../../../agent/events");

        const seen = [];

        const listen = event => seen.push(event);

        events.bus.on("skill:loaded", listen);

        try {

            await tools.executeTool(
                "skill_get",
                { name: "search" },
                { agent: "code_analysis#1" }
            );

        } finally {

            events.bus.off("skill:loaded", listen);
        }

        assert.equal(seen.length, 1);
        assert.equal(seen[0].agent, "code_analysis#1");
        assert.deepEqual(seen[0].skills, ["search"]);
        assert.ok(seen[0].chars > 0);
    });

    await test("a file search accepts a glob, not only a substring", async () => {

        /*
        | A real run asked for "*.test.*", got nothing, and spent two
        | more iterations guessing what this tool wanted.
        */

        await run("fs_write", {
            path: "tests/input.test.ts",
            content: "test"
        });

        await run("fs_write", {
            path: "vitest.config.ts",
            content: "config"
        });

        const glob =
            await run("search_start", {
                path: ".",
                query: "*.test.*",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            glob.results.map(item => item.path),
            ["tests/input.test.ts"]
        );

        const prefix =
            await run("search_start", {
                path: ".",
                query: "vitest.config*",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            prefix.results.map(item => item.path),
            ["vitest.config.ts"]
        );

        const withDirectory =
            await run("search_start", {
                path: ".",
                query: "tests/*.ts",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            withDirectory.results.map(item => item.path),
            ["tests/input.test.ts"]
        );

        /* a plain word still matches anywhere in the name */
        const substring =
            await run("search_start", {
                path: ".",
                query: "vitest",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            substring.results.map(item => item.path),
            ["vitest.config.ts"]
        );
    });

    await test("a command that cds out of the workspace is refused", async () => {

        /*
        | "cd /workspace && npx tsc" on Windows fails inside the shell and
        | the agent reads the shell's error instead of its own mistake.
        */

        await rejects(
            run("terminal_exec", {
                command: "cd /workspace && npx tsc --build"
            }),
            /not inside the workspace.*cwd argument/s
        );

        /* a subdirectory of the workspace is still allowed */
        await run("fs_mkdir", { path: "sub" });

        const inside =
            await run("terminal_exec", {
                command: "cd sub && pwd",
                timeout_ms: 5000
            });

        assert.equal(inside.exit_code, 0);

        /* and an ordinary command is untouched */
        const plain =
            await run("terminal_exec", {
                command: "echo hello",
                timeout_ms: 5000
            });

        assert.match(plain.stdout, /hello/);
    });

    tools.shutdown();
};
