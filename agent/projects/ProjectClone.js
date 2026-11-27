"use strict";

/*
|--------------------------------------------------------------------------
| New project from a git URL (roadmap P1-02)
|--------------------------------------------------------------------------
|
| The console's "New project from URL": the repository is cloned into a
| folder under PROJECTS_ROOT (default <data home>/projects), on the branch
| asked for, optionally shallow, and registered as a project once the
| clone succeeded. The clone runs in the background; its progress (git's
| own "Receiving objects: 45%") is kept on a job the panel polls.
|
| Rules:
|   - only https, http, ssh and scp-like (git@host:owner/repo) URLs; never
|     file://, ext::, a local path or anything starting with "-"
|   - credentials in the URL are refused: a token belongs in the secret
|     store or GIT_CLONE_TOKEN, never in a URL that ends up in logs and
|     in .git/config
|   - the folder name is one plain path segment, the destination is
|     checked to be inside the root, and an existing non-empty folder or a
|     symlink is refused
|   - a token is sent as an HTTP header that is given to git through its
|     environment (GIT_CONFIG_*), scoped to the repository's origin: it is
|     not on the command line (ps), not written to .git/config, and not
|     sent to another host. It is never sent over plain http except to
|     the local machine.
|   - git never prompts (GIT_TERMINAL_PROMPT=0, ssh BatchMode), so a
|     missing credential fails instead of hanging the job
|   - a failed or timed-out clone removes the folder it created
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const settings = require("../config");


const JOBS = new Map();


function projectsRoot() {

    const configured = String(settings.get("PROJECTS_ROOT") || "").trim();

    return path.resolve(
        configured ||
        path.join(require("./ProjectStore").resolveDataHome(), "projects")
    );
}


function failure(message, status = 400, extra = {}) {

    return Object.assign(new Error(message), { status, ...extra });
}


/*
| Returns { url, kind, host, origin, name } or throws a 400. `url` is the
| one git receives, unchanged.
*/
function parseUrl(input) {

    if (typeof input !== "string" || input.trim() === "") {
        throw failure("url is required");
    }

    const url = input.trim();

    if (url.length > 2048) {
        throw failure("url is too long");
    }

    if (/[\s\u0000-\u001f\u007f]/.test(url) || url.startsWith("-")) {
        throw failure("url contains characters a repository URL cannot have");
    }

    /* scp-like: git@github.com:owner/repo.git */
    const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):([A-Za-z0-9._~][A-Za-z0-9._~/-]*)$/.exec(url);

    if (scp && !url.includes("://")) {

        return {
            url,
            kind: "ssh",
            host: scp[2].toLowerCase(),
            origin: null,
            name: repoName(scp[3])
        };
    }

    let parsed;

    try {
        parsed = new URL(url);
    } catch {
        throw failure("url is not a repository URL (https://host/owner/repo, ssh://… or git@host:owner/repo)");
    }

    const protocol = parsed.protocol.replace(/:$/, "");

    if (!["https", "http", "ssh"].includes(protocol)) {
        throw failure(`"${protocol}" URLs cannot be cloned from the console; use https or ssh`);
    }

    if (!parsed.hostname) {
        throw failure("url has no host");
    }

    if (parsed.password || (protocol !== "ssh" && parsed.username)) {

        throw failure(
            "do not put credentials in the URL: store the token as a secret (or GIT_CLONE_TOKEN) and name it in the form"
        );
    }

    if (parsed.search || parsed.hash) {
        throw failure("url cannot have a query or a fragment");
    }

    if (!parsed.pathname || parsed.pathname === "/") {
        throw failure("url has no repository path");
    }

    return {
        url,
        kind: protocol,
        host: parsed.hostname.toLowerCase(),
        origin: protocol === "ssh" ? null : parsed.origin,
        name: repoName(parsed.pathname)
    };
}


function repoName(repoPath) {

    const last =
        String(repoPath || "")
            .replace(/\/+$/, "")
            .split("/")
            .pop() || "";

    const name =
        last
            .replace(/\.git$/i, "")
            .replace(/[^A-Za-z0-9._-]+/g, "-")
            .replace(/^[-.]+|[-.]+$/g, "")
            .slice(0, 100);

    return name || "repository";
}


function checkFolderName(name) {

    if (
        typeof name !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) ||
        name.endsWith(".")
    ) {

        throw failure(
            "folder must be one plain name (letters, digits, '.', '_' or '-'; at most 100 characters), not a path"
        );
    }

    return name;
}


function checkBranch(branch) {

    if (branch === undefined || branch === null || branch === "") {
        return null;
    }

    if (
        typeof branch !== "string" ||
        !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) ||
        branch.startsWith("-") ||
        branch.startsWith("/") ||
        branch.endsWith("/") ||
        branch.endsWith(".lock") ||
        branch.includes("..") ||
        branch.includes("//")
    ) {
        throw failure("branch is not a valid branch or tag name");
    }

    return branch;
}


/* inside each other both ways is the same path, case rules included */
function isInside(root, target) {

    const { isInsideRoot } = require("../context/WorkspaceBoundary");

    return isInsideRoot(root, target) && path.resolve(root) !== path.resolve(target);
}


function destinationFor(folder) {

    const root = projectsRoot();

    fs.mkdirSync(root, { recursive: true });

    /* the real root: a symlinked PROJECTS_ROOT is fine, a symlinked child is not */
    const realRoot = fs.realpathSync(root);
    const destination = path.join(realRoot, checkFolderName(folder));

    if (!isInside(realRoot, destination)) {
        throw failure("the folder would be outside the projects root");
    }

    let stat = null;

    try {
        stat = fs.lstatSync(destination);
    } catch {
        stat = null;
    }

    if (stat) {

        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw failure(`${destination} already exists and is not an empty folder`, 409);
        }

        if (fs.readdirSync(destination).length > 0) {
            throw failure(`${destination} already exists and is not empty; choose another folder name`, 409);
        }
    }

    for (const job of JOBS.values()) {

        if (job.status === "running" && job.path === destination) {
            throw failure(`a clone into ${destination} is already running`, 409);
        }
    }

    return { root: realRoot, destination, existed: Boolean(stat) };
}


function isLocalHost(host) {

    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}


/*
| The token for this clone, and where it came from (for the job, never
| the value). An explicitly named secret must exist; the fallbacks are
| quiet.
*/
function resolveToken(target, secretName) {

    const store = require("../secrets/SecretStore");

    if (secretName) {

        store.checkName(secretName);

        const value = store.resolve(secretName);

        if (value === null || value === undefined) {
            throw failure(`secret "${secretName}" is not in the secret store`);
        }

        return { token: value, source: `secret ${secretName}` };
    }

    const configured = String(settings.get("GIT_CLONE_TOKEN") || "");

    if (configured) {
        return { token: configured, source: "GIT_CLONE_TOKEN" };
    }

    const byHost = {
        "github.com": "GITHUB_PAT",
        "gitlab.com": "GITLAB_TOKEN"
    };

    const fallback = byHost[target.host];

    try {

        if (fallback && store.has(fallback)) {
            return { token: store.resolve(fallback), source: `secret ${fallback}` };
        }

    } catch {
        /* an unreadable store is the same as no token for a public clone */
    }

    return { token: null, source: null };
}


function authEnvironment(target, token) {

    if (!token || !target.origin) {
        return {};
    }

    if (target.kind === "http" && !isLocalHost(target.host)) {

        throw failure(
            "a token is never sent over plain http; use the https URL of the repository"
        );
    }

    /* GitLab wants a user name with a token; GitHub ignores it */
    const user = /gitlab/.test(target.host) ? "oauth2" : "x-access-token";
    const header = `Authorization: Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;

    return {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `http.${target.origin}/.extraHeader`,
        GIT_CONFIG_VALUE_0: header
    };
}


function maskOutput(text, token) {

    let value = String(text);

    if (token) {
        value = value.split(token).join("****");
    }

    try {
        value = require("../events/EventRedactor").maskText(value);
    } catch {
        /* masking is best effort on top of the token itself */
    }

    return value;
}


/* "Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s" */
function parseProgress(line) {

    const match = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]+?):\s+(\d{1,3})%/.exec(line);

    return match
        ? { phase: match[1].trim(), percent: Math.min(100, Number(match[2])) }
        : null;
}


function view(job) {

    if (!job) {
        return null;
    }

    const { child, timer, token, ...rest } = job;

    void child;
    void timer;
    void token;

    return { ...rest, output: rest.output.slice() };
}


function finish(job, status, extra = {}) {

    if (job.status !== "running") {
        return;
    }

    clearTimeout(job.timer);

    Object.assign(job, extra, {
        status,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - Date.parse(job.started_at)
    });

    job.child = null;
    job.token = null;

    if (status !== "succeeded" && job.created_folder) {

        try {
            fs.rmSync(job.path, { recursive: true, force: true });
        } catch {
            /* left behind; the next clone into it is refused until removed */
        }
    }

    if (job.emit) {

        job.emit("project:clone", {
            job: job.id,
            status,
            url: job.url,
            path: job.path,
            project_id: job.project ? job.project.id : null,
            error: job.error || null,
            duration_ms: job.duration_ms
        });
    }
}


/*
| Starts a clone and returns its job at once. `options`:
|   url, branch, shallow, folder, name, secret (name in the secret store),
|   registry (ProjectRegistry), emit(type, payload)
*/
function start(options = {}) {

    const target = parseUrl(options.url);
    const branch = checkBranch(options.branch);
    const shallow = options.shallow === true;
    const folder = options.folder ? String(options.folder).trim() : target.name;
    const { destination, existed } = destinationFor(folder);
    const { token, source } = resolveToken(target, options.secret ? String(options.secret).trim() : null);

    const childEnvironment = require("../tools/process/ChildEnvironment");

    const env = childEnvironment.build({
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        GCM_INTERACTIVE: "never",
        GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
        ...authEnvironment(target, token)
    });

    const args = ["clone", "--progress"];

    if (branch) {
        args.push("--branch", branch);
    }

    if (shallow) {
        args.push("--depth", "1");
    }

    args.push("--", target.url, destination);

    const job = {
        id: `clone-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
        status: "running",
        url: target.url,
        host: target.host,
        branch,
        shallow,
        folder,
        path: destination,
        name: options.name ? String(options.name).trim().slice(0, 100) : null,
        credentials: source,
        phase: "starting",
        percent: 0,
        output: [],
        started_at: new Date().toISOString(),
        finished_at: null,
        duration_ms: null,
        exit_code: null,
        error: null,
        project: null,
        created_folder: !existed,
        token,
        emit: options.emit || null,
        child: null,
        timer: null
    };

    JOBS.set(job.id, job);

    /* a finished job is kept for the panel; old ones are forgotten */
    const finished = [...JOBS.values()].filter(item => item.status !== "running");

    for (const old of finished.slice(0, Math.max(0, finished.length - 20))) {
        JOBS.delete(old.id);
    }

    if (job.emit) {

        job.emit("project:clone", {
            job: job.id,
            status: "running",
            url: job.url,
            branch,
            shallow,
            path: destination
        });
    }

    let child;

    try {

        child = spawn(options.gitCommand || "git", args, {
            cwd: path.dirname(destination),
            env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
        });

    } catch (error) {

        finish(job, "failed", { error: `git could not be started: ${error.message}` });
        return view(job);
    }

    job.child = child;

    let pending = "";

    const onText = chunk => {

        pending += chunk.toString();

        /* git redraws its progress with \r; each redraw is one line here */
        const parts = pending.split(/\r\n|\r|\n/);
        pending = parts.pop();

        for (const raw of parts) {

            const line = maskOutput(raw, token).trim();

            if (!line) {
                continue;
            }

            const progress = parseProgress(line);

            if (progress) {

                job.phase = progress.phase;
                job.percent = progress.percent;

                const last = job.output[job.output.length - 1];

                /* one line per phase, updated in place */
                if (last && parseProgress(last) && parseProgress(last).phase === progress.phase) {
                    job.output[job.output.length - 1] = line;
                    continue;
                }
            }

            job.output.push(line);

            if (job.output.length > 60) {
                job.output.splice(0, job.output.length - 60);
            }
        }
    };

    child.stdout.on("data", onText);
    child.stderr.on("data", onText);

    job.timer = setTimeout(() => {

        try {
            child.kill("SIGKILL");
        } catch {
            /* already gone */
        }

        finish(job, "failed", {
            error: `the clone did not finish within ${Math.round(settings.get("GIT_CLONE_TIMEOUT_MS") / 1000)}s (GIT_CLONE_TIMEOUT_MS)`
        });

    }, settings.get("GIT_CLONE_TIMEOUT_MS"));

    if (typeof job.timer.unref === "function") {
        job.timer.unref();
    }

    child.on("error", error => {

        finish(job, "failed", {
            error: error.code === "ENOENT"
                ? "git is not installed on this server (install git and try again)"
                : `git could not be started: ${error.message}`
        });
    });

    child.on("close", code => {

        if (pending.trim()) {
            onText("\n");
        }

        if (job.status !== "running") {
            return;
        }

        job.exit_code = code;

        if (code !== 0) {

            const reason =
                [...job.output].reverse().find(line => /^(fatal|error):/i.test(line)) ||
                job.output[job.output.length - 1] ||
                `git exited with code ${code}`;

            finish(job, "failed", { error: reason.replace(/^(fatal|error):\s*/i, "") });
            return;
        }

        try {

            const record =
                options.registry.register({
                    rootPath: destination,
                    name: job.name || target.name
                });

            job.phase = "done";
            job.percent = 100;
            finish(job, "succeeded", { project: record });

        } catch (error) {

            /* the clone is fine; only the registration failed, so keep the folder */
            job.created_folder = false;
            finish(job, "failed", { error: `cloned, but the project could not be registered: ${error.message}` });
        }
    });

    return view(job);
}


function get(id) {

    return view(JOBS.get(id));
}


function list() {

    return [...JOBS.values()].map(view);
}


/* tests wait on a job instead of sleeping */
function wait(id, timeoutMs) {

    const limit = Date.now() + (timeoutMs || 60000);

    return new Promise((resolve, reject) => {

        const poll = () => {

            const job = JOBS.get(id);

            if (!job) {
                reject(new Error(`unknown clone job ${id}`));
                return;
            }

            if (job.status !== "running") {
                resolve(view(job));
                return;
            }

            if (Date.now() > limit) {
                reject(new Error(`clone job ${id} still running`));
                return;
            }

            setTimeout(poll, 50);
        };

        poll();
    });
}


module.exports = {
    projectsRoot,
    parseUrl,
    repoName,
    checkFolderName,
    checkBranch,
    parseProgress,
    resolveToken,
    authEnvironment,
    start,
    get,
    list,
    wait
};
