"use strict";

/* Risk rules for file, repository, package, and permission mutations. */

function createCommandMutations({ RISK, rate, flagSet, operands, hasFlag, psFlag, isRootLike, isAbsolute }) {
function rateDeletion(name, args, dialect) {

    const flags = flagSet(args, dialect);
    const targets = operands(args, dialect);

    const recursive =
        hasFlag(flags, "-r", "-R", "--recursive", "/s") ||
        psFlag(args, "recurse", 3);

    const forced =
        hasFlag(flags, "-f", "--force", "/q", "/f") ||
        psFlag(args, "force", 2);

    if (hasFlag(flags, "--no-preserve-root")) {
        return rate(RISK.HIGH, "deletion with --no-preserve-root");
    }

    if (targets.some(isRootLike)) {
        return rate(RISK.HIGH, `deletes a root, drive, home or parent folder (${targets.find(isRootLike)})`);
    }

    if ((recursive || forced) && targets.some(isAbsolute)) {
        return rate(RISK.HIGH, "recursive or forced deletion of an absolute path");
    }

    if (recursive && forced && targets.some(target => /[*?]/.test(target))) {
        return rate(RISK.HIGH, "recursive forced deletion of a wildcard");
    }

    return rate(RISK.MEDIUM, "deletes files");
}


function rateGit(args) {

    const sub = (args.find(arg => !arg.startsWith("-")) || "").toLowerCase();
    const rest = args.slice(args.indexOf(sub) + 1).map(arg => arg.toLowerCase());

    if (sub === "push" && rest.some(arg => /^(-f|--force|--force-with-lease|--mirror|--delete|-d)$/.test(arg) || /^\+/.test(arg) || /^:/.test(arg))) {
        return rate(RISK.HIGH, "force push or remote deletion rewrites published history");
    }

    if (sub === "reset" && rest.includes("--hard")) {
        return rate(RISK.HIGH, "git reset --hard discards work");
    }

    if (sub === "clean" && rest.some(arg => /^-[a-z]*f/.test(arg))) {
        return rate(RISK.HIGH, "git clean -f deletes untracked files");
    }

    if (sub === "filter-branch" || sub === "filter-repo") {
        return rate(RISK.HIGH, "rewrites history");
    }

    if (sub === "checkout" && rest.includes("--") && rest.includes(".")) {
        return rate(RISK.HIGH, "git checkout -- . discards work");
    }

    if (["status", "log", "diff", "show", "branch", "remote", "rev-parse", "describe", "blame", "ls-files", "ls-tree", "tag", "config", "grep", "shortlog", "reflog", "help", "version", "--version"].includes(sub)) {

        if (sub === "config" && !rest.some(arg => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(arg))) {
            return rate(RISK.MEDIUM, "changes git configuration");
        }

        if ((sub === "tag" || sub === "branch" || sub === "remote") && rest.some(arg => !arg.startsWith("-") || /^-(d|D|m|M|f)$/.test(arg))) {
            return rate(RISK.MEDIUM, `git ${sub} changes refs`);
        }

        return rate(RISK.LOW, `git ${sub} reads the repository`);
    }

    return rate(RISK.MEDIUM, `git ${sub || ""} changes the repository or talks to a remote`.replace(/\s+/g, " "));
}


function ratePackageManager(name, args) {

    const sub = (args.find(arg => !arg.startsWith("-")) || "").toLowerCase();

    if (["test", "t", "ls", "list", "outdated", "view", "info", "why", "audit", "--version", "-v", "help", "config"].includes(sub) || args.includes("--version") || args.includes("-v")) {
        return rate(RISK.LOW, `${name} ${sub} reads only`);
    }

    if (name === "npm" && sub === "run") {
        const script = args[args.indexOf(sub) + 1] || "";
        return /^(test|lint|build|check|typecheck|format:check)$/.test(script)
            ? rate(RISK.LOW, `npm run ${script}`)
            : rate(RISK.MEDIUM, `npm run ${script} runs a project script`);
    }

    return rate(RISK.MEDIUM, `${name} ${sub} changes installed packages or runs code`);
}


function rateFind(args) {

    if (args.some(arg => /^-(delete|exec|execdir|ok|okdir|fprint|fls)$/.test(arg))) {

        const root = args.find(arg => !arg.startsWith("-"));

        const wholeWorkspace = /^\.[\\/]?$/.test(String(root || "."));

        return isAbsolute(root) || (isRootLike(root) && !wholeWorkspace)
            ? rate(RISK.HIGH, "find -delete/-exec over a root or absolute path")
            : rate(RISK.MEDIUM, "find runs a command or deletes");
    }

    return rate(RISK.LOW, "find lists files");
}


function ratePermission(name, args, dialect) {

    const flags = flagSet(args, dialect);
    const targets = operands(args, dialect).slice(name === "chmod" || name === "chown" || name === "chgrp" ? 1 : 0);

    if ((hasFlag(flags, "-r", "-R", "--recursive", "/t", "/r") || /icacls|takeown/.test(name)) && targets.some(target => isRootLike(target) || isAbsolute(target))) {
        return rate(RISK.HIGH, `${name} changes permissions of a system or root path`);
    }

    return rate(RISK.MEDIUM, `${name} changes permissions`);
}



    return { rateDeletion, rateGit, ratePackageManager, rateFind, ratePermission };
}

module.exports = { createCommandMutations };
