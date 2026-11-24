"use strict";

const fs = require("fs");
const path = require("path");

const PathBoundary = require("./PathBoundary");
const checkpoints = require("../../persistence/FileCheckpointRepository");

const {
    lexists
} = require("../../context/WorkspaceBoundary");


/*
| Removes a symlink itself. A Windows directory symlink or junction
| refuses unlink and is removed with rmdir, which deletes only the link
| and never the directory it points to.
*/

async function removeLink(target) {

    try {

        await fs.promises.unlink(target);

    } catch (error) {

        if (
            error.code !== "EPERM" &&
            error.code !== "EISDIR"
        ) {
            throw error;
        }

        await fs.promises.rmdir(target);
    }
}


/*
|--------------------------------------------------------------------------
| fs_list
|--------------------------------------------------------------------------
*/

async function fsList(args, context) {

    const ctx = PathBoundary.bound(context);


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
                        PathBoundary.describeEntry(entry);

                    const record = {
                        name:
                            entry.name,

                        type
                    };

                    if (args.include_sizes) {

                        const stats =
                            await PathBoundary.statSafe(
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

    const ctx = PathBoundary.bound(context);


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
            ...PathBoundary.ignoredDirectories(),

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
| fs_roots
|--------------------------------------------------------------------------
*/

async function fsRoots(args, context) {

    const ctx = PathBoundary.bound(context);


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
| fs_mkdir
|--------------------------------------------------------------------------
*/

async function fsMkdir(args, context) {

    const ctx = PathBoundary.bound(context);


    const target =
        ctx.resolvePath(args.path);
    ctx.assertSafe(target, { rejectSymlinks: true });

    const existed =
        fs.existsSync(target);

    if (existed) {
        return {
            path: ctx.relative(target),
            created: false
        };
    }

    const checkpoint = checkpoints.createCheckpoint(
        checkpoints.withMissingParents(target, ctx),
        ctx,
        "before fs_mkdir"
    );

    await fs.promises.mkdir(
        target,
        {
            recursive: true
        }
    );

    return {
        path:
            ctx.relative(target),

        created: true,

        checkpoint_id: checkpoint.checkpoint_id
    };
}


/*
|--------------------------------------------------------------------------
| fs_move
|--------------------------------------------------------------------------
*/

async function fsMove(args, context) {

    const ctx = PathBoundary.bound(context);


    /*
    | Both ends are resolved without following their last segment, so
    | moving a symlink moves the link itself, never the file or directory
    | it points to (P0-3). Their parents must still be free of symlinks.
    */

    const source =
        ctx.resolvePath(
            args.source,
            {
                mustExist: true,
                noFollow: true
            }
        );

    const destination =
        ctx.resolvePath(
            args.destination,
            {
                noFollow: true
            }
        );

    if (source === ctx.root) {

        throw new Error(
            "The workspace root cannot be moved."
        );
    }

    ctx.assertSafe(path.dirname(source), { rejectSymlinks: true });
    ctx.assertSafe(destination, { rejectSymlinks: true });

    if (
        lexists(destination) &&
        args.overwrite !== true
    ) {

        throw new Error(
            `Destination already exists: ${args.destination}. Set overwrite to replace it.`
        );
    }

    const checkpoint = checkpoints.createCheckpoint(
        [
            source,
            ...checkpoints.withMissingParents(destination, ctx)
        ],
        ctx,
        "before fs_move"
    );

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
            args.overwrite === true,

        checkpoint_id:
            checkpoint.checkpoint_id
    };
}


/*
|--------------------------------------------------------------------------
| fs_delete
|--------------------------------------------------------------------------
*/

async function fsDelete(args, context) {

    const ctx = PathBoundary.bound(context);


    /* noFollow: deleting a symlink deletes the link, not its target (P0-3). */
    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true,
                noFollow: true
            }
        );

    if (target === ctx.root) {

        throw new Error(
            "The workspace root cannot be deleted."
        );
    }

    const stats =
        await fs.promises.lstat(target);

    if (stats.isSymbolicLink()) {

        const checkpoint = checkpoints.createCheckpoint(
            [target],
            ctx,
            "before fs_delete"
        );
        await removeLink(target);

        return {
            path:
                ctx.relative(target),

            deleted: true,

            was_directory: false,

            was_symlink: true,

            checkpoint_id: checkpoint.checkpoint_id
        };
    }

    if (
        stats.isDirectory() &&
        args.recursive !== true
    ) {

        throw new Error(
            `Path is a directory: ${args.path}. Set recursive to delete it.`
        );
    }

    const checkpoint = checkpoints.createCheckpoint(
        [target],
        ctx,
        "before fs_delete"
    );

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
            stats.isDirectory(),

        checkpoint_id: checkpoint.checkpoint_id
    };
}


module.exports = {
    fs_list: fsList,
    fs_tree: fsTree,
    fs_roots: fsRoots,
    fs_mkdir: fsMkdir,
    fs_move: fsMove,
    fs_delete: fsDelete
};
