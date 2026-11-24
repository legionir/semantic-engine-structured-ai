"use strict";

const fs = require("fs");
const path = require("path");

const PathBoundary = require("./PathBoundary");
const settings = require("../../config");
const checkpoints = require("../../persistence/FileCheckpointRepository");
const AtomicFile = require("../../persistence/AtomicFile");


function patchPath(header) {

    const raw = header.slice(4).split("\t", 1)[0].trim();
    if (raw === "/dev/null") return raw;
    if (raw.startsWith("a/") || raw.startsWith("b/")) return raw.slice(2);
    return raw;
}


function parseUnifiedPatch(patch) {

    if (typeof patch !== "string" || patch.trim() === "") {
        throw new Error("patch must be a non-empty unified diff.");
    }

    const lines = patch.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const files = [];
    let index = 0;

    while (index < lines.length) {
        if (lines[index] === "") {
            index++;
            continue;
        }
        if (!lines[index].startsWith("--- ")) {
            throw new Error(`Expected a unified diff file header at patch line ${index + 1}.`);
        }

        const oldPath = patchPath(lines[index++]);
        if (index >= lines.length || !lines[index].startsWith("+++ ")) {
            throw new Error("Unified diff is missing its +++ file header.");
        }
        const newPath = patchPath(lines[index++]);
        if (oldPath === "/dev/null" && newPath === "/dev/null") {
            throw new Error("A patch file header cannot use /dev/null for both paths.");
        }
        const operation = oldPath === "/dev/null"
            ? "add"
            : newPath === "/dev/null"
                ? "delete"
                : "modify";
        const filePath = operation === "add" ? newPath : oldPath;
        if (operation === "modify" && oldPath !== newPath) {
            throw new Error(`Rename patches are not supported (${oldPath} -> ${newPath}). Use fs_move.`);
        }

        const hunks = [];
        while (index < lines.length && lines[index].startsWith("@@ ")) {
            const header = lines[index++];
            const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(header);
            if (!match) throw new Error(`Malformed unified diff hunk header: ${header}`);
            const hunk = {
                oldStart: Number(match[1]),
                oldCount: match[2] === undefined ? 1 : Number(match[2]),
                newStart: Number(match[3]),
                newCount: match[4] === undefined ? 1 : Number(match[4]),
                rows: []
            };
            let oldSeen = 0;
            let newSeen = 0;
            let changed = false;

            while (
                index < lines.length &&
                (oldSeen < hunk.oldCount || newSeen < hunk.newCount)
            ) {
                const row = lines[index++];
                if (row.startsWith("\\ No newline at end of file")) {
                    if (hunk.rows.length === 0) throw new Error("Misplaced no-newline marker in unified diff.");
                    hunk.rows[hunk.rows.length - 1].noNewline = true;
                    continue;
                }
                const kind = row[0];
                if (kind !== " " && kind !== "+" && kind !== "-") {
                    throw new Error(`Malformed hunk row at patch line ${index}.`);
                }
                hunk.rows.push({ kind, text: row.slice(1) });
                if (kind === " " || kind === "-") oldSeen++;
                if (kind === " " || kind === "+") newSeen++;
                if (kind !== " ") changed = true;
                if (oldSeen > hunk.oldCount || newSeen > hunk.newCount) {
                    throw new Error(`Hunk line counts do not match header: ${header}`);
                }
            }

            if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount || !changed) {
                throw new Error(`Incomplete or empty unified diff hunk: ${header}`);
            }
            while (index < lines.length && lines[index].startsWith("\\ No newline at end of file")) {
                if (hunk.rows.length === 0) throw new Error("Misplaced no-newline marker in unified diff.");
                hunk.rows[hunk.rows.length - 1].noNewline = true;
                index++;
            }
            hunks.push(hunk);
        }

        if (hunks.length === 0) {
            throw new Error(`No hunks supplied for ${filePath}.`);
        }
        if (operation === "add" && hunks.some(hunk =>
            hunk.oldStart !== 0 || hunk.oldCount !== 0 || hunk.rows.some(row => row.kind !== "+")
        )) {
            throw new Error(`A new-file patch may contain only added lines: ${filePath}.`);
        }
        if (operation === "delete" && hunks.some(hunk =>
            hunk.newStart !== 0 || hunk.newCount !== 0 || hunk.rows.some(row => row.kind !== "-")
        )) {
            throw new Error(`A delete-file patch may contain only removed lines: ${filePath}.`);
        }
        files.push({ path: filePath, operation, hunks });
    }

    if (files.length === 0) throw new Error("The unified diff contains no files.");
    if (new Set(files.map(file => file.path)).size !== files.length) {
        throw new Error("A file may appear only once in a unified diff.");
    }
    return files;
}


function applyHunks(originalLines, hunks, filePath) {

    const output = [];
    let cursor = 0;

    for (const hunk of hunks) {
        const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
        if (start < cursor || start > originalLines.length) {
            throw new Error(`Hunk location is invalid for ${filePath}.`);
        }
        while (cursor < start) output.push(originalLines[cursor++]);
        const expectedNewStart = hunk.newCount === 0 && hunk.newStart === 0
            ? 0
            : hunk.newStart - 1;
        if (output.length !== expectedNewStart) {
            throw new Error(`Hunk output location is inconsistent for ${filePath}.`);
        }

        for (const row of hunk.rows) {
            if (row.kind === "+") {
                output.push(row.text);
                continue;
            }
            if (cursor >= originalLines.length || originalLines[cursor] !== row.text) {
                throw new Error(`Patch context does not match ${filePath} at original line ${cursor + 1}.`);
            }
            if (row.kind === " ") output.push(originalLines[cursor]);
            cursor++;
        }
    }

    while (cursor < originalLines.length) output.push(originalLines[cursor++]);
    return output;
}


function prepareFile(file, context, declaredPaths) {

    const target = context.resolvePath(file.path, { mustExist: file.operation !== "add" });
    const relative = context.relative(target).replace(/\\/g, "/");
    if (!declaredPaths.has(relative)) {
        throw new Error(`Patch path ${relative} is missing from the paths argument.`);
    }

    if (file.operation === "add") {
        const parent = path.dirname(target);
        context.assertSafe(parent, { rejectSymlinks: true });
        if (!fs.statSync(parent).isDirectory()) {
            throw new Error(`Patch add parent is not a directory: ${relative}.`);
        }
        try {
            fs.lstatSync(target);
            throw new Error(`Patch add target already exists: ${relative}.`);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        const updatedLines = applyHunks([], file.hunks, relative);
        const finalRow = file.hunks.at(-1).rows.filter(row => row.kind !== "-").at(-1);
        const finalNewline = !finalRow?.noNewline;
        const updatedText = updatedLines.join("\n") +
            (finalNewline && updatedLines.length > 0 ? "\n" : "");
        return {
            target,
            path: relative,
            operation: "add",
            originalBytes: null,
            updatedBytes: Buffer.from(updatedText, "utf8"),
            mode: null,
            linesBefore: 0,
            linesAfter: updatedLines.length
        };
    }

    context.assertSafe(target, { rejectSymlinks: true });
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) throw new Error(`Patch target is not a regular file: ${relative}`);
    const bytes = fs.readFileSync(target);
    if (bytes.includes(0)) throw new Error(`Binary files are not supported by apply_patch: ${relative}`);

    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new Error(`Patch target is not valid UTF-8: ${relative}`);
    }

    const hasBom = text.charCodeAt(0) === 0xFEFF;
    if (hasBom) text = text.slice(1);
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    let finalNewline = /(?:\r\n|\n|\r)$/.test(text);
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const originalLines = normalized === "" && !finalNewline
        ? []
        : normalized.split("\n");
    if (finalNewline) originalLines.pop();

    const updatedLines = applyHunks(originalLines, file.hunks, relative);
    if (file.operation === "delete") {
        if (updatedLines.length !== 0) {
            throw new Error(`Delete patch did not remove the complete file: ${relative}.`);
        }
        return {
            target,
            path: relative,
            operation: "delete",
            originalBytes: bytes,
            updatedBytes: null,
            mode: stat.mode & 0o777,
            linesBefore: originalLines.length,
            linesAfter: 0
        };
    }

    const lastHunk = file.hunks[file.hunks.length - 1];
    const lastHunkStart = lastHunk.oldStart === 0 ? 0 : lastHunk.oldStart - 1;
    if (lastHunkStart + lastHunk.oldCount >= originalLines.length) {
        const outputRows = lastHunk.rows.filter(row => row.kind !== "-");
        finalNewline = outputRows.length === 0
            ? updatedLines.length > 0
            : !outputRows[outputRows.length - 1].noNewline;
    }

    const updatedText =
        (hasBom ? "\uFEFF" : "") +
        updatedLines.join(eol) +
        (finalNewline && updatedLines.length > 0 ? eol : "");

    if (updatedText === (hasBom ? "\uFEFF" : "") + text) {
        throw new Error(`Patch makes no change to ${relative}.`);
    }

    return {
        target,
        path: relative,
        operation: "modify",
        originalBytes: bytes,
        updatedBytes: Buffer.from(updatedText, "utf8"),
        mode: stat.mode & 0o777,
        linesBefore: originalLines.length,
        linesAfter: updatedLines.length
    };
}


async function applyPatch(args = {}, context) {

    const ctx = PathBoundary.bound(context);
    if (typeof args.paths !== "object" || !Array.isArray(args.paths) || args.paths.length === 0 || args.paths.some(item => typeof item !== "string")) {
        throw new Error("paths must be a non-empty array of workspace-relative file paths.");
    }
    if (args.paths.length > settings.get("FILE_CHECKPOINT_MAX_FILES")) {
        throw new Error("Patch exceeds the configured file-count limit.");
    }
    if (
        typeof args.patch === "string" &&
        Buffer.byteLength(args.patch, "utf8") > settings.get("FILE_CHECKPOINT_MAX_TOTAL_BYTES")
    ) {
        throw new Error("Patch text exceeds the configured aggregate byte limit.");
    }

    const files = parseUnifiedPatch(args.patch);
    const declaredPaths = new Set(args.paths.map(item => item.replace(/\\/g, "/")));
    if (declaredPaths.size !== args.paths.length || declaredPaths.size !== files.length) {
        throw new Error("paths must name each patched file exactly once.");
    }

    const prepared = files.map(file => prepareFile(file, ctx, declaredPaths));
    const maxFileBytes = settings.get("FILE_CHECKPOINT_MAX_FILE_BYTES");
    const outputBytes = prepared.reduce((total, file) => total + (file.updatedBytes?.length || 0), 0);
    if (prepared.some(file => file.updatedBytes && file.updatedBytes.length > maxFileBytes)) {
        throw new Error("Patched output exceeds the configured per-file byte limit.");
    }
    if (outputBytes > settings.get("FILE_CHECKPOINT_MAX_TOTAL_BYTES")) {
        throw new Error("Patched output exceeds the configured aggregate byte limit.");
    }

    const checkpoint = checkpoints.createCheckpoint(
        prepared.map(file => file.target),
        ctx,
        "before apply_patch"
    );

    try {
        for (const file of prepared) {
            if (file.operation === "add") {
                try {
                    fs.lstatSync(file.target);
                    throw new Error(`Patch add target appeared after validation: ${file.path}.`);
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                }
            } else if (!fs.readFileSync(file.target).equals(file.originalBytes)) {
                throw new Error(`Patch target changed after validation: ${file.path}.`);
            }
        }
        for (const file of prepared) {
            if (file.operation === "delete") {
                fs.unlinkSync(file.target);
                continue;
            }
            if (file.operation === "add") {
                fs.writeFileSync(file.target, file.updatedBytes, { flag: "wx" });
                continue;
            }
            AtomicFile.writeFile(file.target, file.updatedBytes);
            if (file.mode !== null) {
                try { fs.chmodSync(file.target, file.mode); } catch { /* Windows ACLs differ */ }
            }
        }
    } catch (error) {
        try {
            checkpoints.undoCheckpoint(checkpoint.checkpoint_id, ctx);
        } catch (rollbackError) {
            error.message += `; checkpoint rollback failed: ${rollbackError.message}`;
        }
        throw error;
    }

    return {
        checkpoint_id: checkpoint.checkpoint_id,
        files: prepared.map(file => ({
            path: file.path,
            operation: file.operation,
            lines_before: file.linesBefore,
            lines_after: file.linesAfter,
            bytes_written: file.updatedBytes?.length || 0
        }))
    };
}


module.exports = {
    apply_patch: applyPatch
};
