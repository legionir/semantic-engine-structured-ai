"use strict";

/*
| tools.test.js: filesystem
|
| Runs inside tools.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function filesystemCases(ctx) {

    const {
        WORKSPACE,
        rejects,
        run,
        test
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("filesystem");

    await test("fs_write creates a file and reports bytes", async () => {

        const result =
            await run("fs_write", {
                path: "src/app.js",
                content: "line1\nline2\nline3\n"
            });

        assert.equal(result.created, true);
        assert.equal(result.bytes_written, 18);
    });

    await test("fs_write append adds to the existing file", async () => {

        await run("fs_write", {
            path: "src/app.js",
            content: "line4\n",
            mode: "append"
        });

        const read =
            await run("fs_read", { path: "src/app.js" });

        assert.match(read.content, /line4/);
    });

    await test("fs_read supports line windows and tail", async () => {

        const window =
            await run("fs_read", {
                path: "src/app.js",
                offset: 1,
                limit: 2
            });

        assert.equal(window.content, "line2\nline3");
        assert.equal(window.partial, true);

        const tail =
            await run("fs_read", {
                path: "src/app.js",
                tail: 2
            });

        assert.match(tail.content, /line4/);
    });

    await test("fs_read reports binary files instead of returning bytes", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, "blob.bin"),
            Buffer.from([0x00, 0x01, 0x02, 0x00])
        );

        const result =
            await run("fs_read", { path: "blob.bin" });

        assert.equal(result.binary, true);
        assert.equal(result.content, null);
    });

    await test("fs_read_many isolates per-file failures", async () => {

        const result =
            await run("fs_read_many", {
                paths: ["src/app.js", "missing.txt"]
            });

        assert.equal(result.requested, 2);
        assert.equal(result.succeeded, 1);
        assert.equal(result.files[1].success, false);
    });

    await test("fs_list reports sizes when asked", async () => {

        const result =
            await run("fs_list", {
                path: ".",
                include_sizes: true
            });

        const entry =
            result.entries.find(
                item => item.name === "blob.bin"
            );

        assert.equal(entry.size_bytes, 4);
    });

    await test("fs_tree respects max_depth", async () => {

        await run("fs_mkdir", { path: "a/b/c/d" });

        const shallow =
            await run("fs_tree", {
                path: ".",
                max_depth: 1
            });

        assert.equal(shallow.depth_truncated, true);
    });

    await test("fs_stat returns type and mode", async () => {

        const result =
            await run("fs_stat", { path: "src/app.js" });

        assert.equal(result.type, "file");
        assert.equal(result.is_symlink, false);
        assert.match(result.mode, /^[0-7]{3}$/);
    });

    await test("fs_write and fs_edit create byte-exact checkpoints that can be undone", async () => {

        const created = await run("fs_write", {
            path: "checkpoint-undo.txt",
            content: "\uFEFFbefore edit\r\nwith BOM-safe bytes\n"
        });
        assert.match(created.checkpoint_id, /^[a-f0-9-]{36}$/i);

        const edited = await run("fs_edit", {
            path: "checkpoint-undo.txt",
            old_text: "\uFEFFbefore edit\r\n",
            new_text: "\uFEFFafter edit\r\n"
        });
        assert.match(edited.checkpoint_id, /^[a-f0-9-]{36}$/i);
        assert.equal(
            fs.readFileSync(path.join(WORKSPACE, "checkpoint-undo.txt"), "utf8"),
            "\uFEFFafter edit\r\nwith BOM-safe bytes\n"
        );

        const undoEdit = await run("checkpoint_undo", {
            checkpoint_id: edited.checkpoint_id
        });
        assert.deepEqual(undoEdit.restored_files, ["checkpoint-undo.txt"]);
        assert.equal(
            fs.readFileSync(path.join(WORKSPACE, "checkpoint-undo.txt"), "utf8"),
            "\uFEFFbefore edit\r\nwith BOM-safe bytes\n"
        );

        await run("checkpoint_undo", { checkpoint_id: undoEdit.rollback_checkpoint_id });
        assert.equal(
            fs.readFileSync(path.join(WORKSPACE, "checkpoint-undo.txt"), "utf8"),
            "\uFEFFafter edit\r\nwith BOM-safe bytes\n"
        );

        await run("checkpoint_undo", { checkpoint_id: created.checkpoint_id });
        assert.equal(fs.existsSync(path.join(WORKSPACE, "checkpoint-undo.txt")), false);

        const nestedWrite = await run("fs_write", {
            path: "new-parent/deeper/file.txt",
            content: "nested"
        });
        await run("checkpoint_undo", { checkpoint_id: nestedWrite.checkpoint_id });
        assert.equal(fs.existsSync(path.join(WORKSPACE, "new-parent")), false);

        const madeDirectory = await run("fs_mkdir", { path: "made/with/parents" });
        assert.ok(madeDirectory.checkpoint_id);
        await run("checkpoint_undo", { checkpoint_id: madeDirectory.checkpoint_id });
        assert.equal(fs.existsSync(path.join(WORKSPACE, "made")), false);

        const tamperTarget = path.join(WORKSPACE, "checkpoint-tamper.txt");
        const tamperWrite = await run("fs_write", {
            path: "checkpoint-tamper.txt",
            content: "must remain intact"
        });
        const checkpointPath = path.join(WORKSPACE, ".agent", "checkpoints", `${tamperWrite.checkpoint_id}.json`);
        const checkpointRecord = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
        checkpointRecord.roots = ["."];
        fs.writeFileSync(checkpointPath, JSON.stringify(checkpointRecord));
        await rejects(
            run("checkpoint_undo", { checkpoint_id: tamperWrite.checkpoint_id }),
            /workspace root/
        );
        assert.equal(fs.readFileSync(tamperTarget, "utf8"), "must remain intact");

        await rejects(
            run("fs_delete", { path: ".agent", recursive: true }),
            /checkpoint repository/
        );
        assert.equal(fs.existsSync(path.join(WORKSPACE, ".agent", "checkpoints")), true);

        await rejects(
            run("fs_write", {
                path: "not-created/parent/file.txt",
                content: "no parents",
                create_parents: false
            }),
            /Parent directory does not exist/
        );
        assert.equal(fs.existsSync(path.join(WORKSPACE, "not-created")), false);

        const largePath = path.join(WORKSPACE, "checkpoint-limit.txt");
        fs.writeFileSync(largePath, "x".repeat(2048));
        const settings = require("../../../agent/config");
        const previousLimit = settings.get("FILE_CHECKPOINT_MAX_FILE_BYTES");
        settings.set("FILE_CHECKPOINT_MAX_FILE_BYTES", 1024);
        try {
            await rejects(
                run("fs_write", {
                    path: "checkpoint-limit.txt",
                    content: "replacement"
                }),
                /above the checkpoint limit/
            );
            assert.equal(fs.readFileSync(largePath, "utf8"), "x".repeat(2048));
        } finally {
            settings.set("FILE_CHECKPOINT_MAX_FILE_BYTES", previousLimit);
        }

    });


    await test("apply_patch atomically edits multiple files and preserves BOM, EOL and final newline", async () => {

        const first = path.join(WORKSPACE, "patch-one.txt");
        const second = path.join(WORKSPACE, "patch-two.txt");
        fs.writeFileSync(first, "\uFEFFfirst\r\nkeep\r\n", "utf8");
        fs.writeFileSync(second, "alpha\nbeta", "utf8");

        const patch = [
            "--- a/patch-one.txt",
            "+++ b/patch-one.txt",
            "@@ -1,2 +1,2 @@",
            "-first",
            "+FIRST",
            " keep",
            "--- a/patch-two.txt",
            "+++ b/patch-two.txt",
            "@@ -1,2 +1,2 @@",
            " alpha",
            "-beta",
            "+BETA",
            "\\ No newline at end of file"
        ].join("\n");

        const applied = await run("apply_patch", {
            paths: ["patch-one.txt", "patch-two.txt"],
            patch
        });
        assert.equal(applied.files.length, 2);
        assert.ok(applied.checkpoint_id);
        assert.equal(fs.readFileSync(first, "utf8"), "\uFEFFFIRST\r\nkeep\r\n");
        assert.equal(fs.readFileSync(second, "utf8"), "alpha\nBETA");

        await run("checkpoint_undo", { checkpoint_id: applied.checkpoint_id });
        assert.equal(fs.readFileSync(first, "utf8"), "\uFEFFfirst\r\nkeep\r\n");
        assert.equal(fs.readFileSync(second, "utf8"), "alpha\nbeta");

    });


    await test("apply_patch adds and deletes files from /dev/null headers and undo restores the original tree", async () => {

        const added = path.join(WORKSPACE, "patch-added.txt");
        const addedNoNewline = path.join(WORKSPACE, "patch-added-no-newline.txt");
        const deleted = path.join(WORKSPACE, "patch-deleted.txt");
        fs.writeFileSync(deleted, "remove me\nnow\n", "utf8");
        const patch = [
            "--- /dev/null",
            "+++ b/patch-added.txt",
            "@@ -0,0 +1,2 @@",
            "+new file",
            "+second line",
            "--- /dev/null",
            "+++ b/patch-added-no-newline.txt",
            "@@ -0,0 +1 @@",
            "+single line",
            "\\ No newline at end of file",
            "--- a/patch-deleted.txt",
            "+++ /dev/null",
            "@@ -1,2 +0,0 @@",
            "-remove me",
            "-now"
        ].join("\n");

        const applied = await run("apply_patch", {
            paths: ["patch-added.txt", "patch-added-no-newline.txt", "patch-deleted.txt"],
            patch
        });
        assert.deepEqual(applied.files.map(file => file.operation), ["add", "add", "delete"]);
        assert.equal(fs.readFileSync(added, "utf8"), "new file\nsecond line\n");
        assert.equal(fs.readFileSync(addedNoNewline, "utf8"), "single line");
        assert.equal(fs.existsSync(deleted), false);

        await run("checkpoint_undo", { checkpoint_id: applied.checkpoint_id });
        assert.equal(fs.existsSync(added), false);
        assert.equal(fs.existsSync(addedNoNewline), false);
        assert.equal(fs.readFileSync(deleted, "utf8"), "remove me\nnow\n");

    });


    await test("apply_patch refuses overwrites and partial file deletions before mutation", async () => {

        const existing = path.join(WORKSPACE, "patch-existing-add.txt");
        const partial = path.join(WORKSPACE, "patch-partial-delete.txt");
        fs.writeFileSync(existing, "keep me\n", "utf8");
        fs.writeFileSync(partial, "remove one\nkeep two\n", "utf8");

        await rejects(run("apply_patch", {
            paths: ["patch-existing-add.txt"],
            patch: [
                "--- /dev/null",
                "+++ b/patch-existing-add.txt",
                "@@ -0,0 +1 @@",
                "+do not overwrite"
            ].join("\n")
        }), /already exists/);

        await rejects(run("apply_patch", {
            paths: ["patch-partial-delete.txt"],
            patch: [
                "--- a/patch-partial-delete.txt",
                "+++ /dev/null",
                "@@ -1,2 +0,1 @@",
                "-remove one",
                " keep two"
            ].join("\n")
        }), /delete-file patch may contain only removed lines/);

        assert.equal(fs.readFileSync(existing, "utf8"), "keep me\n");
        assert.equal(fs.readFileSync(partial, "utf8"), "remove one\nkeep two\n");

    });


    await test("apply_patch rolls back earlier files if a later atomic write fails", async () => {

        const added = path.join(WORKSPACE, "patch-rollback-added.txt");
        const first = path.join(WORKSPACE, "patch-rollback-one.txt");
        const second = path.join(WORKSPACE, "patch-rollback-two.txt");
        fs.writeFileSync(first, "one\n", "utf8");
        fs.writeFileSync(second, "two\n", "utf8");
        const patch = [
            "--- /dev/null",
            "+++ b/patch-rollback-added.txt",
            "@@ -0,0 +1 @@",
            "+temporary addition",
            "--- a/patch-rollback-one.txt",
            "+++ b/patch-rollback-one.txt",
            "@@ -1 +1 @@",
            "-one",
            "+ONE",
            "--- a/patch-rollback-two.txt",
            "+++ b/patch-rollback-two.txt",
            "@@ -1 +1 @@",
            "-two",
            "+TWO"
        ].join("\n");

        const AtomicFile = require("../../../agent/persistence/AtomicFile");
        const originalWriteFile = AtomicFile.writeFile;
        let writes = 0;
        AtomicFile.writeFile = (...args) => {
            writes++;
            if (writes === 2) throw new Error("injected patch write failure");
            return originalWriteFile(...args);
        };
        try {
            await rejects(
                run("apply_patch", {
                    paths: ["patch-rollback-added.txt", "patch-rollback-one.txt", "patch-rollback-two.txt"],
                    patch
                }),
                /injected patch write failure/
            );
        } finally {
            AtomicFile.writeFile = originalWriteFile;
        }
        assert.equal(fs.existsSync(added), false);
        assert.equal(fs.readFileSync(first, "utf8"), "one\n");
        assert.equal(fs.readFileSync(second, "utf8"), "two\n");

    });


    await test("apply_patch rejects a stale or malformed patch before changing any file", async () => {

        const target = path.join(WORKSPACE, "patch-reject.txt");
        fs.writeFileSync(target, "one\ntwo\n", "utf8");
        await rejects(
            run("apply_patch", {
                paths: ["patch-reject.txt"],
                patch: [
                    "--- a/patch-reject.txt",
                    "+++ b/patch-reject.txt",
                    "@@ -1,1 +1,1 @@",
                    "-not present",
                    "+replacement"
                ].join("\n")
            }),
            /context does not match/
        );
        assert.equal(fs.readFileSync(target, "utf8"), "one\ntwo\n");

    });


    await test("fs_edit refuses an ambiguous match", async () => {

        await run("fs_write", {
            path: "dup.txt",
            content: "x\nx\n"
        });

        await rejects(
            run("fs_edit", {
                path: "dup.txt",
                old_text: "x",
                new_text: "y"
            }),
            /matched 2 times/
        );
    });
};
