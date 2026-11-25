"use strict";

/*
| tools.test.js: git, runtime
|
| Runs inside tools.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");


module.exports = async function gitCases(ctx) {

    const {
        WORKSPACE,
        rejects,
        run,
        test,
        tools
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\ngit");

    await test("git tools operate on a repository", async () => {

        execFileSync("git", ["init", "-q", WORKSPACE]);

        execFileSync(
            "git",
            [
                "-C", WORKSPACE,
                "-c", "user.email=test@example.com",
                "-c", "user.name=test",
                "commit", "-q", "--allow-empty", "-m", "init"
            ]
        );

        const status =
            await run("git_status", { cwd: "." });

        assert.match(status.stdout, /##/);

        const log =
            await run("git_log", { cwd: ".", limit: 1 });

        assert.match(log.stdout, /init/);
    });

    await test("git_branch is immune to shell injection", async () => {

        const marker =
            path.join(WORKSPACE, "PWNED");

        await rejects(
            run("git_branch", {
                cwd: ".",
                action: "create",
                name: `x; touch ${marker}`
            }),
            /failed/
        );

        assert.equal(
            fs.existsSync(marker),
            false,
            "injected command must not run"
        );
    });

    await test("git_checkout is immune to shell injection", async () => {

        const marker =
            path.join(WORKSPACE, "PWNED2");

        await rejects(
            run("git_checkout", {
                cwd: ".",
                branch: `main; touch ${marker}`
            }),
            /failed/
        );

        assert.equal(
            fs.existsSync(marker),
            false,
            "injected command must not run"
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nruntime");

    await test("unimplemented tools are rejected", async () => {

        await rejects(
            run("does_not_exist", {}),
            /not implemented/
        );
    });

    await test("oversized output is truncated, not dropped", async () => {

        await run("fs_write", {
            path: "big.txt",
            content: "a".repeat(60000)
        });

        const result =
            await run("fs_read", { path: "big.txt" });

        assert.equal(result.output_truncated, true);
        assert.ok(result.content.length < 60000);
        assert.match(result.content, /truncated/);
    });

    await test("runtime_stats reports executed calls", async () => {

        const stats =
            await run("runtime_stats", {
                recent_limit: 5
            });

        assert.ok(stats.total_calls > 10);
        assert.ok(stats.tools.length > 5);
        assert.ok(stats.recent_calls.length <= 5);
        assert.ok(stats.files_changed.includes("src/app.js"));
        assert.ok(stats.files_changed.includes("big.txt"));
        assert.equal(stats.file_tracking_complete, false);
    });

    await test("registry, groups and implementations agree", async () => {

        const declared =
            require("../../../agent/registry/tools.json")
                .map(tool => tool.function.name);

        const grouped =
            Object.values(
                require("../../../agent/registry/tool_groups.json")
            ).flatMap(group => group.tools);

        const implemented =
            tools.implementedToolNames();

        assert.deepEqual(
            declared.filter(
                name => !implemented.includes(name)
            ),
            []
        );

        assert.deepEqual(
            implemented.filter(
                name => !declared.includes(name)
            ),
            []
        );

        assert.deepEqual(
            declared.filter(
                name => !grouped.includes(name)
            ),
            []
        );
    });
};
