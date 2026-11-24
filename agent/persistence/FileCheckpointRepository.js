"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const settings = require("../config");
const dataRoot = require("./DataRoot");
const AtomicFile = require("./AtomicFile");


function checkpointDirectory(context) {

    return path.join(dataRoot.resolveRoot(context), "checkpoints");
}


function pathContains(parent, child) {

    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}


function overlapsCheckpointStore(target, directory) {

    return pathContains(target, directory) || pathContains(directory, target);
}


function checkpointFile(id, context) {

    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
        throw new Error("Invalid checkpoint id.");
    }

    return path.join(checkpointDirectory(context), `${id}.json`);
}


function writePrivateJson(file, value) {

    const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
    let descriptor = null;

    try {
        descriptor = fs.openSync(temporary, "wx", 0o600);
        fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        fs.renameSync(temporary, file);
        let directoryDescriptor = null;
        try {
            directoryDescriptor = fs.openSync(path.dirname(file), "r");
            fs.fsyncSync(directoryDescriptor);
        } catch { /* directory fsync is not supported on every platform */ }
        finally {
            if (directoryDescriptor !== null) {
                try { fs.closeSync(directoryDescriptor); } catch { /* best effort */ }
            }
        }
    } catch (error) {
        if (descriptor !== null) {
            try { fs.closeSync(descriptor); } catch { /* best effort */ }
        }
        try { fs.unlinkSync(temporary); } catch { /* best effort */ }
        throw error;
    }
}


function addSnapshot(target, context, budget, entries) {

    if (entries.length >= settings.get("FILE_CHECKPOINT_MAX_FILES")) {
        throw new Error(`Checkpoint exceeds the configured entry limit of ${settings.get("FILE_CHECKPOINT_MAX_FILES")}.`);
    }

    const relative = context.relative(target);
    context.assertSafe(path.dirname(target), { rejectSymlinks: true });

    let stat;
    try {
        stat = fs.lstatSync(target);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        entries.push({ path: relative, type: "missing" });
        return;
    }

    if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(target);
        const resolvedTarget = path.resolve(path.dirname(target), linkTarget);
        let linkType = "file";
        if (context.isInside(resolvedTarget)) {
            try {
                if (fs.statSync(target).isDirectory()) linkType = "dir";
            } catch { /* dangling links are restored as file links */ }
        }
        entries.push({
            path: relative,
            type: "symlink",
            link_target: linkTarget,
            link_type: linkType,
            mode: stat.mode & 0o777
        });
        return;
    }

    if (stat.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
        const children = fs.readdirSync(target).sort();
        for (const child of children) {
            addSnapshot(path.join(target, child), context, budget, entries);
        }
        return;
    }

    if (!stat.isFile()) {
        throw new Error(`Checkpoint refuses a non-regular path: ${relative}`);
    }

    const maxBytes = settings.get("FILE_CHECKPOINT_MAX_FILE_BYTES");
    if (stat.size > maxBytes) {
        throw new Error(
            `File ${relative} is ${stat.size} bytes, above the checkpoint limit of ${maxBytes}; refusing an irreversible edit.`
        );
    }

    context.assertSafe(target, { rejectSymlinks: true });
    const bytes = fs.readFileSync(target);
    const afterRead = fs.lstatSync(target);
    if (
        afterRead.isSymbolicLink() ||
        afterRead.dev !== stat.dev ||
        afterRead.ino !== stat.ino ||
        afterRead.size !== stat.size ||
        afterRead.mtimeMs !== stat.mtimeMs
    ) {
        throw new Error(`File ${relative} changed while its checkpoint was being captured; refusing the mutation.`);
    }
    if (bytes.length > maxBytes) {
        throw new Error(`File ${relative} grew beyond the checkpoint limit; refusing the mutation.`);
    }
    if (bytes.length > budget.remaining) {
        throw new Error(
            `Checkpoint would exceed the aggregate byte limit of ${settings.get("FILE_CHECKPOINT_MAX_TOTAL_BYTES")}; refusing an irreversible edit.`
        );
    }
    budget.remaining -= bytes.length;

    entries.push({
        path: relative,
        type: "file",
        mode: stat.mode & 0o777,
        content_base64: bytes.toString("base64")
    });

    if (entries.length > settings.get("FILE_CHECKPOINT_MAX_FILES")) {
        throw new Error(`Checkpoint exceeds the configured entry limit of ${settings.get("FILE_CHECKPOINT_MAX_FILES")}.`);
    }
}


function pruneCheckpoints(directory) {

    const retention = settings.get("FILE_CHECKPOINT_RETENTION");
    let records;
    try {
        records = fs.readdirSync(directory)
            .filter(name => /^[a-f0-9-]{36}\.json$/i.test(name))
            .map(name => {
                const file = path.join(directory, name);
                try {
                    const record = JSON.parse(fs.readFileSync(file, "utf8"));
                    return { file, created_at: record.created_at || "" };
                } catch {
                    return { file, created_at: "" };
                }
            });
    } catch {
        return;
    }

    records.sort((a, b) => a.created_at.localeCompare(b.created_at));
    while (records.length > retention) {
        const oldest = records.shift();
        try { fs.unlinkSync(oldest.file); } catch { /* best effort cleanup */ }
    }
}


function withMissingParents(target, context) {

    const targets = [path.resolve(target)];
    let parent = path.dirname(path.resolve(target));
    while (parent !== context.root && context.isInside(parent)) {
        try {
            fs.lstatSync(parent);
            break;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            targets.push(parent);
            const next = path.dirname(parent);
            if (next === parent) break;
            parent = next;
        }
    }
    return targets;
}


function createCheckpoint(targets, context, reason = "before file mutation") {

    if (!Array.isArray(targets) || targets.length === 0) {
        throw new Error("A checkpoint requires at least one path.");
    }

    const unique = [...new Set(targets.map(target => path.resolve(target)))];
    const maxFiles = settings.get("FILE_CHECKPOINT_MAX_FILES");
    if (unique.length > maxFiles) {
        throw new Error(`Checkpoint contains ${unique.length} roots; the configured maximum is ${maxFiles}.`);
    }

    const directory = checkpointDirectory(context);
    for (const target of unique) {
        if (overlapsCheckpointStore(target, directory)) {
            throw new Error("Refusing to mutate or checkpoint the checkpoint repository itself.");
        }
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch { /* Windows ACLs differ */ }

    const budget = { remaining: settings.get("FILE_CHECKPOINT_MAX_TOTAL_BYTES") };
    const entries = [];
    for (const target of unique) {
        addSnapshot(target, context, budget, entries);
    }
    if (entries.length > maxFiles) {
        throw new Error(`Checkpoint contains ${entries.length} entries; the configured maximum is ${maxFiles}.`);
    }

    const record = {
        version: 1,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        run_id: context.runId || null,
        workspace_root: context.root,
        reason: String(reason).slice(0, 160),
        roots: unique.map(target => context.relative(target)),
        entries
    };

    const file = path.join(directory, `${record.id}.json`);
    writePrivateJson(file, record);
    pruneCheckpoints(directory);

    return {
        checkpoint_id: record.id,
        file_count: entries.filter(entry => entry.type === "file").length,
        entry_count: entries.length,
        created_at: record.created_at
    };
}


function loadCheckpoint(id, context) {

    const file = checkpointFile(id, context);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error("Checkpoint record is not a regular file.");
    }
    const maxRecordBytes = Math.ceil(settings.get("FILE_CHECKPOINT_MAX_TOTAL_BYTES") * 4 / 3) +
        settings.get("FILE_CHECKPOINT_MAX_FILES") * 8192 + 1048576;
    if (stat.size > maxRecordBytes) {
        throw new Error("Checkpoint record exceeds the configured storage limit.");
    }
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
        record.version !== 1 ||
        record.id !== id ||
        record.workspace_root !== context.root ||
        !Array.isArray(record.roots) ||
        !Array.isArray(record.entries)
    ) {
        throw new Error("Checkpoint does not belong to this workspace or has an unsupported format.");
    }
    const maxFiles = settings.get("FILE_CHECKPOINT_MAX_FILES");
    if (record.roots.length > maxFiles || record.entries.length > maxFiles) {
        throw new Error("Checkpoint exceeds the current file-count limit.");
    }

    const paths = new Set();
    const budget = { remaining: settings.get("FILE_CHECKPOINT_MAX_TOTAL_BYTES") };
    const store = checkpointDirectory(context);
    for (const root of record.roots) {
        const target = resolveCheckpointPath(root, context);
        if (target === context.root) {
            throw new Error("Checkpoint cannot target the workspace root.");
        }
        if (overlapsCheckpointStore(target, store)) {
            throw new Error("Checkpoint cannot target its own repository.");
        }
    }
    for (const entry of record.entries) {
        const target = resolveCheckpointPath(entry.path, context);
        if (
            target === context.root ||
            paths.has(entry.path) ||
            overlapsCheckpointStore(target, store)
        ) {
            throw new Error("Checkpoint contains a duplicate or forbidden path.");
        }
        paths.add(entry.path);
        if (!["missing", "directory", "symlink", "file"].includes(entry.type)) {
            throw new Error(`Checkpoint contains an unsupported entry type for ${entry.path}.`);
        }
        if (entry.type === "file") {
            if (typeof entry.content_base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.content_base64)) {
                throw new Error(`Checkpoint file payload for ${entry.path} is malformed.`);
            }
            const bytes = Buffer.from(entry.content_base64, "base64");
            if (bytes.length > settings.get("FILE_CHECKPOINT_MAX_FILE_BYTES") || bytes.length > budget.remaining) {
                throw new Error(`Checkpoint payload for ${entry.path} exceeds configured size limits.`);
            }
            budget.remaining -= bytes.length;
        }
        if (entry.type === "symlink" && typeof entry.link_target !== "string") {
            throw new Error(`Checkpoint symlink target for ${entry.path} is malformed.`);
        }
    }
    for (const root of record.roots) {
        if (!record.entries.some(entry => entry.path === root || entry.path.startsWith(`${root}/`))) {
            throw new Error(`Checkpoint root ${root} has no matching snapshot entries.`);
        }
    }
    return record;
}


function resolveCheckpointPath(relative, context) {

    if (typeof relative !== "string" || relative === "") {
        throw new Error("Checkpoint contains an invalid path.");
    }

    const target = context.resolvePath(relative, { noFollow: true });
    if (target === context.root) {
        throw new Error("Checkpoint cannot target the workspace root.");
    }
    context.assertSafe(path.dirname(target), { rejectSymlinks: true });
    return target;
}


function removeCurrentRoot(relative, context) {

    const target = resolveCheckpointPath(relative, context);
    try {
        fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}


function restoreRecord(record, context) {

    /* Clear each touched root first so the restored tree exactly matches
       the snapshot, including newly-created files inside a moved/deleted
       directory. fs.rm does not follow a symlink at the leaf. */
    for (const root of record.roots) {
        removeCurrentRoot(root, context);
    }

    const directories = record.entries
        .filter(entry => entry.type === "directory")
        .sort((a, b) => a.path.split(/[\\/]/).length - b.path.split(/[\\/]/).length);

    for (const entry of directories) {
        const target = resolveCheckpointPath(entry.path, context);
        fs.mkdirSync(target, { recursive: true, mode: entry.mode & 0o777 });
        try { fs.chmodSync(target, entry.mode & 0o777); } catch { /* Windows ACLs differ */ }
    }

    for (const entry of record.entries) {
        const target = resolveCheckpointPath(entry.path, context);
        if (entry.type === "missing" || entry.type === "directory") {
            continue;
        }
        if (entry.type === "symlink") {
            /* Creating a symlink does not follow it. Preserve even an
               originally external link; PathBoundary will refuse to
               traverse it after restoration. */
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.symlinkSync(entry.link_target, target, entry.link_type || "file");
            continue;
        }
        if (entry.type !== "file") {
            throw new Error(`Checkpoint contains an unsupported entry type for ${entry.path}.`);
        }

        const bytes = Buffer.from(entry.content_base64 || "", "base64");
        if (bytes.length > settings.get("FILE_CHECKPOINT_MAX_FILE_BYTES")) {
            throw new Error(`Checkpoint payload for ${entry.path} exceeds the current size limit.`);
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        context.assertSafe(target, { rejectSymlinks: true });
        AtomicFile.writeFile(target, bytes);
        if (Number.isInteger(entry.mode)) {
            try { fs.chmodSync(target, entry.mode & 0o777); } catch { /* Windows ACLs differ */ }
        }
    }
}


function undoCheckpoint(id, context) {

    const record = loadCheckpoint(id, context);
    const targets = record.roots.map(root => resolveCheckpointPath(root, context));
    const rollback = createCheckpoint(targets, context, `rollback before undo ${id}`);

    try {
        restoreRecord(record, context);
    } catch (error) {
        try {
            restoreRecord(loadCheckpoint(rollback.checkpoint_id, context), context);
        } catch (rollbackError) {
            error.message += `; rollback also failed: ${rollbackError.message}`;
        }
        throw error;
    }

    return {
        undone_checkpoint_id: id,
        rollback_checkpoint_id: rollback.checkpoint_id,
        restored_files: record.entries
            .filter(entry => entry.type === "file")
            .map(entry => entry.path),
        restored_paths: record.roots
    };
}


module.exports = {
    createCheckpoint,
    withMissingParents,
    undoCheckpoint,
    checkpointDirectory
};
