"use strict";

/*
|--------------------------------------------------------------------------
| MCP catalogue (roadmap P4-02)
|--------------------------------------------------------------------------
|
| agent/registry/mcp_catalog.json lists servers the console can activate
| without anyone editing a file. Activation:
|
|   1. the prerequisites are checked (P4-03); a missing one stops here,
|      before any connection is attempted;
|   2. every secret input goes to the encrypted secret store (P4-01) and
|      the definition refers to it as ${secret:NAME};
|   3. the server is written to the operator's user MCP file
|      (<data home>/mcp.json), for every project or scoped to one;
|   4. it is connected and its tools are listed. If that fails, the file
|      and any secret this activation created are put back as they were.
|
| Deactivation removes the server from the user file (or one project
| from its scope) and, if asked, the secrets nothing else refers to.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const loader = require("./McpConfigLoader");
const prerequisites = require("./McpPrerequisites");
const store = require("../secrets/SecretStore");


let override = null;


function catalogFile() {
    return override || path.join(__dirname, "..", "registry", "mcp_catalog.json");
}


let cached = null;


/* tests: read another catalogue file (null restores the shipped one) */
function useCatalogFile(file) {
    override = file || null;
    cached = null;
}


function document() {

    const file = catalogFile();
    const stamp = `${file}:${fs.statSync(file).mtimeMs}`;

    if (!cached || cached.stamp !== stamp) {
        cached = { stamp, value: JSON.parse(fs.readFileSync(file, "utf8")) };
    }

    return cached.value;
}


function failure(message, status, extra = {}) {

    const error = new Error(message);

    error.status = status;
    Object.assign(error, extra);

    return error;
}


function entries() {
    return document().servers || [];
}


function entry(id) {
    return entries().find(item => item.id === id) || null;
}


function installer(id) {
    return (document().installers || {})[id] || null;
}


/* the servers in the user file that came from this catalogue entry */
function installedFrom(id) {

    return loader.userServers()
        .filter(([name, definition]) => definition.catalog === id || (!definition.catalog && name === id))
        .map(([name, definition]) => ({ name, definition }));
}


/* what the console shows: the entry, its prerequisites, its installs */
function list(manager) {

    const status = manager ? manager.status() : { servers: [] };
    const live = new Map(status.servers.map(server => [server.name, server]));
    const doc = document();

    return {
        categories: doc.categories || {},
        servers: entries().map(item => ({
            id: item.id,
            title: item.title,
            category: item.category,
            description: item.description,
            homepage: item.homepage || null,
            transport: item.transport,
            pinned: pinnedLabel(item),
            trust: item.trust || "default",
            inputs: (item.inputs || []).map(input => ({
                id: input.id,
                label: input.label,
                required: input.required !== false,
                secret_name: input.secret || null,
                secret_stored: input.secret ? store.has(input.secret) : false,
                link: input.link || null,
                placeholder: input.placeholder || null,
                default: input.default || null
            })),
            prerequisites: prerequisites.check(item.prerequisites || []),
            installed: installedFrom(item.id).map(({ name, definition }) => {
                const server = live.get(name);
                return {
                    name,
                    scope: definition.scope === "project" ? "project" : "global",
                    projects: definition.scope === "project" ? definition.projects || [] : null,
                    state: server ? (server.enabled ? server.state : "off") : "not loaded",
                    tool_count: server ? server.tool_count : 0,
                    error: server ? server.error : null
                };
            })
        }))
    };
}


function pinnedLabel(item) {

    const server = item.server || {};

    if (server.url) {
        return server.url;
    }

    return [server.command, ...(server.args || [])].join(" ");
}


function substitute(value, replacements) {

    if (typeof value === "string") {

        let dropped = false;

        const replaced = value.replace(/\$\{input:([A-Za-z0-9_-]+)\}/g, (whole, id) => {

            const found = replacements[id];

            if (found === undefined || found === null || found === "") {
                dropped = true;
                return "";
            }

            return found;
        });

        return dropped && replaced.trim() === "" ? undefined : replaced;
    }

    if (Array.isArray(value)) {
        return value
            .map(item => substitute(item, replacements))
            .filter(item => item !== undefined);
    }

    if (value && typeof value === "object") {

        const output = {};

        for (const [key, item] of Object.entries(value)) {

            const next = substitute(item, replacements);

            if (next !== undefined) {
                output[key] = next;
            }
        }

        return output;
    }

    return value;
}


/*
| The definition written to the user file: inputs filled in, a secret as
| a ${secret:NAME} reference (never its value), an optional input that was
| left empty dropped together with the key that used it.
*/
function buildDefinition(item, values, options = {}) {

    const replacements = {};

    for (const input of item.inputs || []) {

        const given = values[input.id];

        if (input.secret) {
            replacements[input.id] =
                (typeof given === "string" && given !== "") || store.has(input.secret)
                    ? `\${secret:${input.secret}}`
                    : "";
        } else {
            replacements[input.id] =
                typeof given === "string" && given.trim() !== ""
                    ? given.trim()
                    : input.default || "";
        }
    }

    const definition = {
        transport: item.transport,
        description: item.description,
        catalog: item.id,
        ...substitute(item.server || {}, replacements)
    };

    if (item.trust && item.trust !== "default") {
        definition.trust = item.trust;
    }

    if (item.browsers_env && options.browsersPath) {
        definition.env = { ...(definition.env || {}), PLAYWRIGHT_BROWSERS_PATH: options.browsersPath };
    }

    if (options.scope === "project") {
        definition.scope = "project";
        definition.projects = options.projects;
    }

    return definition;
}


function checkInputs(item, values) {

    const problems = [];

    for (const input of item.inputs || []) {

        if (input.required === false) {
            continue;
        }

        const given = values[input.id];
        const present = typeof given === "string" && given.trim() !== "";

        if (present) continue;
        if (input.secret && store.has(input.secret)) continue;
        if (!input.secret && input.default) continue;

        problems.push(`${input.label} is required`);
    }

    if (problems.length > 0) {
        throw failure(problems.join("; "), 400, { code: "missing_input" });
    }
}


/*
| activate(manager, id, { inputs, scope: "global"|"project", projectId,
| name }) → { server, scope, projects, tools, persisted_to }.
| Throws with .status 404 (unknown entry), 400 (input), 412 (missing
| prerequisite, before anything is written) or 502 (could not connect).
*/
async function activate(manager, id, options = {}) {

    const item = entry(id);

    if (!item) {
        throw failure(`there is no catalogue entry "${id}"`, 404);
    }

    const values = options.inputs && typeof options.inputs === "object" ? options.inputs : {};
    const scope = options.scope === "project" ? "project" : "global";

    if (scope === "project" && !options.projectId) {
        throw failure("activating for one project needs a project id", 400);
    }

    const absent = prerequisites.missing(item.prerequisites || []);

    if (absent.length > 0) {
        throw failure(
            `${item.title} needs ${absent.map(need => need.label).join(", ")} on this server. ${absent.map(need => need.hint).join(" ")}`,
            412,
            { code: "missing_prerequisite", missing: absent }
        );
    }

    checkInputs(item, values);

    const name = String(options.name || item.id).trim();
    const previous = loader.readUserServer(name);

    /* one project after another can share one entry */
    let projects = null;

    if (scope === "project") {
        const earlier = previous && previous.scope === "project" && Array.isArray(previous.projects) ? previous.projects : [];
        projects = [...new Set([...earlier, String(options.projectId)])];
    }

    const effectiveScope =
        previous && previous.catalog === item.id && previous.scope !== "project" && scope === "project"
            ? "global"
            : scope;

    /* secrets first: the definition only refers to them */
    const createdSecrets = [];
    const replacedSecrets = [];

    for (const input of item.inputs || []) {

        const given = values[input.id];

        if (!input.secret || typeof given !== "string" || given === "") {
            continue;
        }

        if (store.has(input.secret)) {
            replacedSecrets.push({ name: input.secret, value: store.resolve(input.secret) });
        } else {
            createdSecrets.push(input.secret);
        }

        store.set(input.secret, given);
    }

    const definition = buildDefinition(item, values, {
        scope: effectiveScope,
        projects,
        browsersPath:
            require("../config").get("PLAYWRIGHT_BROWSERS_PATH")
                ? prerequisites.browsersPath()
                : null
    });

    const rollback = () => {

        if (previous) {
            loader.writeUserServer(name, previous);
        } else {
            loader.removeUserServer(name);
        }

        for (const secret of createdSecrets) {
            store.remove(secret);
        }

        for (const secret of replacedSecrets) {
            store.set(secret.name, secret.value);
        }
    };

    const file = loader.writeUserServer(name, definition);

    manager.invalidate();
    manager.load();

    const client = manager.client(name);

    if (!client) {

        const problem = (manager.status().problems || []).find(text => text.includes(name));

        rollback();

        throw failure(problem || `"${name}" could not be loaded from ${file}`, 400);
    }

    let tools;

    try {

        if (client.state === "closed") {
            throw new Error("the server was closed while it was being activated");
        }

        await client.ensureReady();
        tools = await client.listTools({ force: true });

    } catch (error) {

        rollback();
        manager.invalidate();
        /* the failed client is closed now, not at some later reload */
        manager.load();

        throw failure(`${item.title} could not be connected: ${error.message}`, 502, { code: "connect_failed" });
    }

    manager.lastDiscoveryAt = null;
    await manager.discover({ force: true }).catch(() => {});

    try {
        require("../events").emit("mcp:added", {
            server: name,
            transport: client.config.transport,
            persisted: true,
            catalog: item.id,
            scope: effectiveScope
        });
    } catch {
        /* best effort */
    }

    return {
        server: name,
        catalog: item.id,
        scope: effectiveScope,
        projects: effectiveScope === "project" ? projects : null,
        persisted_to: file,
        secrets: [...createdSecrets, ...replacedSecrets.map(secret => secret.name)],
        tools: tools.map(tool => ({ name: tool.name, description: tool.description || "" }))
    };
}


/* the secret names a raw definition refers to, from every other user server */
function secretsStillUsed(exceptName) {

    const used = new Set();

    for (const [name, definition] of loader.userServers()) {
        if (name !== exceptName) {
            store.referencesIn(definition, used);
        }
    }

    try {
        const registry = loader.readJsonFile(loader.registryFile());
        if (registry) store.referencesIn(registry, used);
    } catch {
        /* an unreadable registry refers to nothing */
    }

    return used;
}


/*
| deactivate(manager, name, { projectId, forgetSecrets }) → what changed.
| A project-scoped server shared by several projects only loses the
| given project; otherwise the server is removed from the user file and
| disconnected, and the user file is back to what it was before.
*/
async function deactivate(manager, name, options = {}) {

    const definition = loader.readUserServer(name);

    if (!definition) {
        throw failure(`"${name}" is not a server the console activated`, 404);
    }

    if (
        options.projectId &&
        definition.scope === "project" &&
        Array.isArray(definition.projects) &&
        definition.projects.length > 1 &&
        definition.projects.includes(String(options.projectId))
    ) {

        loader.writeUserServer(name, {
            ...definition,
            projects: definition.projects.filter(project => project !== String(options.projectId))
        });

        manager.invalidate();

        return { server: name, removed: false, projects_left: definition.projects.length - 1, secrets_removed: [] };
    }

    const references = store.referencesIn(definition);

    loader.removeUserServer(name);

    await manager.remove(name, { persist: false });

    manager.invalidate();

    const removedSecrets = [];

    if (options.forgetSecrets) {

        const used = secretsStillUsed(name);

        for (const secret of references) {
            if (!used.has(secret) && store.remove(secret)) {
                removedSecrets.push(secret);
            }
        }
    }

    return { server: name, removed: true, secrets_removed: removedSecrets };
}


module.exports = {
    catalogFile,
    useCatalogFile,
    entries,
    entry,
    installer,
    list,
    buildDefinition,
    activate,
    deactivate,
    secretsStillUsed
};
