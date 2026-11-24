"use strict";

const fs = require("fs");

const PathBoundary = require("./PathBoundary");


/*
|--------------------------------------------------------------------------
| fs_read
|--------------------------------------------------------------------------
*/

async function fsRead(args, context) {

    const ctx = PathBoundary.bound(context);


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

    if (PathBoundary.looksBinary(buffer)) {

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

    const ctx = PathBoundary.bound(context);


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

                        /* the caller's context MUST be passed on: without it every item
                           was read in the default project (audit F-009) */
                        const result =
                            await fsRead(
                                {
                                    path: item,

                                    offset:
                                        args.offset,

                                    limit:
                                        args.limit
                                },
                                context
                            );

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


module.exports = {
    fs_read: fsRead,
    fs_read_many: fsReadMany
};
