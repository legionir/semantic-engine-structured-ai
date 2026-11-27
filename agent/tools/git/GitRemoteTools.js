"use strict";

/*
|--------------------------------------------------------------------------
| git_push and git_worktree (roadmap P3-04)
|--------------------------------------------------------------------------
|
| Plain git, no hosting service: a push goes to whatever remote the
| repository has, with the credentials git itself is configured with.
|
|   git_push      always needs approval (policy rule repository_publication).
|                 force is refused unless GIT_ALLOW_FORCE_PUSH is on, and is
|                 then sent as --force-with-lease, never --force; a refspec
|                 that forces (+ref), deletes (:ref) or names another ref
|                 (a:b) is refused outright, since it would bypass that rule.
|   git_worktree  add / list / remove. A worktree is created only inside
|                 the workspace or a GIT_WORKTREE_ROOTS folder; remove only
|                 accepts a path git lists as a worktree of this repository
|                 (never the main one) and refuses a dirty one unless
|                 force is set.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const settings = require("../../config");
const ToolContext = require("../ToolContext");
const { isInsideRoot } = require("../../context/WorkspaceBoundary");
const { _internal } = require("./GitTools");

const { gitExec, gitCwd, assertString } = _internal;

/* what a ref or remote name may look like here: no option, no refspec */
const REF_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,200}$/;


function refName(value, field) {

    assertString(value, field);

    if (!REF_NAME.test(value) || value.endsWith(".lock") || value.endsWith("/")) {
        throw new Error(`${field} is not a plain name: ${value} (a refspec with +, : or a leading - is not accepted)`);
    }

    return value;
}


async function gitPush(args, context) {

    const ctx = ToolContext.from(context);
    const argv = ["push", "--porcelain"];

    if (args.force === true) {

        if (settings.get("GIT_ALLOW_FORCE_PUSH") !== true) {
            throw new Error("Force push is disabled (GIT_ALLOW_FORCE_PUSH is off); push without force or ask the operator to enable it.");
        }

        argv.push("--force-with-lease");
    }

    if (args.set_upstream === true) {
        argv.push("--set-upstream");
    }

    if (args.tags === true) {
        argv.push("--tags");
    }

    if (args.remote !== undefined || args.branch !== undefined) {
        argv.push(refName(args.remote === undefined ? "origin" : args.remote, "remote"));
    }

    if (args.branch !== undefined) {
        argv.push(refName(args.branch, "branch"));
    }

    return gitExec(ctx, args.cwd, argv);
}


function worktreeRoots(ctx) {

    const extra =
        String(settings.get("GIT_WORKTREE_ROOTS") || "")
            .split(",")
            .map(item => item.trim())
            .filter(item => item !== "" && path.isAbsolute(item))
            .map(item => path.resolve(item));

    return [ctx.root, ...extra];
}


/* the real location a new worktree will have, resolved through the nearest
   existing parent so a symlinked parent cannot point outside */
function realTarget(target) {

    let existing = target;
    const rest = [];

    while (!fs.existsSync(existing)) {

        const parent = path.dirname(existing);

        if (parent === existing) break;

        rest.unshift(path.basename(existing));
        existing = parent;
    }

    let base = existing;

    try {
        base = fs.realpathSync(existing);
    } catch {
        /* keep the textual path */
    }

    return path.join(base, ...rest);
}


function allowedWorktreePath(ctx, inputPath) {

    assertString(inputPath, "path");

    const cwd = gitCwd(ctx);
    const target = path.resolve(cwd, inputPath);
    const real = realTarget(target);
    const roots = worktreeRoots(ctx);

    const inside = roots.some(root => {

        let canonical = root;

        try {
            canonical = fs.realpathSync(root);
        } catch {
            /* a missing root can still be named; it is compared textually */
        }

        return isInsideRoot(canonical, real) && path.resolve(canonical) !== path.resolve(real);
    });

    if (!inside) {
        throw new Error(`path ${inputPath} is outside the workspace and GIT_WORKTREE_ROOTS; a worktree can only be created there`);
    }

    return real;
}


function parseWorktreeList(stdout) {

    const worktrees = [];
    let current = null;

    for (const line of String(stdout).split(/\r?\n/)) {

        if (line.startsWith("worktree ")) {
            current = { path: line.slice(9) };
            worktrees.push(current);
        } else if (current && line.startsWith("HEAD ")) {
            current.head = line.slice(5);
        } else if (current && line.startsWith("branch ")) {
            current.branch = line.slice(7).replace(/^refs\/heads\//, "");
        } else if (current && line === "detached") {
            current.detached = true;
        } else if (current && line.startsWith("locked")) {
            current.locked = true;
        } else if (current && line === "bare") {
            current.bare = true;
        }
    }

    return worktrees;
}


async function listWorktrees(ctx, cwd) {

    const result = await gitExec(ctx, cwd, ["worktree", "list", "--porcelain"]);

    return { ...result, worktrees: parseWorktreeList(result.stdout) };
}


function samePath(a, b) {

    const real = value => {
        try {
            return fs.realpathSync(value);
        } catch {
            return path.resolve(value);
        }
    };

    const left = real(a);
    const right = real(b);

    return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}


async function gitWorktree(args, context) {

    const ctx = ToolContext.from(context);
    const action = args.action;

    if (action === "list") {
        return listWorktrees(ctx, args.cwd);
    }

    if (action === "add") {

        const target = allowedWorktreePath(ctx, args.path);
        const argv = ["worktree", "add"];

        if (args.new_branch !== undefined) {
            argv.push("-b", refName(args.new_branch, "new_branch"));
        }

        argv.push("--", target);

        if (args.ref !== undefined) {
            argv.push(refName(args.ref, "ref"));
        }

        const result = await gitExec(ctx, args.cwd, argv);

        return { ...result, path: target };
    }

    if (action === "remove") {

        assertString(args.path, "path");

        const target = path.resolve(gitCwd(ctx, args.cwd), args.path);
        const { worktrees } = await listWorktrees(ctx, args.cwd);
        const index = worktrees.findIndex(entry => samePath(entry.path, target));

        if (index === -1) {
            throw new Error(`${args.path} is not a worktree of this repository (git worktree list)`);
        }

        if (index === 0) {
            throw new Error("The main worktree cannot be removed.");
        }

        const argv = ["worktree", "remove"];

        if (args.force === true) {
            argv.push("--force");
        }

        argv.push("--", worktrees[index].path);

        return gitExec(ctx, args.cwd, argv);
    }

    throw new Error(`Unsupported worktree action: ${action} (add, list, remove)`);
}


module.exports = {
    git_push: gitPush,
    git_worktree: gitWorktree,
    _parseWorktreeList: parseWorktreeList
};
