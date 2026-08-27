"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const settings = require("../../lib/storage");

const PathBoundary = require("./PathBoundary");


/*
|--------------------------------------------------------------------------
| fs_stat
|--------------------------------------------------------------------------
*/

async function fsStat(args, context) {

    const ctx = PathBoundary.bound(context);


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
| Detailed File Information
|--------------------------------------------------------------------------
|
| fs_stat answers "what is this path" with a single cheap lstat.
| fs_info answers "tell me everything about this file", including metrics
| that can only be derived by reading the content: line and character
| counts, encoding, line endings, and a content hash.
|--------------------------------------------------------------------------
*/


const MIME_TYPES = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".cjs": "application/javascript",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".jsx": "application/javascript",
    ".json": "application/json",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".html": "text/html",
    ".css": "text/css",
    ".yml": "application/yaml",
    ".yaml": "application/yaml",
    ".xml": "application/xml",
    ".csv": "text/csv",
    ".sh": "application/x-sh",
    ".py": "text/x-python",
    ".go": "text/x-go",
    ".rs": "text/x-rust",
    ".java": "text/x-java",
    ".php": "application/x-php",
    ".sql": "application/sql",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};


function humanSize(bytes) {

    const units = ["B", "KB", "MB", "GB", "TB"];

    let value = bytes;
    let unit = 0;

    while (
        value >= 1024 &&
        unit < units.length - 1
    ) {

        value /= 1024;
        unit++;
    }

    return `${
        unit === 0
            ? value
            : value.toFixed(1)
    } ${units[unit]}`;
}


function detectMimeType(filePath) {

    return MIME_TYPES[
        path.extname(filePath).toLowerCase()
    ] || null;
}


function hashFile(target) {

    return new Promise((resolve, reject) => {

        const hash =
            crypto.createHash("sha256");

        const stream =
            fs.createReadStream(target);

        stream.on("error", reject);

        stream.on(
            "data",
            chunk => hash.update(chunk)
        );

        stream.on(
            "end",
            () => resolve(hash.digest("hex"))
        );
    });
}


function analyseText(buffer) {

    const hasBom =
        buffer.length >= 3 &&
        buffer[0] === 0xef &&
        buffer[1] === 0xbb &&
        buffer[2] === 0xbf;

    const text =
        buffer.toString(
            "utf8",
            hasBom
                ? 3
                : 0
        );

    const crlfCount =
        (text.match(/\r\n/g) || []).length;

    const lfCount =
        (text.match(/(?<!\r)\n/g) || []).length;

    const lineEnding =
        crlfCount > 0 && lfCount > 0
            ? "mixed"
            : crlfCount > 0
                ? "crlf"
                : lfCount > 0
                    ? "lf"
                    : "none";

    const normalised =
        text.replace(/\r\n/g, "\n");

    const lines =
        normalised.split("\n");

    const endsWithNewline =
        normalised.endsWith("\n");

    /*
    | A trailing newline terminates the last line rather than starting
    | a new one, which is how wc counts lines.
    */

    const lineCount =
        endsWithNewline
            ? lines.length - 1
            : lines.length;

    let longestLine = 0;
    let blankLines = 0;

    for (
        let index = 0;
        index < lineCount;
        index++
    ) {

        const line = lines[index];

        longestLine =
            Math.max(longestLine, line.length);

        if (line.trim() === "") {
            blankLines++;
        }
    }

    const words =
        normalised
            .split(/\s+/)
            .filter(Boolean).length;

    return {
        binary: false,

        encoding:
            hasBom
                ? "utf-8-bom"
                : "utf-8",

        has_bom: hasBom,

        characters:
            text.length,

        characters_without_whitespace:
            text.replace(/\s/g, "").length,

        words,

        lines: lineCount,

        blank_lines: blankLines,

        longest_line_length: longestLine,

        line_ending: lineEnding,

        ends_with_newline: endsWithNewline
    };
}


async function summariseDirectory(root, maxDepth) {

    let files = 0;
    let directories = 0;
    let totalBytes = 0;
    let deepest = 0;
    let truncated = false;

    async function walk(current, depth) {

        if (depth > maxDepth) {

            truncated = true;

            return;
        }

        deepest = Math.max(deepest, depth);

        let entries;

        try {

            entries =
                await fs.promises.readdir(
                    current,
                    {
                        withFileTypes: true
                    }
                );

        } catch {

            return;
        }

        for (const entry of entries) {

            const fullPath =
                path.join(current, entry.name);

            if (entry.isDirectory()) {

                if (
                    PathBoundary.ignoredDirectories().includes(
                        entry.name
                    )
                ) {
                    continue;
                }

                directories++;

                await walk(fullPath, depth + 1);

                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            files++;

            try {

                const stats =
                    await fs.promises.stat(fullPath);

                totalBytes += stats.size;

            } catch {

                /* the entry disappeared while walking */
            }
        }
    }

    await walk(root, 0);

    return {
        files,

        directories,

        total_size_bytes:
            totalBytes,

        total_size_human:
            humanSize(totalBytes),

        deepest_level:
            deepest,

        depth_truncated:
            truncated
    };
}


async function fsInfo(args, context) {

    const ctx = PathBoundary.bound(context);


    const target =
        ctx.resolvePath(
            args.path,
            {
                mustExist: true
            }
        );

    const linkStats =
        await fs.promises.lstat(target);

    const isSymlink =
        linkStats.isSymbolicLink();

    const stats =
        isSymlink
            ? await fs.promises.stat(target)
            : linkStats;

    const info = {
        path:
            ctx.relative(target),

        absolute_path:
            target,

        name:
            path.basename(target),

        extension:
            path.extname(target) || null,

        type:
            stats.isDirectory()
                ? "directory"
                : stats.isFile()
                    ? "file"
                    : "other",

        mime_type:
            stats.isFile()
                ? detectMimeType(target)
                : null,

        is_symlink:
            isSymlink,

        symlink_target:
            isSymlink
                ? await fs.promises.readlink(target)
                : null,

        size_bytes:
            stats.size,

        size_human:
            humanSize(stats.size),

        timestamps: {
            created:
                stats.birthtime.toISOString(),

            modified:
                stats.mtime.toISOString(),

            accessed:
                stats.atime.toISOString(),

            metadata_changed:
                stats.ctime.toISOString(),

            age_seconds:
                Math.round(
                    (Date.now() - stats.mtime.getTime()) / 1000
                )
        },

        permissions: {
            mode:
                (stats.mode & 0o777)
                    .toString(8)
                    .padStart(3, "0"),

            readable:
                Boolean(stats.mode & 0o400),

            writable:
                Boolean(stats.mode & 0o200),

            executable:
                Boolean(stats.mode & 0o100)
        },

        ownership: {
            uid:
                stats.uid,

            gid:
                stats.gid
        },

        filesystem: {
            inode:
                stats.ino,

            hard_links:
                stats.nlink,

            device:
                stats.dev,

            block_size:
                stats.blksize,

            blocks:
                stats.blocks
        }
    };

    if (info.type === "directory") {

        info.directory =
            await summariseDirectory(
                target,

                Number.isInteger(args.max_depth)
                    ? args.max_depth
                    : 10
            );

        return info;
    }

    if (info.type !== "file") {
        return info;
    }

    const buffer =
        await fs.promises.readFile(target);

    const isBinary =
        buffer
            .subarray(0, 8192)
            .includes(0);

    info.content =
        isBinary
            ? {
                binary: true,

                encoding: null,

                note:
                    "Binary content, text metrics are not available."
            }
            : analyseText(buffer);

    if (args.include_hash !== false) {

        info.hash =
            stats.size > settings.get("MAX_HASH_BYTES")
                ? {
                    algorithm: "sha256",

                    value: null,

                    skipped_reason:
                        `File is larger than the ${settings.get("MAX_HASH_BYTES")} byte hashing limit.`
                }
                : {
                    algorithm: "sha256",

                    value:
                        await hashFile(target)
                };
    }

    if (
        args.include_preview === true &&
        !isBinary
    ) {

        const previewLines =
            Number.isInteger(args.preview_lines)
                ? args.preview_lines
                : 5;

        const lines =
            buffer
                .toString("utf8")
                .split("\n");

        info.preview = {
            lines:
                previewLines,

            head:
                lines
                    .slice(0, previewLines)
                    .join("\n"),

            tail:
                lines
                    .slice(-previewLines)
                    .join("\n")
        };
    }

    return info;
}


module.exports = {
    fs_stat: fsStat,
    fs_info: fsInfo
};
