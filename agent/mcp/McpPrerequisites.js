"use strict";

/*
|--------------------------------------------------------------------------
| MCP prerequisites (roadmap P4-03)
|--------------------------------------------------------------------------
|
| A catalogue server names what it needs on this machine: a launcher
| (npx, uvx, python), a program it drives (kubectl) or a browser build
| (chromium). Each is checked before activation, so a missing one is
| reported with an install hint instead of surfacing as a cryptic spawn
| failure halfway through a connection attempt.
|
| Executables are found by walking PATH (with PATHEXT on Windows) rather
| than running `which`, so the check works the same everywhere. Chromium
| is looked for in Playwright's browser cache, and can be installed from
| the console: install() runs the pinned installer from the catalogue and
| reports progress while it downloads.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const settings = require("../config");


const HINTS = {
    npx: {
        label: "npx (Node.js)",
        hint: "Install Node.js 20 or newer, which includes npx: https://nodejs.org/en/download (or your package manager, e.g. apt install nodejs npm)."
    },
    node: {
        label: "Node.js",
        hint: "Install Node.js 20 or newer: https://nodejs.org/en/download"
    },
    uvx: {
        label: "uvx (uv)",
        hint: "Install uv, which provides uvx: curl -LsSf https://astral.sh/uv/install.sh | sh (Windows: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"). See https://docs.astral.sh/uv/getting-started/installation/"
    },
    python: {
        label: "Python 3",
        hint: "Install Python 3.10 or newer: https://www.python.org/downloads/ (or apt install python3)."
    },
    kubectl: {
        label: "kubectl",
        hint: "Install kubectl and configure a context: https://kubernetes.io/docs/tasks/tools/"
    },
    docker: {
        label: "Docker",
        hint: "Install Docker Engine: https://docs.docker.com/engine/install/"
    },
    chromium: {
        label: "Headless Chromium",
        hint: "Install the Chromium build Playwright uses with the Install button here, or run: npx -y @playwright/mcp@0.0.86 install-browser chromium (add --with-deps on a fresh Linux server, as root)."
    }
};

/* a prerequisite that is a program, and the names it may go by */
const EXECUTABLES = {
    npx: ["npx"],
    node: ["node"],
    uvx: ["uvx"],
    python: ["python3", "python"],
    kubectl: ["kubectl"],
    docker: ["docker"]
};


/*
| The environment a server is started with (ChildEnvironment), so a
| program is looked for exactly where the server's own spawn will look.
| Windows spells some names differently ("Path"), hence the lookup.
*/
function childVariable(name) {

    const env = require("../tools/process/ChildEnvironment").build({});
    const key = Object.keys(env).find(item => item.toUpperCase() === name);

    return key ? env[key] : undefined;
}


function pathEntries() {

    return String(childVariable("PATH") || "").split(path.delimiter).filter(Boolean);
}


function executableNames(name) {

    if (process.platform !== "win32") {
        return [name];
    }

    const extensions = (childVariable("PATHEXT") || ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean);

    return [name, ...extensions.map(extension => `${name}${extension.toLowerCase()}`), ...extensions.map(extension => `${name}${extension}`)];
}


function isExecutableFile(file) {

    try {

        const stat = fs.statSync(file);

        if (!stat.isFile()) {
            return false;
        }

        if (process.platform === "win32") {
            return true;
        }

        fs.accessSync(file, fs.constants.X_OK);

        return true;

    } catch {
        return false;
    }
}


/* the full path of the first matching program on PATH, or null */
function findExecutable(name, directories = pathEntries()) {

    for (const directory of directories) {

        for (const candidate of executableNames(name)) {

            const file = path.join(directory, candidate);

            if (isExecutableFile(file)) {
                return file;
            }
        }
    }

    return null;
}


/*
| Playwright's browser cache: PLAYWRIGHT_BROWSERS_PATH when the operator
| set one, otherwise the per-platform default Playwright itself uses.
*/
function browsersPath() {

    const configured = settings.get("PLAYWRIGHT_BROWSERS_PATH");

    if (configured) {
        return path.resolve(configured);
    }

    if (process.platform === "win32") {
        return path.join(childVariable("LOCALAPPDATA") || path.join(os.homedir(), "AppData", "Local"), "ms-playwright");
    }

    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
    }

    return path.join(childVariable("XDG_CACHE_HOME") || path.join(os.homedir(), ".cache"), "ms-playwright");
}


function findChromium(root = browsersPath()) {

    let entries;

    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return null;
    }

    const found = entries
        .filter(entry => entry.isDirectory() && /^chromium(_headless_shell)?-\d+$/.test(entry.name))
        .map(entry => path.join(root, entry.name))
        /* Playwright writes this marker last; an interrupted download has none */
        .filter(directory => fs.existsSync(path.join(directory, "INSTALLATION_COMPLETE")));

    return found.length > 0 ? found.sort().at(-1) : null;
}


function describe(id) {

    return HINTS[id] || {
        label: id,
        hint: `Install ${id} and make sure it is on the PATH of the process that runs the console.`
    };
}


/* one prerequisite: { id, label, ok, path, hint, installable } */
function checkOne(id) {

    const info = describe(id);

    if (id === "chromium") {

        const found = findChromium();

        return {
            id,
            label: info.label,
            ok: Boolean(found),
            path: found,
            hint: found ? null : info.hint,
            installable: true,
            location: browsersPath()
        };
    }

    const names = EXECUTABLES[id] || [id];
    let found = null;

    for (const name of names) {
        found = findExecutable(name);
        if (found) break;
    }

    return {
        id,
        label: info.label,
        ok: Boolean(found),
        path: found,
        hint: found ? null : info.hint,
        installable: false
    };
}


function check(ids = []) {

    return [...new Set(ids)].map(checkOne);
}


function missing(ids = []) {

    return check(ids).filter(item => !item.ok);
}


/*
|--------------------------------------------------------------------------
| One-click installs
|--------------------------------------------------------------------------
| One job per installer at a time. The console polls the job; its output
| is kept as a bounded tail and the newest percentage is the progress.
*/

const jobs = new Map();


function tailLimit() {
    return 40;
}


function emit(type, payload) {
    try {
        require("../events").emit(type, payload);
    } catch {
        /* best effort */
    }
}


function jobView(job) {

    if (!job) {
        return null;
    }

    return {
        id: job.id,
        label: job.label,
        status: job.status,
        percent: job.percent,
        phase: job.phase,
        started_at: job.started_at,
        finished_at: job.finished_at,
        exit_code: job.exit_code,
        error: job.error,
        command: job.command,
        output: job.output.slice(-tailLimit())
    };
}


function installStatus(id) {

    return jobView(jobs.get(id));
}


function recordOutput(job, chunk) {

    const text = String(chunk).replace(/\r/g, "\n");

    for (const raw of text.split("\n")) {

        const line = raw.trim();

        if (!line) continue;

        const percent = line.match(/(\d{1,3})%/);

        if (percent) {
            job.percent = Math.min(100, Number(percent[1]));
        }

        if (/^downloading /i.test(line) || /download(ed)? to /i.test(line) || /^installing /i.test(line)) {
            job.phase = line.slice(0, 200);
        }

        /* progress bars repeat the same line; keep the newest of a run */
        const previous = job.output.at(-1);

        if (percent && previous && previous.replace(/\d{1,3}%.*$/, "") === line.replace(/\d{1,3}%.*$/, "")) {
            job.output[job.output.length - 1] = line.slice(0, 500);
        } else {
            job.output.push(line.slice(0, 500));
        }

        if (job.output.length > tailLimit() * 2) {
            job.output.splice(0, job.output.length - tailLimit());
        }
    }
}


/*
| install("chromium", { recipe, withDeps }) starts the installer named in
| the catalogue (recipe = { command, args, with_deps_arg, label }); a
| running job is returned rather than started twice.
*/
function install(id, { recipe, withDeps = false } = {}) {

    const running = jobs.get(id);

    if (running && running.status === "running") {
        return jobView(running);
    }

    if (!recipe || !recipe.command) {
        const error = new Error(`there is no installer for "${id}"`);
        error.status = 404;
        throw error;
    }

    const args = [...(recipe.args || [])];

    if (withDeps && recipe.with_deps_arg) {
        args.push(recipe.with_deps_arg);
    }

    const job = {
        id,
        label: recipe.label || id,
        status: "running",
        percent: 0,
        phase: "starting",
        started_at: Date.now(),
        finished_at: null,
        exit_code: null,
        error: null,
        command: [recipe.command, ...args].join(" "),
        output: []
    };

    jobs.set(id, job);

    emit("mcp:install", { id, status: "running", command: job.command });

    const env = require("../tools/process/ChildEnvironment").build(
        settings.get("PLAYWRIGHT_BROWSERS_PATH")
            ? { PLAYWRIGHT_BROWSERS_PATH: path.resolve(settings.get("PLAYWRIGHT_BROWSERS_PATH")) }
            : {}
    );

    let child;

    const finish = (status, extra = {}) => {

        if (job.status !== "running") return;

        job.status = status;
        job.finished_at = Date.now();
        Object.assign(job, extra);

        if (status === "succeeded") {
            job.percent = 100;
            job.phase = "installed";
        }

        emit("mcp:install", {
            id,
            status,
            exit_code: job.exit_code,
            error: job.error,
            duration_ms: job.finished_at - job.started_at
        });
    };

    try {

        child = spawn(recipe.command, args, {
            env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            shell: process.platform === "win32" && !/\.(exe|com)$/i.test(recipe.command)
        });

    } catch (error) {

        finish("failed", { error: error.message });

        return jobView(job);
    }

    child.stdout.on("data", chunk => recordOutput(job, chunk));
    child.stderr.on("data", chunk => recordOutput(job, chunk));

    child.on("error", error => finish("failed", { error: `the installer could not start: ${error.message}` }));

    child.on("close", code => {

        if (code === 0) {
            finish("succeeded", { exit_code: 0 });
        } else {
            finish("failed", {
                exit_code: code,
                error: `the installer exited with code ${code}${job.output.length ? `: ${job.output.at(-1)}` : ""}`
            });
        }
    });

    return jobView(job);
}


/* tests: wait for a job to settle */
async function waitForInstall(id, timeoutMs) {

    const started = Date.now();

    while (Date.now() - started < timeoutMs) {

        const job = jobs.get(id);

        if (!job || job.status !== "running") {
            return jobView(job);
        }

        await new Promise(resolve => setTimeout(resolve, 25));
    }

    return jobView(jobs.get(id));
}


module.exports = {
    HINTS,
    findExecutable,
    browsersPath,
    findChromium,
    check,
    missing,
    install,
    installStatus,
    waitForInstall
};
