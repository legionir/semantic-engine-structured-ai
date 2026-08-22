const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-hooks-test-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

const settings = require("../agent/lib/storage");
const hooks = require("../agent/lib/hooks");
const project = require("../agent/lib/project");

const results = [];

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
}


async function main() {

    console.log("hooks");

    await test("hooks are globally off and empty by default", () => {

        assert.deepEqual(hooks.load(true).before_task, []);
        assert.deepEqual(hooks.load().after_task, []);
        assert.deepEqual(hooks.routine(), {
            enabled: false,
            before_task: [],
            after_task: []
        });
    });

    await test("the closed condition language and templates are deterministic", () => {

        const context = {
            task: "build input",
            objective: "ship it",
            repository: { dirty: true },
            files_changed: ["src/a.js", "src/b.js"],
            plan: { complete: false },
            hooks: {
                verify: { ok: true, summary: "npm test passed" }
            }
        };

        assert.equal(
            hooks.evaluateWhen(
                "repository.dirty && files_changed && hooks.verify.ok && !plan.complete",
                context
            ),
            true
        );

        assert.deepEqual(
            hooks.render("${files_changed}", context),
            ["src/a.js", "src/b.js"]
        );

        assert.equal(
            hooks.render(
                "${task}: ${hooks.verify.summary} (${files_changed})",
                context
            ),
            "build input: npm test passed (src/a.js, src/b.js)"
        );
    });

    await test("hook references become graph dependencies", () => {

        const config =
            hooks.validateConfig({
                before_task: [],
                after_task: [
                    {
                        id: "verify",
                        type: "agent",
                        agent: "testing",
                        task: "test ${files_changed}"
                    },
                    {
                        id: "review",
                        type: "agent",
                        agent: "code_analysis",
                        task: "review ${objective}"
                    },
                    {
                        id: "record",
                        type: "git_commit",
                        when: "hooks.verify.ok && hooks.review.ok",
                        message: "${task}",
                        paths: "${files_changed}"
                    }
                ]
            });

        assert.deepEqual(
            config.after_task[2].depends_on,
            ["verify", "review"]
        );
    });

    await test("unknown conditions, tools and cyclic graphs are rejected", () => {

        assert.throws(
            () => hooks.validateConfig({
                before_task: [
                    {
                        id: "x",
                        type: "tool",
                        tool: "fs_read",
                        when: "process.env.SECRET",
                        arguments: { path: "." }
                    }
                ],
                after_task: []
            }),
            /unsupported condition/
        );

        assert.throws(
            () => hooks.validateConfig({
                before_task: [
                    {
                        id: "x",
                        type: "tool",
                        tool: "not_a_tool",
                        arguments: {}
                    }
                ],
                after_task: []
            }),
            /unknown tool/
        );

        assert.throws(
            () => hooks.validateConfig({
                before_task: [
                    {
                        id: "a",
                        type: "tool",
                        tool: "fs_list",
                        arguments: { path: "." },
                        depends_on: ["b"]
                    },
                    {
                        id: "b",
                        type: "tool",
                        tool: "fs_list",
                        arguments: { path: "." },
                        depends_on: ["a"]
                    }
                ],
                after_task: []
            }),
            /cycle/
        );
    });

    await test("project overrides hot reload and populate the read-only routine", () => {

        settings.set("HOOKS_ENABLED", true);

        fs.mkdirSync(path.dirname(project.projectPath()), { recursive: true });

        fs.writeFileSync(
            project.projectPath(),
            JSON.stringify({
                version: "1",
                settings: {},
                hooks: {
                    before_task: [
                        {
                            id: "inspect",
                            type: "tool",
                            tool: "fs_list",
                            arguments: { path: "." }
                        }
                    ],
                    after_task: []
                }
            })
        );

        assert.equal(hooks.load(false).before_task[0].id, "inspect");
        assert.deepEqual(hooks.routine().before_task, ["inspect"]);

        fs.writeFileSync(
            project.projectPath(),
            JSON.stringify({
                version: "1",
                settings: {},
                hooks: {
                    before_task: [
                        {
                            id: "inspect_again_with_a_different_size",
                            type: "tool",
                            tool: "fs_list",
                            arguments: { path: "." }
                        }
                    ],
                    after_task: []
                }
            })
        );

        assert.equal(
            hooks.load(false).before_task[0].id,
            "inspect_again_with_a_different_size"
        );

        settings.reset("HOOKS_ENABLED");
    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {
        process.exitCode = 1;
    }
}

main();
