"use strict";

/*
| tools.test.js: workspace boundary, search
|
| Runs inside tools.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");


module.exports = async function workspaceBoundaryCases(ctx) {

    const {
        WORKSPACE,
        rejects,
        run,
        test
    } = ctx;

    await test("fs_edit applies the expected number of replacements", async () => {

        const result =
            await run("fs_edit", {
                path: "dup.txt",
                old_text: "x",
                new_text: "y",
                expected_replacements: 2
            });

        assert.equal(result.replacements, 2);
    });

    await test("fs_move refuses to overwrite unless told to", async () => {

        await run("fs_write", { path: "one.txt", content: "1" });
        await run("fs_write", { path: "two.txt", content: "2" });

        await rejects(
            run("fs_move", {
                source: "one.txt",
                destination: "two.txt"
            }),
            /already exists/
        );

        const moved =
            await run("fs_move", {
                source: "one.txt",
                destination: "two.txt",
                overwrite: true
            });

        assert.equal(moved.overwritten, true);
    });

    await test("fs_move and recursive fs_delete can be undone", async () => {

        fs.mkdirSync(path.join(WORKSPACE, "checkpoint-tree"));
        fs.writeFileSync(path.join(WORKSPACE, "checkpoint-tree", "one.txt"), "one\n");
        fs.mkdirSync(path.join(WORKSPACE, "checkpoint-tree", "nested"));
        fs.writeFileSync(path.join(WORKSPACE, "checkpoint-tree", "nested", "two.txt"), "two\n");

        const moved = await run("fs_move", {
            source: "checkpoint-tree",
            destination: "checkpoint-moved"
        });
        assert.ok(moved.checkpoint_id);
        await run("checkpoint_undo", { checkpoint_id: moved.checkpoint_id });
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "checkpoint-tree", "nested", "two.txt"), "utf8"), "two\n");
        assert.equal(fs.existsSync(path.join(WORKSPACE, "checkpoint-moved")), false);

        fs.writeFileSync(path.join(WORKSPACE, "move-source.txt"), "source\n");
        fs.writeFileSync(path.join(WORKSPACE, "move-destination.txt"), "destination\n");
        const overwrittenMove = await run("fs_move", {
            source: "move-source.txt",
            destination: "move-destination.txt",
            overwrite: true
        });
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "move-destination.txt"), "utf8"), "source\n");
        await run("checkpoint_undo", { checkpoint_id: overwrittenMove.checkpoint_id });
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "move-source.txt"), "utf8"), "source\n");
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "move-destination.txt"), "utf8"), "destination\n");

        const settings = require("../../../agent/config");
        const previousMaxFiles = settings.get("FILE_CHECKPOINT_MAX_FILES");
        settings.set("FILE_CHECKPOINT_MAX_FILES", 2);
        try {
            await rejects(
                run("fs_delete", { path: "checkpoint-tree", recursive: true }),
                /entry limit/
            );
            assert.equal(fs.existsSync(path.join(WORKSPACE, "checkpoint-tree", "one.txt")), true);
        } finally {
            settings.set("FILE_CHECKPOINT_MAX_FILES", previousMaxFiles);
        }

        const deleted = await run("fs_delete", {
            path: "checkpoint-tree",
            recursive: true
        });
        assert.ok(deleted.checkpoint_id);
        assert.equal(fs.existsSync(path.join(WORKSPACE, "checkpoint-tree")), false);
        await run("checkpoint_undo", { checkpoint_id: deleted.checkpoint_id });
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "checkpoint-tree", "one.txt"), "utf8"), "one\n");
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "checkpoint-tree", "nested", "two.txt"), "utf8"), "two\n");

    });


    await test("failed multi-file restore rolls back to the pre-undo state", async () => {

        const root = path.join(WORKSPACE, "checkpoint-restore-failure");
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, "one.txt"), "one\n");
        fs.writeFileSync(path.join(root, "two.txt"), "two\n");
        const deleted = await run("fs_delete", {
            path: "checkpoint-restore-failure",
            recursive: true
        });
        assert.equal(fs.existsSync(root), false);

        const AtomicFile = require("../../../agent/persistence/AtomicFile");
        const originalWriteFile = AtomicFile.writeFile;
        let writes = 0;
        AtomicFile.writeFile = (...args) => {
            writes++;
            if (writes === 2) throw new Error("injected restore failure");
            return originalWriteFile(...args);
        };
        try {
            await rejects(
                run("checkpoint_undo", { checkpoint_id: deleted.checkpoint_id }),
                /injected restore failure/
            );
        } finally {
            AtomicFile.writeFile = originalWriteFile;
        }
        assert.equal(fs.existsSync(root), false, "partial restore escaped rollback");

        await run("checkpoint_undo", { checkpoint_id: deleted.checkpoint_id });
        assert.equal(fs.readFileSync(path.join(root, "one.txt"), "utf8"), "one\n");
        assert.equal(fs.readFileSync(path.join(root, "two.txt"), "utf8"), "two\n");

    });


    await test("undo restores a deleted external symlink without following it", async () => {

        const externalTarget = path.join(os.tmpdir(), `checkpoint-external-${process.pid}.txt`);
        const linkPath = path.join(WORKSPACE, "checkpoint-external-link");
        fs.writeFileSync(externalTarget, "outside remains untouched\n");
        fs.symlinkSync(externalTarget, linkPath);

        const deleted = await run("fs_delete", { path: "checkpoint-external-link" });
        assert.equal(fs.existsSync(linkPath), false);
        assert.equal(fs.readFileSync(externalTarget, "utf8"), "outside remains untouched\n");

        await run("checkpoint_undo", { checkpoint_id: deleted.checkpoint_id });
        assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
        assert.equal(fs.readlinkSync(linkPath), externalTarget);
        assert.equal(fs.readFileSync(externalTarget, "utf8"), "outside remains untouched\n");
        fs.unlinkSync(linkPath);
        fs.unlinkSync(externalTarget);

    });


    await test("fs_delete requires recursive for directories", async () => {

        await rejects(
            run("fs_delete", { path: "a" }),
            /Set recursive/
        );

        const deleted =
            await run("fs_delete", {
                path: "a",
                recursive: true
            });

        assert.equal(deleted.deleted, true);
    });

    await test("fs_info returns full metadata for a text file", async () => {

        await run("fs_write", {
            path: "meta.txt",
            content: "alpha beta\ngamma\n\ndelta\n"
        });

        const info =
            await run("fs_info", { path: "meta.txt" });

        assert.equal(info.type, "file");
        assert.equal(info.extension, ".txt");
        assert.equal(info.mime_type, "text/plain");
        assert.equal(info.size_bytes, 24);
        assert.equal(info.size_human, "24 B");

        assert.equal(info.content.binary, false);
        assert.equal(info.content.encoding, "utf-8");
        assert.equal(info.content.lines, 4);
        assert.equal(info.content.blank_lines, 1);
        assert.equal(info.content.words, 4);
        assert.equal(info.content.characters, 24);
        assert.equal(info.content.line_ending, "lf");
        assert.equal(info.content.ends_with_newline, true);
        assert.equal(info.content.longest_line_length, 10);

        assert.equal(info.hash.algorithm, "sha256");
        assert.match(info.hash.value, /^[a-f0-9]{64}$/);

        assert.ok(info.timestamps.created);
        assert.ok(info.timestamps.modified);
        assert.ok(info.timestamps.metadata_changed);
        assert.match(info.permissions.mode, /^[0-7]{3}$/);
        assert.equal(typeof info.ownership.uid, "number");
        assert.equal(typeof info.filesystem.inode, "number");
    });

    await test("fs_info detects CRLF, BOM and missing trailing newline", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, "crlf.txt"),
            Buffer.concat([
                Buffer.from([0xef, 0xbb, 0xbf]),
                Buffer.from("one\r\ntwo")
            ])
        );

        const info =
            await run("fs_info", { path: "crlf.txt" });

        assert.equal(info.content.line_ending, "crlf");
        assert.equal(info.content.has_bom, true);
        assert.equal(info.content.encoding, "utf-8-bom");
        assert.equal(info.content.lines, 2);
        assert.equal(info.content.ends_with_newline, false);
    });

    await test("fs_info reports binary files without text metrics", async () => {

        const info =
            await run("fs_info", { path: "blob.bin" });

        assert.equal(info.content.binary, true);
        assert.equal(info.content.encoding, null);
        assert.match(info.hash.value, /^[a-f0-9]{64}$/);
    });

    await test("fs_info summarises a directory", async () => {

        const info =
            await run("fs_info", { path: "src" });

        assert.equal(info.type, "directory");
        assert.ok(info.directory.files >= 1);
        assert.ok(info.directory.total_size_bytes > 0);
        assert.equal(info.content, undefined);
    });

    await test("fs_info can skip the hash and include a preview", async () => {

        const info =
            await run("fs_info", {
                path: "meta.txt",
                include_hash: false,
                include_preview: true,
                preview_lines: 1
            });

        assert.equal(info.hash, undefined);
        assert.equal(info.preview.head, "alpha beta");
    });

    await test("fs_info respects the workspace boundary", async () => {

        await rejects(
            run("fs_info", { path: "../../etc/passwd" }),
            /outside workspace/
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nworkspace boundary");

    await test("paths outside the workspace are rejected", async () => {

        await rejects(
            run("fs_read", { path: "../../etc/passwd" }),
            /outside workspace/
        );
    });

    await test("symlinks cannot escape the workspace", async () => {

        fs.symlinkSync(
            "/etc",
            path.join(WORKSPACE, "escape")
        );

        await rejects(
            run("fs_read", { path: "escape/passwd" }),
            /escapes the workspace/
        );
    });

    await test("the workspace root cannot be deleted", async () => {

        await rejects(
            run("fs_delete", { path: ".", recursive: true }),
            /workspace root cannot be deleted/
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nsearch");

    await test("search_start finds content and returns inline", async () => {

        const result =
            await run("search_start", {
                path: ".",
                query: "line2",
                wait_ms: 4000
            });

        assert.equal(result.status, "completed");
        assert.ok(result.results.length >= 1);
        assert.equal(result.results[0].line, 2);
    });

    await test("search_start honours file_pattern and files mode", async () => {

        const result =
            await run("search_start", {
                path: ".",
                query: "app",
                mode: "files",
                file_pattern: "*.js",
                wait_ms: 4000
            });

        assert.equal(result.results.length, 1);
        assert.match(result.results[0].path, /app\.js$/);
    });

    await test("search_list and search_stop manage sessions", async () => {

        const started =
            await run("search_start", {
                path: ".",
                query: "line",
                wait_ms: 4000
            });

        const list = await run("search_list", {});

        assert.ok(list.count >= 1);

        const stopped =
            await run("search_stop", {
                search_id: started.search_id
            });

        assert.ok(
            ["completed", "stopped"].includes(stopped.status)
        );

        const fetched =
            await run("search_get", {
                search_id: started.search_id
            });

        assert.equal(
            fetched.search_id,
            started.search_id
        );
    });

    await test("search_get rejects an unknown id", async () => {

        await rejects(
            run("search_get", { search_id: "nope" }),
            /Unknown search/
        );
    });
};
