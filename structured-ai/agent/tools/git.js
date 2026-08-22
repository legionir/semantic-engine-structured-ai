const { execFile } = require("child_process");

const settings = require("../lib/storage");

const {
    WORKSPACE_ROOT,
    resolveWorkspacePath,
    toWorkspaceRelative,
    truncateText
} = require("../lib/workspace");


/*
|--------------------------------------------------------------------------
| Git
|--------------------------------------------------------------------------
|
| Arguments are passed as an argv array through execFile, never
| interpolated into a shell string. A branch name such as
| "x; rm -rf ." is therefore treated as a branch name.
|--------------------------------------------------------------------------
*/



function gitExec(inputCwd, argv) {

    const cwd =
        inputCwd
            ? resolveWorkspacePath(
                inputCwd,
                {
                    mustExist: true
                }
            )
            : WORKSPACE_ROOT;

    return new Promise((resolve, reject) => {

        execFile(
            "git",
            argv,
            {
                cwd,
                timeout: settings.get("GIT_TIMEOUT_MS"),
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true
            },
            (error, stdout, stderr) => {

                if (error) {

                    reject(
                        new Error(
                            `git ${argv.join(" ")} failed: ${
                                (stderr || error.message).trim()
                            }`
                        )
                    );

                    return;
                }

                resolve({
                    cwd:
                        toWorkspaceRelative(cwd),

                    command:
                        `git ${argv.join(" ")}`,

                    stdout:
                        truncateText(stdout).text,

                    stderr:
                        truncateText(stderr).text
                });
            }
        );
    });
}


function assertString(value, field) {

    if (
        typeof value !== "string" ||
        value.trim() === ""
    ) {

        throw new Error(
            `${field} is required.`
        );
    }

    return value;
}


async function gitStatus(args) {

    return gitExec(
        args.cwd,
        [
            "status",
            "--short",
            "--branch"
        ]
    );
}


async function gitDiff(args) {

    const argv = ["diff"];

    if (args.staged === true) {
        argv.push("--cached");
    }

    if (Number.isInteger(args.context_lines)) {

        argv.push(
            `--unified=${args.context_lines}`
        );
    }

    if (args.path) {

        argv.push(
            "--",
            assertString(args.path, "path")
        );
    }

    return gitExec(args.cwd, argv);
}


async function gitLog(args) {

    const limit =
        Number.isInteger(args.limit)
            ? args.limit
            : 10;

    return gitExec(
        args.cwd,
        [
            "log",
            `-${limit}`,
            "--oneline",
            "--decorate"
        ]
    );
}


async function gitBranch(args) {

    if (args.action === "list") {

        return gitExec(
            args.cwd,
            [
                "branch",
                "--list"
            ]
        );
    }

    if (args.action === "create") {

        return gitExec(
            args.cwd,
            [
                "branch",
                assertString(args.name, "name")
            ]
        );
    }

    throw new Error(
        `Unsupported branch action: ${args.action}`
    );
}


async function gitCheckout(args) {

    return gitExec(
        args.cwd,
        [
            "checkout",
            assertString(args.branch, "branch")
        ]
    );
}


async function gitAdd(args) {

    const paths =
        Array.isArray(args.paths)
            ? args.paths
            : [];

    if (paths.length === 0) {

        throw new Error(
            "paths must contain at least one path."
        );
    }

    for (const item of paths) {
        assertString(item, "paths[]");
    }

    return gitExec(
        args.cwd,
        [
            "add",
            "--",
            ...paths
        ]
    );
}


async function gitCommit(args) {

    const argv = [
        "commit",
        "-m",
        assertString(args.message, "message")
    ];

    if (args.paths !== undefined) {

        const paths =
            Array.isArray(args.paths)
                ? args.paths
                : [];

        if (paths.length === 0) {
            throw new Error("paths must contain at least one path when provided.");
        }

        for (const item of paths) {
            assertString(item, "paths[]");
        }

        /*
        | --only makes an automatic hook commit exactly the declared paths,
        | even when unrelated changes were already staged by the operator.
        */

        argv.push("--only", "--", ...paths);
    }

    return gitExec(args.cwd, argv);
}


module.exports = {
    git_status: gitStatus,
    git_diff: gitDiff,
    git_log: gitLog,
    git_branch: gitBranch,
    git_checkout: gitCheckout,
    git_add: gitAdd,
    git_commit: gitCommit
};
