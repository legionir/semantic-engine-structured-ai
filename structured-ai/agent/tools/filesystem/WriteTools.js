"use strict";

const fs = require("fs");
const path = require("path");

const settings = require("../../lib/storage");

const PathBoundary = require("./PathBoundary");


/*
|--------------------------------------------------------------------------
| fs_write
|--------------------------------------------------------------------------
*/

async function fsWrite(args, context) {

    const ctx = PathBoundary.bound(context);


    if (typeof args.content !== "string") {

        throw new Error(
            "content must be a string."
        );
    }

    const target =
        ctx.resolvePath(args.path);
    ctx.assertSafe(target, { rejectSymlinks: true });

    const mode =
        args.mode === "append"
            ? "append"
            : "overwrite";

    if (args.create_parents !== false) {

        await fs.promises.mkdir(
            path.dirname(target),
            {
                recursive: true
            }
        );
    }

    const existed =
        fs.existsSync(target);

    /*
    | Overwriting a file the agent did not write is the operation most
    | likely to destroy work quietly: a model regenerating package.json
    | from memory can drop half of it and the result still reads "ok".
    | The previous content is measured first so the result can say what
    | the write actually did.
    */

    let previous = null;

    if (existed && mode === "overwrite") {

        try {

            previous =
                await fs.promises.readFile(target, "utf8");

        } catch {

            /* binary or unreadable: the write is still allowed */
        }
    }

    if (mode === "append") {

        await fs.promises.appendFile(
            target,
            args.content,
            "utf8"
        );

    } else {

        await fs.promises.writeFile(
            target,
            args.content,
            "utf8"
        );
    }

    const stats =
        await fs.promises.stat(target);

    const result = {
        path:
            ctx.relative(target),

        mode,

        created:
            !existed,

        bytes_written:
            Buffer.byteLength(
                args.content,
                "utf8"
            ),

        size_bytes:
            stats.size
    };

    if (previous !== null) {

        const before =
            previous.split("\n");

        const after =
            args.content.split("\n");

        const kept =
            new Set(after);

        result.replaced = {
            previous_bytes:
                Buffer.byteLength(previous, "utf8"),

            previous_lines:
                before.length,

            lines: after.length,

            lines_removed:
                before.filter(
                    line => line.trim() !== "" && !kept.has(line)
                ).length
        };

        const hintAt =
            settings.get("WRITE_EDIT_HINT_BYTES");

        /*
        | Rewriting a large existing file from memory is how a model
        | silently drops half a config. The write still happens, and the
        | result names the tool that would not have risked it.
        */

        if (
            hintAt > 0 &&
            result.replaced.previous_bytes >= hintAt
        ) {

            result.hint =
                `${result.path} already had ${
                    result.replaced.previous_bytes
                } bytes and was replaced wholesale. For a change to part of a file, fs_edit replaces an exact block and fails when the block is not found, which a full rewrite cannot do.`;
        }

        const shrank =
            result.replaced.previous_bytes > 0
                ? 1 - result.bytes_written / result.replaced.previous_bytes
                : 0;

        if (
            shrank >=
            settings.get("WRITE_SHRINK_WARNING")
        ) {

            result.warning =
                `This overwrite removed ${
                    Math.round(shrank * 100)
                }% of ${result.path} (${
                    result.replaced.previous_bytes
                } bytes to ${
                    result.bytes_written
                } bytes). If that was not intended, read the file and write it back complete, or use fs_edit for a targeted change.`;
        }
    }

    return result;
}


/*
|--------------------------------------------------------------------------
| fs_edit
|--------------------------------------------------------------------------
*/

async function fsEdit(args, context) {

    const ctx = PathBoundary.bound(context);


    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );
    ctx.assertSafe(target, { rejectSymlinks: true });

    if (typeof args.old_text !== "string") {

        throw new Error(
            "old_text must be a string."
        );
    }

    if (typeof args.new_text !== "string") {

        throw new Error(
            "new_text must be a string."
        );
    }

    if (args.old_text === "") {

        throw new Error(
            "old_text must not be empty."
        );
    }

    const content =
        await fs.promises.readFile(
            target,
            "utf8"
        );

    const occurrences =
        content.split(args.old_text).length - 1;

    const expected =
        Number.isInteger(args.expected_replacements)
            ? args.expected_replacements
            : 1;

    if (occurrences === 0) {

        throw new Error(
            "old_text was not found in the target file."
        );
    }

    /*
    | An ambiguous match is refused instead of silently editing the
    | first occurrence.
    */

    if (occurrences !== expected) {

        throw new Error(
            `old_text matched ${occurrences} times but expected_replacements is ${expected}. Provide more context or set expected_replacements.`
        );
    }

    const updated =
        content.split(args.old_text)
            .join(args.new_text);

    await fs.promises.writeFile(
        target,
        updated,
        "utf8"
    );

    return {
        path:
            ctx.relative(target),

        replacements:
            occurrences,

        size_bytes:
            Buffer.byteLength(updated, "utf8")
    };
}


module.exports = {
    fs_write: fsWrite,
    fs_edit: fsEdit
};
