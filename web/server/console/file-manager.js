"use strict";

/*
|--------------------------------------------------------------------------
| Console file manager
|--------------------------------------------------------------------------
|
| Browse, read, edit, create, rename and delete files for the web console.
| Every path is relative to one root (the workspace, or a registered
| project's root) and goes through WorkspaceBoundary.resolvePathInRoot, so
| `..`, absolute paths and symlinks cannot reach outside it. Deleting or
| renaming a symlink acts on the link, never on what it points to. Saves
| are atomic (temp file + rename) and can be guarded by the mtime the
| editor loaded, so a file changed on disk is not silently overwritten.
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
    resolvePathInRoot,
    toRelativeInRoot,
    realpath
} = require("../../../agent/context/WorkspaceBoundary");



function failure(status, message, extra = {}) {
    return Object.assign(new Error(message), { status, ...extra });
}


/* fs error codes become HTTP statuses with an operator-readable message */
function translate(error, relative) {
    if (error.status) return error;
    const name = relative || ".";
    switch (error.code) {
        case "ENOENT": return failure(404, `Not found: ${name}`);
        case "EEXIST": return failure(409, `Already exists: ${name}`);
        case "ENOTEMPTY": return failure(409, `Directory is not empty: ${name}`);
        case "ENOTDIR": return failure(400, `Not a directory: ${name}`);
        case "EISDIR": return failure(400, `Is a directory: ${name}`);
        case "EACCES":
        case "EPERM": return failure(403, `Permission denied: ${name}`);
        case "EXDEV": return failure(400, "Cannot move across file systems.");
        default: break;
    }
    if (/^Path does not exist: /.test(error.message)) return failure(404, `Not found: ${name}`);
    if (/outside workspace|escapes the workspace|Path is required/.test(error.message)) {
        return failure(400, error.message.replace("workspace", "file manager root"));
    }
    return error;
}


function posix(relative) {
    return relative.split(path.sep).join("/");
}


function looksBinary(buffer, probeBytes = 8192) {
    return buffer.subarray(0, Math.min(buffer.length, probeBytes)).includes(0);
}


class FileManager {

    /* the limits are functions so a changed setting applies to the next request */
    constructor({ root, maxBytes = () => 2 * 1024 * 1024, listMax = () => 5000, probeBytes = () => 8192 } = {}) {
        this.root = realpath(path.resolve(root));
        this.maxBytes = maxBytes;
        this.listMax = listMax;
        this.probeBytes = probeBytes;
    }


    resolve(relative, options = {}) {
        if (relative !== undefined && relative !== null && typeof relative !== "string") {
            throw failure(400, "path must be a string");
        }
        const input = !relative || relative === "/" ? "." : relative.replace(/^\/+/, "");
        if (input.includes("\0")) throw failure(400, "path contains a NUL byte");
        try {
            return resolvePathInRoot(this.root, input, options);
        } catch (error) {
            throw translate(error, input);
        }
    }


    relative(target) {
        return posix(toRelativeInRoot(this.root, target));
    }


    describe(target, stats) {
        const type = stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
        return {
            name: path.basename(target),
            path: this.relative(target),
            type,
            size: stats.isFile() ? stats.size : null,
            mtime_ms: Math.trunc(stats.mtimeMs),
            mode: (stats.mode & 0o777).toString(8)
        };
    }


    async list(relative) {
        const target = this.resolve(relative, { mustExist: true });
        try {
            const stats = await fs.promises.stat(target);
            if (!stats.isDirectory()) throw failure(400, `Not a directory: ${this.relative(target)}`);
            const names = await fs.promises.readdir(target);
            const entries = [];
            const listMax = this.listMax();
            for (const name of names.slice(0, listMax)) {
                const child = path.join(target, name);
                try {
                    const lstats = await fs.promises.lstat(child);
                    const entry = this.describe(child, lstats);
                    if (lstats.isSymbolicLink()) {
                        entry.target_type = await this.linkTargetType(child);
                    }
                    entries.push(entry);
                } catch {
                    /* removed while listing */
                }
            }
            const rank = entry => (entry.type === "directory" || entry.target_type === "directory" ? 0 : 1);
            entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
            const here = this.relative(target);
            return {
                root: this.root,
                path: here,
                parent: here === "." ? null : posix(path.dirname(here)),
                truncated: names.length > listMax,
                entries
            };
        } catch (error) {
            throw translate(error, relative);
        }
    }


    /* what a link points at, only when that is still inside the root */
    async linkTargetType(link) {
        try {
            const resolved = this.resolve(this.relative(link));
            const stats = await fs.promises.stat(resolved);
            return stats.isDirectory() ? "directory" : "file";
        } catch {
            return "broken";
        }
    }


    async read(relative) {
        const target = this.resolve(relative, { mustExist: true });
        try {
            const stats = await fs.promises.stat(target);
            if (stats.isDirectory()) throw failure(400, `Is a directory: ${this.relative(target)}`);
            const base = { ...this.describe(target, stats), binary: false, too_large: false, content: null };
            if (stats.size > this.maxBytes()) return { ...base, too_large: true, max_bytes: this.maxBytes() };
            const buffer = await fs.promises.readFile(target);
            if (looksBinary(buffer, this.probeBytes())) return { ...base, binary: true };
            return { ...base, content: buffer.toString("utf8") };
        } catch (error) {
            throw translate(error, relative);
        }
    }


    async write(relative, content, expectedMtime) {
        if (typeof content !== "string") throw failure(400, "content must be a string");
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > this.maxBytes()) {
            throw failure(413, `The file is larger than CONSOLE_FILE_MAX_BYTES (${this.maxBytes()} bytes).`);
        }
        const target = this.resolve(relative);
        if (target === this.root) throw failure(400, "Is a directory: .");
        try {
            let mode = 0o644;
            const existing = await fs.promises.stat(target).catch(error => {
                if (error.code === "ENOENT") return null;
                throw error;
            });
            if (existing) {
                if (existing.isDirectory()) throw failure(400, `Is a directory: ${this.relative(target)}`);
                if (expectedMtime !== undefined && expectedMtime !== null && Math.trunc(existing.mtimeMs) !== Number(expectedMtime)) {
                    throw failure(409, "The file changed on disk since it was opened. Reload it or save again to overwrite.", {
                        current_mtime_ms: Math.trunc(existing.mtimeMs)
                    });
                }
                mode = existing.mode & 0o777;
            } else {
                await fs.promises.mkdir(path.dirname(target), { recursive: true });
            }
            const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(4).toString("hex")}.tmp`);
            try {
                await fs.promises.writeFile(temp, content, { mode, flag: "wx" });
                await fs.promises.chmod(temp, mode).catch(() => {});
                await fs.promises.rename(temp, target);
            } catch (error) {
                await fs.promises.rm(temp, { force: true }).catch(() => {});
                throw error;
            }
            const stats = await fs.promises.stat(target);
            return { ...this.describe(target, stats), created: !existing };
        } catch (error) {
            throw translate(error, relative);
        }
    }


    async create(relative, type, content = "") {
        if (type !== "file" && type !== "directory") throw failure(400, "type must be \"file\" or \"directory\"");
        const target = this.resolve(relative, { noFollow: true });
        if (target === this.root) throw failure(409, "Already exists: .");
        try {
            if (type === "directory") {
                await fs.promises.mkdir(target);
            } else {
                if (typeof content !== "string") throw failure(400, "content must be a string");
                if (Buffer.byteLength(content) > this.maxBytes()) throw failure(413, "content is too large");
                await fs.promises.mkdir(path.dirname(target), { recursive: true });
                await fs.promises.writeFile(target, content, { flag: "wx", mode: 0o644 });
            }
            return this.describe(target, await fs.promises.lstat(target));
        } catch (error) {
            throw translate(error, relative);
        }
    }


    async rename(from, to) {
        const source = this.resolve(from, { noFollow: true, mustExist: true });
        const destination = this.resolve(to, { noFollow: true });
        if (source === this.root || destination === this.root) throw failure(400, "The root itself cannot be renamed.");
        if (destination === source) return this.describe(destination, await fs.promises.lstat(destination));
        if (destination.startsWith(source + path.sep)) throw failure(400, "A directory cannot be moved into itself.");
        try {
            const exists = await fs.promises.lstat(destination).then(() => true, () => false);
            if (exists) throw failure(409, `Already exists: ${this.relative(destination)}`);
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.rename(source, destination);
            return this.describe(destination, await fs.promises.lstat(destination));
        } catch (error) {
            throw translate(error, from);
        }
    }


    async remove(relative, recursive = false) {
        const target = this.resolve(relative, { noFollow: true, mustExist: true });
        if (target === this.root) throw failure(400, "The root itself cannot be deleted.");
        try {
            const stats = await fs.promises.lstat(target);
            if (stats.isDirectory()) {
                if (recursive) await fs.promises.rm(target, { recursive: true, maxRetries: 3 });
                else await fs.promises.rmdir(target);
            } else {
                await fs.promises.unlink(target);
            }
            return { path: this.relative(target), type: stats.isDirectory() ? "directory" : "file" };
        } catch (error) {
            throw translate(error, relative);
        }
    }


    /* an existing regular file, for the download route to stream */
    async openForDownload(relative) {
        const target = this.resolve(relative, { mustExist: true });
        try {
            const stats = await fs.promises.stat(target);
            if (!stats.isFile()) throw failure(400, `Not a file: ${this.relative(target)}`);
            return { target, size: stats.size, name: path.basename(target) };
        } catch (error) {
            throw translate(error, relative);
        }
    }
}


module.exports = {
    FileManager,
    looksBinary,
    translate
};
