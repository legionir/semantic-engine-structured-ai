"use strict";

/*
|--------------------------------------------------------------------------
| P0-3 — Path normalization & symlink safety
|--------------------------------------------------------------------------
|
| After the fix:
|   - a DANGLING symlink inside the workspace cannot be used to write or
|     mkdir outside the workspace (agent/context/WorkspaceBoundary.js);
|   - fs_delete / fs_move act on the symlink itself, never on its target
|     (agent/tools/filesystem/DirectoryTools.js);
|   - Windows backslash paths such as "src\.git\hooks\pre-commit" and
|     "agent\registry\policy.json" are caught by the deny rules
|     (agent/registry/policy.json, evaluated by agent/policy).
|
| Symlink tests are skipped (not failed) where the OS refuses to create a
| symlink, e.g. Windows without Developer Mode / SeCreateSymbolicLink.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

/*
| Every filesystem test runs against a throwaway workspace with a sibling
| "outside" directory. WORKSPACE_ROOT must be set before the tools load.
*/

const BASE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "p0-3-")
    );

const WORKSPACE = path.join(BASE, "ws");
const OUTSIDE = path.join(BASE, "outside");

fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_TOOL_RESULT_CHARS = "20000";
process.env.PROCESS_SANDBOX_MODE = "test";

const tools = require(path.join(REPO, "agent", "tools"));

const {
    WORKSPACE_ROOT,
    resolvePathInRoot,
    assertPathSafeInRoot
} = require(path.join(REPO, "agent", "context", "WorkspaceBoundary"));

const { PolicyEngine } = require(path.join(REPO, "agent", "policy"));

const POLICY = require(path.join(REPO, "agent", "registry", "policy.json"));
const TOOL_GROUPS = require(path.join(REPO, "agent", "registry", "tool_groups.json"));


/* Global watchdog: never let a hung test keep the process alive. */
setTimeout(() => {
    console.error("P0-3 tests timed out after 60s");
    cleanup();
    process.exit(1);
}, 60000).unref();


const results = [];


class SkipTest extends Error {}


async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        if (error instanceof SkipTest) {

            results.push({ name, ok: true, skipped: true });
            console.log(`  skip ${name}`);
            console.log(`       ${error.message}`);
            return;
        }

        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}


const run = (name, args) =>
    tools.executeTool(name, args, { agent: "test" });


/* Create a symlink or skip the test when the OS does not permit it. */
function symlinkOrSkip(target, linkPath, type) {

    try {

        fs.symlinkSync(target, linkPath, type);

    } catch (error) {

        if (["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error.code)) {

            throw new SkipTest(
                `symlink creation is not permitted here (${error.code}); ` +
                (process.platform === "win32"
                    ? "enable Windows Developer Mode to run this test"
                    : "the filesystem does not support symlinks")
            );
        }

        throw error;
    }
}


/* existsSync follows links; this does not, so a dangling link "exists". */
function lexists(target) {

    try {

        fs.lstatSync(target);
        return true;

    } catch (error) {

        if (error.code === "ENOENT") {
            return false;
        }

        throw error;
    }
}


async function settle(promise) {

    try {

        return { ok: true, value: await promise };

    } catch (error) {

        return { ok: false, error };
    }
}


function cleanup() {

    try {
        fs.rmSync(BASE, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
}


const FS_ERRNO_CODES = ["ENOENT", "EEXIST", "ENOTDIR", "ELOOP"];


async function main() {

    console.log("\nP0-3 dangling symlinks and the workspace boundary");


    await test("P0-3: a dangling symlink cannot pass the workspace boundary checks (resolve + assertSafe)", async () => {

        /* file link whose target outside the workspace does not exist yet */
        const fileLink = path.join(WORKSPACE, "boundary-escape-file");
        const fileTarget = path.join(OUTSIDE, "boundary-created.txt");

        symlinkOrSkip(fileTarget, fileLink, "file");

        /* directory link whose target outside the workspace does not exist */
        const dirLink = path.join(WORKSPACE, "boundary-escape-dir");
        const dirTarget = path.join(OUTSIDE, "boundary-newdir");

        symlinkOrSkip(dirTarget, dirLink, "dir");

        assert.equal(fs.existsSync(fileTarget), false);
        assert.equal(fs.existsSync(dirTarget), false);

        /*
        | This is exactly the pair of calls fs_write / fs_mkdir make
        | (ctx.resolvePath + ctx.assertSafe with rejectSymlinks). One of the
        | two must refuse a path whose real destination is outside.
        */
        for (const input of ["boundary-escape-file", "boundary-escape-dir/sub"]) {

            assert.throws(
                () => {
                    const resolved = resolvePathInRoot(WORKSPACE_ROOT, input);
                    assertPathSafeInRoot(WORKSPACE_ROOT, resolved, { rejectSymlinks: true });
                },
                error => error instanceof Error,
                `expected the boundary to refuse "${input}", which is a dangling symlink pointing outside the workspace`
            );
        }

        assert.equal(fs.existsSync(fileTarget), false);
        assert.equal(fs.existsSync(dirTarget), false);
    });


    await test("P0-3: fs_write through a dangling symlink cannot create a file outside the workspace", async () => {

        const link = path.join(WORKSPACE, "write-escape");
        const target = path.join(OUTSIDE, "write-created.txt");

        symlinkOrSkip(target, link, "file");

        const outcome =
            await settle(run("fs_write", { path: "write-escape", content: "pwned" }));

        assert.equal(
            fs.existsSync(target),
            false,
            "fs_write followed a dangling symlink and created a file outside the workspace"
        );

        assert.equal(
            outcome.ok,
            false,
            "fs_write through a dangling symlink to outside the workspace must be refused"
        );
    });


    await test("P0-3: fs_write with append through a dangling symlink cannot create a file outside the workspace", async () => {

        const link = path.join(WORKSPACE, "append-escape");
        const target = path.join(OUTSIDE, "append-created.txt");

        symlinkOrSkip(target, link, "file");

        const outcome =
            await settle(run("fs_write", { path: "append-escape", content: "pwned", mode: "append" }));

        assert.equal(
            fs.existsSync(target),
            false,
            "fs_write (append) followed a dangling symlink and created a file outside the workspace"
        );

        assert.equal(outcome.ok, false, "the append must be refused");
    });


    await test("P0-3: fs_mkdir through a dangling directory symlink is refused by the boundary", async () => {

        const link = path.join(WORKSPACE, "mkdir-escape");
        const target = path.join(OUTSIDE, "mkdir-newdir");

        symlinkOrSkip(target, link, "dir");

        const outcome =
            await settle(run("fs_mkdir", { path: "mkdir-escape/sub" }));

        assert.equal(
            fs.existsSync(target),
            false,
            "fs_mkdir created a directory outside the workspace through a dangling symlink"
        );

        assert.equal(outcome.ok, false, "fs_mkdir through a dangling symlink must be refused");

        /*
        | Today the call only fails by accident (a raw ENOENT from the
        | recursive mkdir). The boundary itself must be what refuses it.
        */
        assert.ok(
            !FS_ERRNO_CODES.includes(outcome.error && outcome.error.code),
            `expected a boundary refusal, got a raw filesystem error: ${
                outcome.error && (outcome.error.code || outcome.error.message)
            }`
        );
    });


    console.log("\nP0-3 fs_delete / fs_move act on the link, not the target");


    await test("P0-3: fs_delete on a file symlink deletes the link, not its target", async () => {

        const dir = path.join(WORKSPACE, "delete-file");
        fs.mkdirSync(dir, { recursive: true });

        const real = path.join(dir, "real.txt");
        const link = path.join(dir, "link.txt");

        fs.writeFileSync(real, "keep me");
        symlinkOrSkip("real.txt", link, "file");

        const outcome =
            await settle(run("fs_delete", { path: "delete-file/link.txt" }));

        assert.equal(
            fs.existsSync(real),
            true,
            "fs_delete on a symlink deleted the file it points to"
        );
        assert.equal(fs.readFileSync(real, "utf8"), "keep me");

        assert.equal(
            outcome.ok,
            true,
            `fs_delete on a symlink should delete the link: ${outcome.error && outcome.error.message}`
        );
        assert.equal(lexists(link), false, "the symlink itself should be gone");
    });


    await test("P0-3: fs_delete on a directory symlink does not delete the target directory's contents", async () => {

        const dir = path.join(WORKSPACE, "delete-dir");
        const realDir = path.join(dir, "realdir");
        const keep = path.join(realDir, "keep.txt");
        const link = path.join(dir, "linkdir");

        fs.mkdirSync(realDir, { recursive: true });
        fs.writeFileSync(keep, "keep me");

        /* a junction needs no privilege on Windows and needs an absolute target */
        symlinkOrSkip(
            realDir,
            link,
            process.platform === "win32" ? "junction" : "dir"
        );

        await settle(run("fs_delete", { path: "delete-dir/linkdir", recursive: true }));

        assert.equal(
            fs.existsSync(keep),
            true,
            "fs_delete on a directory symlink recursively deleted the real directory it points to"
        );
        assert.equal(fs.readFileSync(keep, "utf8"), "keep me");
    });


    await test("P0-3: fs_move on a symlink moves the link, not its target", async () => {

        const dir = path.join(WORKSPACE, "move-file");
        fs.mkdirSync(dir, { recursive: true });

        const real = path.join(dir, "real.txt");
        const link = path.join(dir, "link.txt");
        const moved = path.join(dir, "moved.txt");

        fs.writeFileSync(real, "stay here");
        symlinkOrSkip("real.txt", link, "file");

        const outcome =
            await settle(run("fs_move", {
                source: "move-file/link.txt",
                destination: "move-file/moved.txt"
            }));

        assert.equal(
            fs.existsSync(real),
            true,
            "fs_move on a symlink moved the file it points to"
        );
        assert.equal(fs.readFileSync(real, "utf8"), "stay here");

        /* Refusing to move a symlink is also safe; if it moved, it moved the link. */
        if (outcome.ok) {

            assert.equal(lexists(link), false, "the original link should have been moved away");
            assert.equal(
                fs.lstatSync(moved).isSymbolicLink(),
                true,
                "the destination should be the moved symlink, not a regular file"
            );
        }
    });


    console.log("\nP0-3 Windows backslash paths and the deny rules");


    const engine =
        new PolicyEngine({
            policy: POLICY,
            toolGroups: TOOL_GROUPS
        });

    const decide = (tool, args) =>
        engine.evaluate(tool, args, "main_agent").decision;


    await test("P0-3: backslash paths into .git are denied for fs_write/fs_edit/fs_delete and fs_move", async () => {

        const cases = [
            ["fs_write", { path: "src\\.git\\hooks\\pre-commit", content: "#!/bin/sh" }],
            ["fs_write", { path: ".git\\hooks\\pre-commit", content: "#!/bin/sh" }],
            ["fs_edit", { path: ".git\\config", old_text: "a", new_text: "b" }],
            ["fs_delete", { path: ".git\\HEAD" }],
            ["fs_delete", { path: "src\\.git" }],
            ["fs_write", { path: "C:\\projects\\app\\.git\\hooks\\post-checkout", content: "x" }],
            ["fs_write", { path: "src/.git\\hooks\\pre-push", content: "x" }],
            ["fs_move", { source: ".git\\HEAD", destination: "head.txt" }],
            ["fs_move", { source: "hook.sh", destination: "src\\.git\\hooks\\pre-commit" }]
        ];

        for (const [tool, args] of cases) {

            assert.equal(
                decide(tool, args),
                "deny",
                `expected ${tool} ${JSON.stringify(args)} to be denied`
            );
        }
    });


    await test("P0-3: backslash paths to agent\\registry\\policy.json are denied", async () => {

        const cases = [
            ["fs_write", { path: "agent\\registry\\policy.json", content: "{}" }],
            ["fs_edit", { path: "agent\\registry\\policy.json", old_text: "deny", new_text: "allow" }],
            ["fs_delete", { path: "agent\\registry\\policy.json" }],
            ["fs_write", { path: "agent/registry\\policy.json", content: "{}" }],
            ["fs_write", { path: "C:\\projects\\structured-ai\\agent\\registry\\policy.json", content: "{}" }],
            ["fs_move", { source: "agent\\registry\\policy.json", destination: "p.json" }]
        ];

        for (const [tool, args] of cases) {

            assert.equal(
                decide(tool, args),
                "deny",
                `expected ${tool} ${JSON.stringify(args)} to be denied`
            );
        }
    });


    await test("P0-3: forward-slash denies still hold and ordinary backslash paths are not denied", async () => {

        /* the existing forward-slash protection must survive the fix */
        assert.equal(decide("fs_write", { path: "src/.git/hooks/pre-commit", content: "x" }), "deny");
        assert.equal(decide("fs_write", { path: "agent/registry/policy.json", content: "{}" }), "deny");

        /* normalisation must not turn every Windows path into a deny */
        assert.notEqual(decide("fs_write", { path: "src\\app.js", content: "x" }), "deny");
        assert.notEqual(decide("fs_write", { path: "src\\gitignore.js", content: "x" }), "deny");
        assert.notEqual(decide("fs_delete", { path: "docs\\registry\\policy.md" }), "deny");

        /* runtime config written with backslashes still needs approval at least */
        assert.notEqual(
            decide("fs_write", { path: "agent\\config\\index.js", content: "x" }),
            "allow",
            "a backslash path into agent\\config must still need approval (or be denied)"
        );
    });


    const failed = results.filter(item => !item.ok);
    const skipped = results.filter(item => item.skipped);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed` +
        (skipped.length > 0 ? ` (${skipped.length} skipped)` : "")
    );

    process.exitCode = failed.length === 0 ? 0 : 1;
}


main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        try {
            if (typeof tools.shutdown === "function") {
                tools.shutdown();
            }
        } catch {
            /* best effort */
        }
        cleanup();
        /* the tool runtime may hold handles open; exit with the recorded code */
        process.exit(process.exitCode || 0);
    });
