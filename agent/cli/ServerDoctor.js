"use strict";

/*
|--------------------------------------------------------------------------
| agent doctor — is this server ready? (roadmap P1-08)
|--------------------------------------------------------------------------
|
| One command after installing on a fresh VPS: every check prints one line
| with what was found and, when something is wrong, what to do about it.
|
|   ok    ready
|   warn  works, but something is missing or risky (exit code stays 0)
|   fail  the console will not work as configured (exit code 1)
|
| Checks: the Node.js version, git, the MCP prerequisites (npx, uvx,
| python), the port the console would listen on, that the data home, the
| workspace and the projects root can be written, the secret store's file
| permissions, the console token, the model endpoint, free memory and
| disk, and the process sandbox (SandboxDoctor).
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");


function check(name, status, detail, hint) {

    return { name, status, detail, ...(hint ? { hint } : {}) };
}


function nodeCheck(engines) {

    const wanted = Number(String(engines || ">=20").replace(/[^0-9.]/g, "").split(".")[0]) || 20;
    const major = Number(process.versions.node.split(".")[0]);

    return major >= wanted
        ? check("node", "ok", `Node.js ${process.version}`)
        : check("node", "fail", `Node.js ${process.version}; ${engines} is required`, `install Node.js ${wanted} or newer (for example from https://nodejs.org or with nvm)`);
}


function gitCheck(runner) {

    const result = runner("git", ["--version"], { encoding: "utf8", timeout: 10000, windowsHide: true });

    if (result.error || result.status !== 0) {

        return check(
            "git",
            "warn",
            "git was not found",
            "install git (apt install git): the git tools and new projects from a URL need it"
        );
    }

    return check("git", "ok", String(result.stdout || "").trim());
}


function prerequisiteChecks() {

    try {

        const prerequisites = require("../mcp/McpPrerequisites");

        return prerequisites.check(["npx", "uvx", "python"]).map(item =>
            item.ok
                ? check(item.id, "ok", `${item.label}: ${item.path || "found"}`)
                : check(item.id, "warn", `${item.label} was not found (only needed by MCP servers that use it)`, item.hint)
        );

    } catch (error) {

        return [check("mcp prerequisites", "warn", `could not be checked: ${error.message}`)];
    }
}


function portCheck(host, port, explicit = true) {

    return new Promise(resolve => {

        const server = net.createServer();

        server.once("error", error => {

            resolve(
                error.code === "EADDRINUSE"
                    ? check("port", explicit ? "fail" : "warn", `${host}:${port} is already in use`, `stop what listens there (ss -ltnp | grep :${port}) or serve on another port: agent -s <port>`)
                    : error.code === "EACCES"
                        ? check("port", "fail", `${host}:${port} needs privileges`, "use a port above 1024 and put a reverse proxy (Caddy, nginx) in front for 443")
                        : check("port", "fail", `${host}:${port} cannot be used: ${error.code || error.message}`)
            );
        });

        server.listen(port, host, () => {
            server.close(() => resolve(check("port", "ok", `${host}:${port} is free`)));
        });
    });
}


function writable(label, folder, hint) {

    try {

        fs.mkdirSync(folder, { recursive: true });

        const probe = path.join(folder, `.doctor-${process.pid}-${Date.now()}`);

        fs.writeFileSync(probe, "ok");
        fs.rmSync(probe, { force: true });

        return check(label, "ok", `${folder} is writable`);

    } catch (error) {

        return check(label, "fail", `${folder} cannot be written (${error.code || error.message})`, hint);
    }
}


function secretFileCheck(dataHome) {

    if (process.platform === "win32") {
        return null;
    }

    const loose = [];

    for (const name of ["secrets.key", "secrets.enc"]) {

        const file = path.join(dataHome, name);

        try {

            const mode = fs.statSync(file).mode & 0o777;

            if (mode & 0o077) {
                loose.push(`${name} (${mode.toString(8)})`);
            }

        } catch {
            /* not created yet */
        }
    }

    return loose.length === 0
        ? check("secret store", "ok", "secret files are private to this user (or not created yet)")
        : check("secret store", "warn", `readable by other users: ${loose.join(", ")}`, `chmod 600 ${path.join(dataHome, "secrets.*")}`);
}


function consoleTokenCheck(settings, host) {

    const token = String(settings.get("AGENT_CONSOLE_TOKEN") || "");
    const publicHost = host && host !== "127.0.0.1" && host !== "localhost" && host !== "::1";

    if (token.length >= 24) {
        return check("console token", "ok", "AGENT_CONSOLE_TOKEN is set");
    }

    if (token) {
        return check("console token", "warn", "AGENT_CONSOLE_TOKEN is short", "use at least 24 random characters: openssl rand -base64 32");
    }

    return check(
        "console token",
        publicHost ? "warn" : "ok",
        publicHost
            ? `no AGENT_CONSOLE_TOKEN: a random token is printed at every start, so bookmarks break after a restart`
            : "no AGENT_CONSOLE_TOKEN: a random token is printed at start",
        publicHost ? "set AGENT_CONSOLE_TOKEN in the service environment (see deploy/structured-ai.env.example)" : null
    );
}


function endpointCheck(settings) {

    const key = String(settings.get("AGENT_API_KEY") || "");
    const base = String(settings.get("AGENT_BASE_URL") || "");

    if (!key || key === "your-api-key") {

        return check(
            "model endpoint",
            "warn",
            `AGENT_API_KEY is not set (base URL ${base || "default"})`,
            "set AGENT_BASE_URL, AGENT_API_KEY and AGENT_MODEL, or configure the providers in the console's LLM settings"
        );
    }

    return check("model endpoint", "ok", `${base || "default base URL"} with an API key`);
}


function resourceChecks() {

    try {

        const resources = require("../runtime/SystemResources").snapshot();
        const checks = [];
        const availableMb = Math.round(resources.memory.available_bytes / (1024 * 1024));

        checks.push(
            resources.warnings.some(item => item.kind === "memory")
                ? check("memory", "warn", `${availableMb} MB available of ${Math.round(resources.memory.total_bytes / (1024 * 1024))} MB`, "add swap or memory; each running project needs roughly 150-300 MB")
                : check("memory", "ok", `${availableMb} MB available, ${resources.cpu.cores} CPU core(s)`)
        );

        for (const disk of resources.disks) {

            if (disk.error) {
                continue;
            }

            const freeMb = Math.round(disk.free_bytes / (1024 * 1024));
            const low = resources.warnings.some(item => item.kind === "disk" && item.path === disk.path);

            checks.push(
                low
                    ? check(`disk (${disk.label})`, "warn", `${freeMb} MB free at ${disk.path}`, "free some space: clones, node_modules and browser downloads need room")
                    : check(`disk (${disk.label})`, "ok", `${freeMb} MB free at ${disk.path}`)
            );
        }

        return checks;

    } catch (error) {

        return [check("resources", "warn", `could not be measured: ${error.message}`)];
    }
}


function sandboxCheck() {

    try {

        const sandbox = require("../tools/process/SandboxDoctor").diagnose();

        return check(
            "process sandbox",
            sandbox.ok ? "ok" : "warn",
            `mode ${sandbox.mode}, ${sandbox.status}${sandbox.engine && sandbox.engine !== "none" ? ` (${sandbox.engine})` : ""}`,
            sandbox.ok ? null : (sandbox.warnings || []).join(" ")
        );

    } catch (error) {

        return check("process sandbox", "warn", `could not be checked: ${error.message}`);
    }
}


async function diagnose(options = {}) {

    const settings = require("../config");
    const runner = options.runner || spawnSync;
    const host = options.host || "127.0.0.1";
    const port = Number(options.port) || 7777;
    const workspace = path.resolve(options.workspace || process.cwd());

    let engines = ">=20";

    try {
        engines = require("../../package.json").engines.node;
    } catch {
        /* the default above */
    }

    const dataHome = require("../projects/ProjectStore").resolveDataHome();

    let projectsRoot = null;

    try {
        projectsRoot = require("../projects/ProjectClone").projectsRoot();
    } catch {
        projectsRoot = null;
    }

    const checks = [
        nodeCheck(engines),
        gitCheck(runner),
        ...prerequisiteChecks(),
        await portCheck(host, port, options.explicitPort !== false),
        writable("data home", dataHome, `make it writable for this user (chown -R $(whoami) ${dataHome}) or set STRUCTURED_AI_DATA_HOME`),
        writable("workspace", workspace, `make it writable for this user or start with -w <folder>`),
        ...(projectsRoot ? [writable("projects root", projectsRoot, "make it writable or set PROJECTS_ROOT")] : []),
        secretFileCheck(dataHome),
        consoleTokenCheck(settings, host),
        endpointCheck(settings),
        ...resourceChecks(),
        sandboxCheck()
    ].filter(Boolean);

    return {
        ok: checks.every(item => item.status !== "fail"),
        host: os.hostname(),
        checks
    };
}


function formatReport(report) {

    const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" };
    const width = Math.max(...report.checks.map(item => item.name.length));

    const lines = ["Structured AI doctor", ""];

    for (const item of report.checks) {

        lines.push(`  ${mark[item.status] || item.status}  ${item.name.padEnd(width)}  ${item.detail}`);

        if (item.hint && item.status !== "ok") {
            lines.push(`        ${" ".repeat(width)}  → ${item.hint}`);
        }
    }

    const failed = report.checks.filter(item => item.status === "fail").length;
    const warned = report.checks.filter(item => item.status === "warn").length;

    lines.push(
        "",
        failed > 0
            ? `${failed} problem(s) must be fixed before the console can run as configured.`
            : warned > 0
                ? `Ready, with ${warned} warning(s).`
                : "Ready."
    );

    return `${lines.join("\n")}\n`;
}


module.exports = {
    diagnose,
    formatReport,
    portCheck,
    nodeCheck
};
