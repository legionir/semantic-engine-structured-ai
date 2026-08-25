const fs = require("fs");
const path = require("path");

const settings = require("../lib/storage");

const {
    ignoredDirectories
} = require("../lib/workspace");

const ToolContext = require("./ToolContext");


/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/



function looksBinary(buffer) {

    const probe =
        buffer.subarray(
            0,
            Math.min(
                buffer.length,
                settings.get("BINARY_PROBE_BYTES")
            )
        );

    return probe.includes(0);
}


function describeEntry(entry) {

    if (entry.isDirectory()) {
        return "directory";
    }

    if (entry.isSymbolicLink()) {
        return "symlink";
    }

    if (entry.isFile()) {
        return "file";
    }

    return "other";
}


async function statSafe(target) {

    try {

        return await fs.promises.stat(target);

    } catch {

        return null;
    }
}


/*
|--------------------------------------------------------------------------
| fs_read
|--------------------------------------------------------------------------
*/

async function fsRead(args, context) {

    const ctx = ToolContext.from(context);


    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );

    const stats =
        await fs.promises.stat(target);

    if (stats.isDirectory()) {

        throw new Error(
            `Path is a directory, use fs_list: ${args.path}`
        );
    }

    const buffer =
        await fs.promises.readFile(target);

    if (looksBinary(buffer)) {

        return {
            path:
                ctx.relative(target),

            binary: true,

            size_bytes:
                stats.size,

            content: null,

            note:
                "Binary file. Read it with a terminal command if inspection is required."
        };
    }

    const text =
        buffer.toString("utf8");

    const lines =
        text.split("\n");

    const totalLines =
        lines.length;

    let startLine = 0;
    let endLine = totalLines;

    if (Number.isInteger(args.tail)) {

        startLine =
            Math.max(
                0,
                totalLines - args.tail
            );

    } else {

        if (Number.isInteger(args.offset)) {

            startLine =
                Math.max(0, args.offset);
        }

        if (Number.isInteger(args.limit)) {

            endLine =
                Math.min(
                    totalLines,
                    startLine + args.limit
                );
        }
    }

    const selected =
        lines.slice(startLine, endLine);

    return {
        path:
            ctx.relative(target),

        binary: false,

        size_bytes:
            stats.size,

        total_lines:
            totalLines,

        start_line:
            startLine,

        end_line:
            endLine,

        partial:
            startLine !== 0 ||
            endLine !== totalLines,

        content:
            selected.join("\n")
    };
}


/*
|--------------------------------------------------------------------------
| fs_read_many
|--------------------------------------------------------------------------
*/

async function fsReadMany(args, context) {

    const ctx = ToolContext.from(context);


    const paths =
        Array.isArray(args.paths)
            ? args.paths
            : [];

    if (paths.length === 0) {

        throw new Error(
            "paths must contain at least one file."
        );
    }

    const files =
        await Promise.all(
            paths.map(
                async item => {

                    try {

                        const result =
                            await fsRead({
                                path: item,

                                offset:
                                    args.offset,

                                limit:
                                    args.limit
                            });

                        return {
                            ...result,
                            success: true
                        };

                    } catch (error) {

                        return {
                            path: item,
                            success: false,
                            error: error.message
                        };
                    }
                }
            )
        );

    return {
        requested:
            paths.length,

        succeeded:
            files.filter(
                file => file.success
            ).length,

        files
    };
}


/*
|--------------------------------------------------------------------------
| fs_list
|--------------------------------------------------------------------------
*/

async function fsList(args, context) {

    const ctx = ToolContext.from(context);


    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );

    const entries =
        await fs.promises.readdir(
            target,
            {
                withFileTypes: true
            }
        );

    const detailed =
        await Promise.all(
            entries.map(
                async entry => {

                    const type =
                        describeEntry(entry);

                    const record = {
                        name:
                            entry.name,

                        type
                    };

                    if (args.include_sizes) {

                        const stats =
                            await statSafe(
                                path.join(
                                    target,
                                    entry.name
                                )
                            );

                        record.size_bytes =
                            stats && stats.isFile()
                                ? stats.size
                                : null;

                        record.modified =
                            stats
                                ? stats.mtime.toISOString()
                                : null;
                    }

                    return record;
                }
            )
        );

    const sorted =
        args.sort_by === "size"
            ? detailed.sort(
                (a, b) =>
                    (b.size_bytes || 0) -
                    (a.size_bytes || 0)
            )
            : detailed.sort(
                (a, b) => {

                    if (a.type !== b.type) {

                        return a.type === "directory"
                            ? -1
                            : 1;
                    }

                    return a.name.localeCompare(b.name);
                }
            );

    return {
        path:
            ctx.relative(target),

        count:
            sorted.length,

        entries:
            sorted
    };
}


/*
|--------------------------------------------------------------------------
| fs_tree
|--------------------------------------------------------------------------
*/

async function fsTree(args, context) {

    const ctx = ToolContext.from(context);


    const root =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );

    const maxDepth =
        Number.isInteger(args.max_depth)
            ? args.max_depth
            : 3;

    const excluded =
        new Set([
            ...ignoredDirectories(),

            ...(Array.isArray(args.exclude)
                ? args.exclude
                : [])
        ]);

    const includeFiles =
        args.include_files !== false;

    let directories = 0;
    let files = 0;
    let truncated = false;

    async function walk(current, depth) {

        if (depth >= maxDepth) {

            truncated = true;

            return null;
        }

        const entries =
            await fs.promises.readdir(
                current,
                {
                    withFileTypes: true
                }
            );

        const children = [];

        for (const entry of entries) {

            if (
                entry.isDirectory() &&
                excluded.has(entry.name)
            ) {
                continue;
            }

            if (entry.isDirectory()) {

                directories++;

                children.push({
                    name:
                        entry.name,

                    type:
                        "directory",

                    children:
                        await walk(
                            path.join(
                                current,
                                entry.name
                            ),
                            depth + 1
                        )
                });

                continue;
            }

            if (
                includeFiles &&
                entry.isFile()
            ) {

                files++;

                children.push({
                    name:
                        entry.name,

                    type:
                        "file"
                });
            }
        }

        return children;
    }

    const tree =
        await walk(root, 0);

    return {
        path:
            ctx.relative(root),

        max_depth:
            maxDepth,

        directories,

        files,

        depth_truncated:
            truncated,

        tree
    };
}


/*
|--------------------------------------------------------------------------
| fs_stat
|--------------------------------------------------------------------------
*/

async function fsStat(args, context) {

    const ctx = ToolContext.from(context);


    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );

    ctx.assertSafe(target, { rejectSymlinks: true });

    const stats =
        await fs.promises.lstat(target);

    const isSymlink =
        stats.isSymbolicLink();

    const effective =
        isSymlink
            ? await fs.promises.stat(target)
            : stats;

    return {
        path:
            ctx.relative(target),

        type:
            effective.isDirectory()
                ? "directory"
                : effective.isFile()
                    ? "file"
                    : "other",

        is_symlink:
            isSymlink,

        size_bytes:
            effective.size,

        created:
            effective.birthtime.toISOString(),

        modified:
            effective.mtime.toISOString(),

        accessed:
            effective.atime.toISOString(),

        mode:
            (effective.mode & 0o777)
                .toString(8)
                .padStart(3, "0")
    };
}


/*
|--------------------------------------------------------------------------
| fs_roots
|--------------------------------------------------------------------------
*/

async function fsRoots(args, context) {

    const ctx = ToolContext.from(context);


    return {
        allowed_directories: [
            ctx.root
        ],

        note:
            "All filesystem tools resolve relative paths against this root and reject paths outside it, including through symlinks."
    };
}


/*
|--------------------------------------------------------------------------
| fs_write
|--------------------------------------------------------------------------
*/

async function fsWrite(args, context) {

    const ctx = ToolContext.from(context);


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

    const ctx = ToolContext.from(context);


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


/*
|--------------------------------------------------------------------------
| fs_mkdir
|--------------------------------------------------------------------------
*/

async function fsMkdir(args, context) {

    const ctx = ToolContext.from(context);


    const target =
        ctx.resolvePath(args.path);
    ctx.assertSafe(target, { rejectSymlinks: true });

    const existed =
        fs.existsSync(target);

    await fs.promises.mkdir(
        target,
        {
            recursive: true
        }
    );

    return {
        path:
            ctx.relative(target),

        created:
            !existed
    };
}


/*
|--------------------------------------------------------------------------
| fs_move
|--------------------------------------------------------------------------
*/

async function fsMove(args, context) {

    const ctx = ToolContext.from(context);


    const source =
        ctx.resolvePath(
            args.source,
            {
                mustExist: true
            }
        );

    const destination =
        ctx.resolvePath(args.destination);
    ctx.assertSafe(source, { rejectSymlinks: true });
    ctx.assertSafe(destination, { rejectSymlinks: true });

    if (
        fs.existsSync(destination) &&
        args.overwrite !== true
    ) {

        throw new Error(
            `Destination already exists: ${args.destination}. Set overwrite to replace it.`
        );
    }

    await fs.promises.mkdir(
        path.dirname(destination),
        {
            recursive: true
        }
    );

    await fs.promises.rename(
        source,
        destination
    );

    return {
        source:
            ctx.relative(source),

        destination:
            ctx.relative(destination),

        overwritten:
            args.overwrite === true
    };
}


/*
|--------------------------------------------------------------------------
| fs_delete
|--------------------------------------------------------------------------
*/

async function fsDelete(args, context) {

    const ctx = ToolContext.from(context);


    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );

    if (target === ctx.root) {

        throw new Error(
            "The workspace root cannot be deleted."
        );
    }

    const stats =
        await fs.promises.lstat(target);

    if (
        stats.isDirectory() &&
        args.recursive !== true
    ) {

        throw new Error(
            `Path is a directory: ${args.path}. Set recursive to delete it.`
        );
    }

    await fs.promises.rm(
        target,
        {
            recursive:
                args.recursive === true,

            force: false
        }
    );

    return {
        path:
            ctx.relative(target),

        deleted: true,

        was_directory:
            stats.isDirectory()
    };
}


module.exports = {
    fs_read: fsRead,
    fs_read_many: fsReadMany,
    fs_list: fsList,
    fs_tree: fsTree,
    fs_stat: fsStat,
    fs_roots: fsRoots,
    fs_write: fsWrite,
    fs_edit: fsEdit,
    fs_mkdir: fsMkdir,
    fs_move: fsMove,
    fs_delete: fsDelete
};
