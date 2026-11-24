"use strict";

/* Async, bounded and cached git context discovery (roadmap P1-6). */

const { execFile } = require("child_process");
const path = require("path");


function runGit(root, args, timeoutMs, execFileImpl) {
    return new Promise(resolve => {
        try {
            execFileImpl("git", args, {
                cwd: root,
                encoding: "utf8",
                timeout: timeoutMs,
                windowsHide: true,
                maxBuffer: 1024 * 1024
            }, (error, stdout) => resolve(error ? null : String(stdout || "").trim()));
        } catch {
            resolve(null);
        }
    });
}


class RepositoryDetector {

    constructor({ timeoutMs = 1500, execFileImpl = execFile } = {}) {
        this.timeoutMs = timeoutMs;
        this.execFileImpl = execFileImpl;
        this.cache = new Map();
        this.refreshedAt = new Map();
        this.pending = new Map();
    }

    detect(root, declared = {}) {
        const canonicalRoot = path.resolve(root);
        const cached = this.cache.get(canonicalRoot);

        if (!cached) {
            this.refresh(canonicalRoot, declared).catch(() => {});
            return {
                ...declared,
                type: "none",
                available: false,
                root: null
            };
        }

        return { ...declared, ...cached };
    }

    async refresh(root, declared = {}) {
        const canonicalRoot = path.resolve(root);
        const cached = this.cache.get(canonicalRoot);
        if (cached && Date.now() - (this.refreshedAt.get(canonicalRoot) || 0) < 5000) {
            return { ...declared, ...cached };
        }
        if (this.pending.has(canonicalRoot)) return this.pending.get(canonicalRoot);

        const pending = (async () => {
            const top = await runGit(canonicalRoot, ["rev-parse", "--show-toplevel"], this.timeoutMs, this.execFileImpl);
            let result;

            if (!top) {
                result = { type: "none", available: false, root: null };
            } else {
                const [status, branch, head] = await Promise.all([
                    runGit(canonicalRoot, ["status", "--porcelain"], this.timeoutMs, this.execFileImpl),
                    runGit(canonicalRoot, ["rev-parse", "--abbrev-ref", "HEAD"], this.timeoutMs, this.execFileImpl),
                    runGit(canonicalRoot, ["rev-parse", "--short", "HEAD"], this.timeoutMs, this.execFileImpl)
                ]);

                result = {
                    type: "git",
                    available: true,
                    root: top,
                    is_workspace_root: top === canonicalRoot,
                    branch,
                    head,
                    clean: status === "",
                    changed_files: status ? status.split("\n").length : 0
                };
            }

            this.cache.set(canonicalRoot, result);
            this.refreshedAt.set(canonicalRoot, Date.now());
            return { ...declared, ...result };
        })();

        this.pending.set(canonicalRoot, pending);
        try {
            return await pending;
        } finally {
            this.pending.delete(canonicalRoot);
        }
    }
}


module.exports = {
    RepositoryDetector,
    runGit
};
