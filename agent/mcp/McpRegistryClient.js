"use strict";

/*
|--------------------------------------------------------------------------
| The official MCP registry (roadmap P4-12)
|--------------------------------------------------------------------------
|
| Servers that are not in the bundled catalogue, from MCP_REGISTRY_URL
| (registry.modelcontextprotocol.io by default), generic registry API:
|
|   GET /v0.1/servers?search=<name>&version=latest&limit=<n>&cursor=<c>
|   GET /v0.1/servers/<url-encoded name>/versions/<version|latest>
|
| A record is a server.json: packages (npm, pypi, oci … each with its
| transport, runtime hints and environment variables) and remotes
| (streamable-http, sse). definitionFor() turns one choice into a server
| definition this runtime runs:
|
|   npm     npx -y <identifier>@<version> <package arguments>
|   pypi    uvx <identifier>==<version> <package arguments>
|   oci     docker run -i --rm -e NAME … <identifier>:<version>
|   remote  its url (http or sse); oauth: true unless it takes header inputs
|
| A required input without a value is reported, never guessed. Registry
| servers are written to the user file as trust "restricted" (every call
| asks) unless the operator says otherwise, after the console has shown
| that the registry does not vet what it lists.
|--------------------------------------------------------------------------
*/

const settings = require("../config");

const TRUST_WARNING =
    "The MCP registry lists servers anyone can publish; it does not review their code. " +
    "A server you add runs with the access you give it (a local one runs as a program on this machine). " +
    "Add only servers whose publisher you trust; it starts restricted, so every call asks for approval.";


function baseUrl() {

    const configured = String(settings.get("MCP_REGISTRY_URL") || "").trim().replace(/\/$/, "");

    if (!configured) {
        throw Object.assign(new Error("registry search is off (MCP_REGISTRY_URL is empty)"), { status: 404 });
    }

    return configured;
}


async function getJson(url) {

    let response;

    try {
        response = await fetch(url, { headers: { accept: "application/json" } });
    } catch (error) {
        throw Object.assign(new Error(`the MCP registry is unreachable: ${error.message}`), { status: 502 });
    }

    const text = await response.text();
    let payload = null;

    try {
        payload = JSON.parse(text);
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const detail = payload && (payload.detail || payload.title || payload.error) || text.slice(0, 200);
        throw Object.assign(new Error(`the MCP registry answered ${response.status}${detail ? `: ${detail}` : ""}`), { status: response.status === 404 ? 404 : response.status === 422 ? 400 : 502 });
    }

    return payload;
}


function inputView(input) {

    return {
        name: input.name,
        description: input.description || null,
        required: input.isRequired === true,
        secret: input.isSecret === true,
        default: input.default ?? input.value ?? null,
        choices: Array.isArray(input.choices) ? input.choices : null
    };
}


function normalize(record) {

    const server = record && record.server ? record.server : record || {};
    const official = (record && record._meta && record._meta["io.modelcontextprotocol.registry/official"]) || {};

    const packages = (server.packages || []).map((item, index) => ({
        choice: `package:${index}`,
        registryType: item.registryType || item.registry_type || null,
        identifier: item.identifier || item.name || null,
        version: item.version || server.version || null,
        runtimeHint: item.runtimeHint || null,
        transport: (item.transport && item.transport.type) || "stdio",
        env: (item.environmentVariables || item.environment_variables || []).map(inputView),
        arguments: (item.packageArguments || []).map(argument => ({ ...inputView(argument), type: argument.type, flag: argument.type === "named" ? argument.name : null, valueHint: argument.valueHint || null }))
    }));

    const remotes = (server.remotes || []).map((item, index) => ({
        choice: `remote:${index}`,
        type: item.type || item.transport_type || null,
        url: item.url || null,
        headers: (item.headers || []).map(inputView)
    }));

    return {
        name: server.name,
        title: server.title || null,
        description: server.description || "",
        version: server.version || null,
        repository: server.repository && server.repository.url ? server.repository.url : null,
        website: server.websiteUrl || null,
        status: official.status || server.status || "active",
        published_at: official.publishedAt || null,
        is_latest: official.isLatest !== false,
        packages,
        remotes,
        installable:
            packages.some(item => ["npm", "pypi", "oci"].includes(item.registryType) && item.transport === "stdio") ||
            remotes.some(item => ["streamable-http", "sse"].includes(item.type) && item.url)
    };
}


async function search(query, { limit = 20, cursor = null } = {}) {

    const text = String(query || "").trim();

    if (text.length > 0 && text.length < 3) {
        throw Object.assign(new Error("search for at least three characters"), { status: 400 });
    }

    const url = new URL(`${baseUrl()}/v0.1/servers`);

    if (text) url.searchParams.set("search", text);

    url.searchParams.set("version", "latest");
    url.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 20, 1), 100)));

    if (cursor) url.searchParams.set("cursor", String(cursor));

    const payload = await getJson(url);
    const servers = (payload && Array.isArray(payload.servers) ? payload.servers : []).map(normalize);

    return {
        registry: baseUrl(),
        query: text,
        servers: servers.filter(server => server.status !== "deleted"),
        next_cursor: (payload && payload.metadata && (payload.metadata.nextCursor || payload.metadata.next_cursor)) || null,
        warning: TRUST_WARNING
    };
}


async function get(name, version = "latest") {

    const payload = await getJson(`${baseUrl()}/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version || "latest")}`);

    return normalize(payload);
}


/* "io.github.someone/weather-server" → "weather-server" */
function localName(registryName) {

    const last = String(registryName || "").split("/").pop() || "server";

    return last.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 64) || "server";
}


/*
| inputs: {NAME: value}. A secret value is not written into the file: the
| caller stores it in the secret store and passes ${secret:NAME} instead
| (see the route). Returns {definition, missing}.
*/
function definitionFor(server, { choice = null, inputs = {} } = {}) {

    const pick =
        choice
            ? [...server.packages, ...server.remotes].find(item => item.choice === choice)
            : server.packages.find(item => ["npm", "pypi", "oci"].includes(item.registryType) && item.transport === "stdio") ||
              server.remotes.find(item => ["streamable-http", "sse"].includes(item.type));

    if (!pick) {
        throw Object.assign(new Error(`"${server.name}" offers no package or remote this runtime can run (npm, pypi or oci over stdio; streamable-http or sse)`), { status: 400 });
    }

    const missing = [];

    const valueOf = input => {
        const value = inputs[input.name] ?? input.default;
        if ((value === undefined || value === null || value === "") && input.required) missing.push(input);
        return value === undefined || value === null ? null : String(value);
    };

    if (pick.choice.startsWith("remote:")) {

        const headers = {};

        for (const header of pick.headers) {
            const value = valueOf(header);
            if (value !== null && value !== "") headers[header.name.toLowerCase()] = value;
        }

        return {
            missing,
            definition: {
                transport: pick.type === "sse" ? "sse" : "http",
                url: pick.url,
                ...(Object.keys(headers).length ? { headers } : { oauth: true }),
                description: server.description.slice(0, 300),
                registry: { name: server.name, version: server.version }
            }
        };
    }

    const env = {};

    for (const variable of pick.env) {
        const value = valueOf(variable);
        if (value !== null && value !== "") env[variable.name] = value;
    }

    const packageArgs = [];

    for (const argument of pick.arguments) {
        const value = valueOf(argument);
        if (value === null || value === "") continue;
        if (argument.flag) packageArgs.push(argument.flag, value);
        else packageArgs.push(value);
    }

    let command;
    let args;

    if (pick.registryType === "npm") {
        command = "npx";
        args = ["-y", pick.version ? `${pick.identifier}@${pick.version}` : pick.identifier, ...packageArgs];
    } else if (pick.registryType === "pypi") {
        command = "uvx";
        args = [pick.version ? `${pick.identifier}==${pick.version}` : pick.identifier, ...packageArgs];
    } else if (pick.registryType === "oci") {
        command = "docker";
        const image = pick.identifier.includes(":") || !pick.version ? pick.identifier : `${pick.identifier}:${pick.version}`;
        args = ["run", "-i", "--rm", ...Object.keys(env).flatMap(key => ["-e", key]), image, ...packageArgs];
    } else {
        throw Object.assign(new Error(`packages from ${pick.registryType} are not supported; choose another package or a remote`), { status: 400 });
    }

    if (pick.transport !== "stdio") {
        throw Object.assign(new Error(`this package speaks ${pick.transport}, not stdio; choose a remote instead`), { status: 400 });
    }

    return {
        missing,
        definition: {
            transport: "stdio",
            command,
            args,
            ...(Object.keys(env).length ? { env } : {}),
            description: server.description.slice(0, 300),
            registry: { name: server.name, version: server.version }
        }
    };
}


module.exports = { TRUST_WARNING, baseUrl, normalize, search, get, localName, definitionFor };
