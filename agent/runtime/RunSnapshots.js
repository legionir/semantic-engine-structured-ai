"use strict";

/*
|--------------------------------------------------------------------------
| Per-run git snapshots (roadmap P3-09)
|--------------------------------------------------------------------------
|
| Before and after a run, the whole working tree of the workspace is
| written as a commit under
|
|     refs/structured-ai/runs/<run id>/before
|     refs/structured-ai/runs/<run id>/after
|
| through a private index file (a copy of the real one, so unchanged files
| are not re-hashed). Neither the branch, HEAD nor the user's index is
| touched, and the commits are reachable only from these refs, so they
| never show up in `git log` or a push.
|
| From the two commits:
|
|   diff     what the task changed (git diff before after)
|   revert   puts every file the task created, edited or deleted back as
|            it was before the run. Files the task did not touch are left
|            alone, and a file that was changed again since the run ended
|            is reported as a conflict instead of being overwritten
|            (unless force).
|
| Ignored files (.gitignore) are not part of a snapshot, as in git itself,
| and neither is .agent/, the runtime's own state (journal, plan, event
| store): rewinding a task must not rewind the record of it.
| A workspace that is not a git repository gets NOT_A_REPOSITORY with a
| sentence that says so.
|--------------------------------------------------------------------------
*/

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const settings = require("../config");
const childEnvironment = require("../tools/process/ChildEnvironment");

const REF_ROOT = "refs/structured-ai/runs";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const IDENTITY = {
    GIT_AUTHOR_NAME: "structured-ai",
    GIT_AUTHOR_EMAIL: "structured-ai@localhost",
    GIT_COMMITTER_NAME: "structured-ai",
    GIT_COMMITTER_EMAIL: "structured-ai@localhost"
};


class SnapshotError extends Error {

    constructor(code, message) {
        super(message);
        this.code = code;
    }
}


function notRepository(root) {

    return new SnapshotError(
        "NOT_A_REPOSITORY",
        `${root} is not a git repository, so task snapshots (per-task diff and revert) are not available. Run "git init" in the project to enable them.`
    );
}


function git(cwd, argv, { env = {}, input = null, encoding = "utf8" } = {}) {

    return new Promise((resolve, reject) => {

        const child = execFile(
            "git",
            argv,
            {
                cwd,
                env: childEnvironment.build({ GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...env }),
                timeout: settings.get("GIT_TIMEOUT_MS"),
                maxBuffer: 64 * 1024 * 1024,
                windowsHide: true,
                encoding
            },
            (error, stdout, stderr) => {
                if (error) {
                    const failure = new Error(`git ${argv.join(" ")} failed: ${String(stderr || error.message).trim()}`);
                    failure.exitCode = error.code;
                    reject(failure);
                    return;
                }
                resolve(stdout);
            }
        );

        if (input !== null) {
            child.stdin.end(input);
        }
    });
}


function assertRunId(runId) {

    if (typeof runId !== "string" || !RUN_ID.test(runId)) {
        throw new SnapshotError("INVALID_RUN", `not a run id: ${runId}`);
    }

    return runId;
}


/* { top, prefix } of the repository holding `root`, or a NOT_A_REPOSITORY error */
async function repositoryOf(root) {

    if (typeof root !== "string" || root === "" || !fs.existsSync(root)) {
        throw notRepository(root);
    }

    let output;

    try {
        output = await git(root, ["rev-parse", "--show-toplevel", "--show-prefix", "--git-path", "index"]);
    } catch {
        throw notRepository(root);
    }

    const [top, prefix = "", indexPath = ""] = output.split(/\r?\n/);

    if (!top) {
        throw notRepository(root);
    }

    return {
        top: path.resolve(top),
        prefix: prefix.replace(/\/$/, ""),
        index: path.resolve(root, indexPath)
    };
}


/*
| pathspecs limiting every command to the workspace inside the repository,
| without the runtime's own state folder (.agent: journal, event store,
| plan, sessions), which a revert must never rewind
*/
function scope(repository) {

    const base = repository.prefix === "" ? "." : repository.prefix;
    const state = repository.prefix === "" ? ".agent" : `${repository.prefix}/.agent`;

    return [base, `:(exclude)${state}`];
}


async function withPrivateIndex(repository, fn) {

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sai-snapshot-"));
    const file = path.join(directory, "index");

    try {

        if (fs.existsSync(repository.index)) {
            fs.copyFileSync(repository.index, file);
        }

        return await fn({ GIT_INDEX_FILE: file });

    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}


async function resolveRef(top, ref) {

    try {
        return (await git(top, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim() || null;
    } catch {
        return null;
    }
}


/*
| Records the working tree as refs/structured-ai/runs/<run>/<phase>.
| Returns { commit, tree, ref } or throws a SnapshotError.
*/
async function capture(root, runId, phase) {

    assertRunId(runId);

    if (phase !== "before" && phase !== "after") {
        throw new SnapshotError("INVALID_PHASE", `phase must be before or after: ${phase}`);
    }

    const repository = await repositoryOf(root);
    const ref = `${REF_ROOT}/${runId}/${phase}`;

    const tree = await withPrivateIndex(repository, async env => {
        const [base, exclusion] = scope(repository);
        /* an exclude pathspec on an ignored folder makes `git add` fail, so
           stage everything in scope, then drop the runtime folder again */
        await git(repository.top, ["add", "--all", "--", base], { env });
        await git(repository.top, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", exclusion.slice(":(exclude)".length)], { env });
        return (await git(repository.top, ["write-tree"], { env })).trim();
    });

    const parents = [];

    if (phase === "after") {
        const before = await resolveRef(repository.top, `${REF_ROOT}/${runId}/before`);
        if (before) parents.push("-p", before);
    }

    const commit = (await git(
        repository.top,
        ["commit-tree", tree, ...parents, "-m", `structured-ai run ${runId} (${phase})`],
        { env: IDENTITY }
    )).trim();

    await git(repository.top, ["update-ref", ref, commit]);

    return { commit, tree, ref };
}


/* [{ status, path }] from `git diff --name-status`, paths repository-relative */
async function changedPaths(repository, from, to) {

    const output = await git(repository.top, ["diff", "--name-status", "--no-renames", "-z", from, to, "--", ...scope(repository)]);
    const fields = output.split("\0").filter(item => item !== "");
    const changes = [];

    for (let index = 0; index + 1 < fields.length; index += 2) {
        changes.push({ status: fields[index][0], path: fields[index + 1] });
    }

    return changes;
}


async function runCommits(repository, runId) {

    assertRunId(runId);

    const before = await resolveRef(repository.top, `${REF_ROOT}/${runId}/before`);
    const after = await resolveRef(repository.top, `${REF_ROOT}/${runId}/after`);

    if (!before) {
        throw new SnapshotError("NO_SNAPSHOT", `run ${runId} has no snapshot in this repository (RUN_SNAPSHOTS was off, or the run predates it)`);
    }

    return { before, after };
}


/*
| What the run changed: { run_id, before, after, files: [{status, path}],
| patch, truncated }. A run still in progress (no after snapshot) is
| compared with the current working tree.
*/
async function diff(root, runId, { maxChars = 200000 } = {}) {

    const repository = await repositoryOf(root);
    const { before, after } = await runCommits(repository, runId);
    let target = after;

    if (!target) {
        target = (await capture(root, runId, "after")).commit;
    }

    const files = await changedPaths(repository, before, target);
    const patch = await git(repository.top, ["diff", "--no-color", "--no-renames", before, target, "--", ...scope(repository)]);

    return {
        run_id: runId,
        before,
        after: target,
        files: files.map(file => ({ ...file, path: stripPrefix(repository, file.path) })),
        patch: patch.length > maxChars ? patch.slice(0, maxChars) : patch,
        truncated: patch.length > maxChars
    };
}


function stripPrefix(repository, repoPath) {

    return repository.prefix && repoPath.startsWith(`${repository.prefix}/`)
        ? repoPath.slice(repository.prefix.length + 1)
        : repoPath;
}


/* blob id of the working-tree file, null when it does not exist */
async function currentBlob(repository, repoPath) {

    const full = path.join(repository.top, repoPath);

    let stat;

    try {
        stat = fs.lstatSync(full);
    } catch {
        return null;
    }

    if (stat.isSymbolicLink()) {
        return (await git(repository.top, ["hash-object", "--stdin"], { input: fs.readlinkSync(full) })).trim();
    }

    if (!stat.isFile()) {
        return "not-a-file";
    }

    /* with the same filters `git add` applied when the snapshot was taken
       (core.autocrlf, .gitattributes), so a CRLF checkout is no conflict */
    return (await git(repository.top, ["hash-object", "--", repoPath])).trim();
}


async function blobIn(repository, commit, repoPath) {

    const output = await git(repository.top, ["ls-tree", "-z", commit, "--", repoPath]);
    const match = /^\d+ blob ([0-9a-f]+)\t/.exec(output);

    return match ? match[1] : null;
}


/*
| Puts the files the run changed back as they were before it. Returns
| { run_id, restored: [], removed: [], conflicts: [] , reverted }.
*/
async function revert(root, runId, { force = false } = {}) {

    const repository = await repositoryOf(root);
    const { before, after } = await runCommits(repository, runId);

    if (!after) {
        throw new SnapshotError("RUN_NOT_FINISHED", `run ${runId} has no after snapshot yet; revert it once it has finished`);
    }

    const changes = await changedPaths(repository, before, after);
    const conflicts = [];

    for (const change of changes) {

        const expected = await blobIn(repository, after, change.path);
        const current = await currentBlob(repository, change.path);

        if (expected !== current) {
            conflicts.push(stripPrefix(repository, change.path));
        }
    }

    if (conflicts.length > 0 && !force) {
        return { run_id: runId, reverted: false, restored: [], removed: [], conflicts };
    }

    const restore = changes.filter(change => change.status !== "A").map(change => change.path);
    const remove = changes.filter(change => change.status === "A").map(change => change.path);

    if (restore.length > 0) {

        await withPrivateIndex(repository, async env => {
            await git(repository.top, ["read-tree", before], { env });
            await git(repository.top, ["checkout-index", "--force", "--stdin", "-z"], { env, input: `${restore.join("\0")}\0` });
        });
    }

    for (const repoPath of remove) {

        const full = path.join(repository.top, repoPath);

        fs.rmSync(full, { force: true });
        removeEmptyParents(path.dirname(full), repository.top);
    }

    return {
        run_id: runId,
        reverted: true,
        restored: restore.map(item => stripPrefix(repository, item)),
        removed: remove.map(item => stripPrefix(repository, item)),
        conflicts
    };
}


function removeEmptyParents(directory, top) {

    let current = directory;

    while (current.startsWith(top) && path.resolve(current) !== path.resolve(top)) {

        try {
            if (fs.readdirSync(current).length > 0) return;
            fs.rmdirSync(current);
        } catch {
            return;
        }

        current = path.dirname(current);
    }
}


/* [{ run_id, before, after, created_at, files }] newest first */
async function list(root, { limit = 50 } = {}) {

    const repository = await repositoryOf(root);
    const output = await git(repository.top, [
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname)%09%(objectname)%09%(creatordate:iso-strict)",
        REF_ROOT
    ]);

    const runs = new Map();

    for (const line of output.split(/\r?\n/).filter(Boolean)) {

        const [ref, commit, date] = line.split("\t");
        const parts = ref.slice(REF_ROOT.length + 1).split("/");
        const phase = parts.pop();
        const runId = parts.join("/");

        if (!runs.has(runId)) {
            runs.set(runId, { run_id: runId, before: null, after: null, created_at: date });
        }

        runs.get(runId)[phase] = commit;
    }

    return [...runs.values()].slice(0, limit);
}


/* drops a run's refs (the objects go with the next git gc) */
async function remove(root, runId) {

    const repository = await repositoryOf(root);

    assertRunId(runId);

    for (const phase of ["before", "after"]) {
        try {
            await git(repository.top, ["update-ref", "-d", `${REF_ROOT}/${runId}/${phase}`]);
        } catch {
            /* already gone */
        }
    }

    return { run_id: runId, removed: true };
}


function enabled() {

    return settings.get("RUN_SNAPSHOTS") === true;
}


/* capture() for the run lifecycle: never throws, a non-repository is silent */
async function captureQuietly(root, runId, phase, { events = null, log = null, projectId = null } = {}) {

    if (!enabled() || !runId) {
        return null;
    }

    try {

        const snapshot = await capture(root, runId, phase);

        if (events) {
            events.emit("run:snapshot", {
                run_id: runId,
                project_id: projectId,
                phase,
                commit: snapshot.commit,
                ref: snapshot.ref
            });
        }

        return snapshot;

    } catch (error) {

        if (error.code !== "NOT_A_REPOSITORY" && log) {
            log.warn("runtime", `run snapshot (${phase}) failed: ${error.message}`, { run_id: runId });
        }

        return null;
    }
}


module.exports = {
    REF_ROOT,
    SnapshotError,
    capture,
    captureQuietly,
    diff,
    revert,
    list,
    remove,
    enabled
};
