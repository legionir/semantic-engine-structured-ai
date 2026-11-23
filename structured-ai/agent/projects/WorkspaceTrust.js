"use strict";

/*
|--------------------------------------------------------------------------
| Workspace Trust (roadmap P0-1)
|--------------------------------------------------------------------------
|
| A workspace is usually a repository, and a repository can be cloned
| from anyone, so every file inside it - .agent/project.json included -
| is input the operator did not write. This module decides which settings
| such a file may change and remembers which folders the operator has
| explicitly trusted.
|
|   locked        never read from any project file, trusted or not: they
|                 decide what the agent may do without asking (approval,
|                 sandbox, MCP trust) or whom it talks to with which
|                 credential (base URLs, API keys). They come only from
|                 the operator: environment, CLI flags, console.
|
|   trust-gated   read from a project file only when the operator trusted
|                 that workspace: switches that make code from the
|                 repository run (hooks, MCP auto discovery).
|
|   everything else is harmless tuning and is applied as before.
|
| The trust store lives in the operator's own configuration directory,
| never in a workspace:
|
|   Windows      %APPDATA%\structured-ai\trusted-workspaces.json
|   elsewhere    $XDG_CONFIG_HOME/structured-ai/trusted-workspaces.json
|                (~/.config/structured-ai/trusted-workspaces.json)
|
| STRUCTURED_AI_TRUST_FILE overrides the location (tests, portable
| installs). Trust is revocable: revoke() removes the entry.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const os = require("os");
const path = require("path");


const TRUST_VERSION = 1;


const LOCKED_KEYS = new Set([
    "AGENT_APPROVAL",
    "AGENT_BASE_URL",
    "AGENT_API_KEY",
    "AGENT_CONSOLE_TOKEN",
    "AGENT_CONSOLE_TOKENS",
    "PROCESS_SANDBOX_MODE",
    "MCP_APPROVAL",
    "MCP_TRUST_PROJECT_CONFIG",
    "MCP_SERVERS",
    "MCP_ALLOW_RUNTIME_ADD",
    "ALLOW_PRIVATE_NETWORK",
    "NET_ALLOWED_HOSTS",
    "SEMANTIC_ENGINE_URL",
    "PROJECT_FILE_ENABLED",
    "PROJECT_SAVE_SECRETS"
]);


/* Every configured endpoint's URL and credential, whatever its name. */
const LOCKED_PATTERNS = [
    /^ENDPOINT_[A-Z0-9_]+_(BASE_URL|API_KEY)$/
];


const TRUST_GATED_KEYS = new Set([
    "HOOKS_ENABLED",
    "MCP_AUTO_DISCOVER",
    "MCP_ENABLED"
]);


function isSecretSetting(key, settings) {

    if (!settings || typeof settings.definitionOf !== "function") {
        return false;
    }

    try {

        const definition = settings.definitionOf(key);

        return Boolean(definition && definition.secret);

    } catch {

        /* an unknown key is not a secret; settings.set reports it */
        return false;
    }
}


/*
| "locked" | "trust" | "allowed" for a key found in a project file.
*/
function classify(key, settings) {

    const name = String(key);

    if (
        LOCKED_KEYS.has(name) ||
        LOCKED_PATTERNS.some(pattern => pattern.test(name)) ||
        isSecretSetting(name, settings)
    ) {
        return "locked";
    }

    if (TRUST_GATED_KEYS.has(name)) {
        return "trust";
    }

    return "allowed";
}


function isLocked(key, settings) {

    return classify(key, settings) === "locked";
}


/*
| Splits the settings of a project file into what may be applied and
| what is refused, with the reason the operator is told.
*/
function filterProjectSettings(values, options = {}) {

    const allowed = {};
    const blocked = [];

    const trusted = options.trusted === true;

    for (const [key, value] of Object.entries(values || {})) {

        const verdict = classify(key, options.settings);

        if (verdict === "locked") {

            blocked.push({
                key,
                reason: "security setting; never taken from a project file"
            });

        } else if (verdict === "trust" && !trusted) {

            blocked.push({
                key,
                reason: "workspace is not trusted"
            });

        } else {

            allowed[key] = value;
        }
    }

    return { allowed, blocked };
}


/* ----------------------------- trust store ----------------------------- */


function configDirectory() {

    if (process.platform === "win32") {

        return process.env.APPDATA ||
            path.join(os.homedir(), "AppData", "Roaming");
    }

    return process.env.XDG_CONFIG_HOME ||
        path.join(os.homedir(), ".config");
}


function trustStorePath() {

    if (process.env.STRUCTURED_AI_TRUST_FILE) {
        return path.resolve(process.env.STRUCTURED_AI_TRUST_FILE);
    }

    return path.join(
        configDirectory(),
        "structured-ai",
        "trusted-workspaces.json"
    );
}


/* One spelling per folder: resolved, symlinks followed, and case folded
   where the file system ignores case. */
function canonicalRoot(root) {

    let resolved = path.resolve(String(root));

    try {

        resolved = fs.realpathSync.native(resolved);

    } catch {

        /* a folder that does not exist yet keeps its resolved spelling */
    }

    if (process.platform === "win32") {
        resolved = resolved.toLowerCase();
    }

    return resolved;
}


function readStore() {

    const file = trustStorePath();

    try {

        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

        if (
            parsed &&
            typeof parsed === "object" &&
            parsed.workspaces &&
            typeof parsed.workspaces === "object"
        ) {
            return { version: TRUST_VERSION, workspaces: parsed.workspaces };
        }

    } catch {

        /* missing or corrupt: nothing is trusted */
    }

    return { version: TRUST_VERSION, workspaces: {} };
}


function writeStore(store) {

    const file = trustStorePath();

    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
        temp,
        `${JSON.stringify(store, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
    );

    fs.renameSync(temp, file);

    try {

        fs.chmodSync(file, 0o600);

    } catch {

        /* best effort on file systems without POSIX modes */
    }

    return file;
}


function isTrusted(root) {

    if (!root) {
        return false;
    }

    const store = readStore();

    return Object.prototype.hasOwnProperty.call(
        store.workspaces,
        canonicalRoot(root)
    );
}


function trust(root, details = {}) {

    if (!root) {
        throw new Error("trust() needs a workspace folder.");
    }

    const store = readStore();
    const key = canonicalRoot(root);

    store.workspaces[key] = {
        path: path.resolve(String(root)),
        trusted_at: new Date().toISOString(),
        ...(details.by ? { by: String(details.by) } : {})
    };

    writeStore(store);

    return key;
}


function revoke(root) {

    if (!root) {
        return false;
    }

    const store = readStore();
    const key = canonicalRoot(root);

    if (!Object.prototype.hasOwnProperty.call(store.workspaces, key)) {
        return false;
    }

    delete store.workspaces[key];

    writeStore(store);

    return true;
}


function list() {

    const store = readStore();

    return Object.entries(store.workspaces)
        .map(([key, value]) => ({ key, ...value }));
}


module.exports = {
    LOCKED_KEYS,
    LOCKED_PATTERNS,
    TRUST_GATED_KEYS,
    classify,
    isLocked,
    filterProjectSettings,
    trustStorePath,
    canonicalRoot,
    isTrusted,
    trust,
    revoke,
    list
};
