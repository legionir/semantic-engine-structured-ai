/*
|--------------------------------------------------------------------------
| MCP view
|--------------------------------------------------------------------------
|
| The servers this runtime can reach and the tools they offer, plus the
| raw workspace config. The body is drawn from the store, so a refresh
| (a toggle, a reconnect, a save) updates the list in place: a half-filled
| "Connect a server" form and an edited JSON buffer survive it, which the
| old rebuild-on-refresh did not allow.
|
| Form fields and the JSON editor are uncontrolled; a successful connect
| clears the form by remounting it (formKey), and a freshly loaded config
| replaces the buffer by remounting the editor (configKey).
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";


const DEFAULT_CONFIG = '{\n  "mcpServers": {}\n}\n';

const ENV_PLACEHOLDER =
    '{"GITHUB_TOKEN":"${env:GITHUB_TOKEN}"} or\\nGITHUB_TOKEN=ghp_xxx\\nNODE_ENV=production';


export function createMcpState() {

    return {
        payload: null,
        tab: "servers",
        transport: "stdio",
        formKey: 0,
        formMessage: "",
        connecting: false,
        rowErrors: new Map(),
        pending: new Set(),
        configText: DEFAULT_CONFIG,
        configPath: "",
        configKey: 0,
        configError: null,
        configNotice: "",
        saving: false
    };
}


export function mcpStateLabel(server) {

    if (!server.enabled) {
        return "off";
    }

    return {
        ready: "connected",
        idle: "not contacted yet",
        connecting: "connecting",
        failed: "unreachable",
        closed: "closed"
    }[server.state] || server.state;
}


export function mcpSubtitle(payload) {

    const servers = Array.isArray(payload?.servers) ? payload.servers : [];

    return `${payload?.tool_count || 0} tool(s) from ${
        servers.filter(server => server.state === "ready").length} connected server(s)`;
}


/* env accepts a JSON object or KEY=VALUE lines (# comments allowed) */
export function parseEnvInput(raw) {

    const trimmed = String(raw ?? "").trim();

    if (!trimmed) return undefined;

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
        /* not JSON: KEY=VALUE lines */
    }

    const env = {};

    for (const line of trimmed.split(/\n/)) {
        const entry = line.trim();
        if (!entry || entry.startsWith("#")) continue;
        const eq = entry.indexOf("=");
        if (eq === -1) continue;
        const key = entry.slice(0, eq).trim();
        if (key) env[key] = entry.slice(eq + 1).trim();
    }

    return Object.keys(env).length ? env : undefined;
}


/* the POST /api/mcp body from the add form's fields */
export function connectBody(form) {

    const value = name => String(form.elements.namedItem(name)?.value ?? "").trim();
    const args = value("command_args") ? value("command_args").split(/\s+/) : undefined;

    return {
        name: value("name"),
        transport: value("transport") || "stdio",
        command: value("command") || undefined,
        args,
        command_args: args,
        url: value("url") || undefined,
        token: value("token") || undefined,
        env: parseEnvInput(form.elements.namedItem("env")?.value)
    };
}


function serverFacts(server) {

    const facts = [];

    if (server.server?.name) facts.push(`${server.server.name} ${server.server.version || ""}`.trim());
    if (server.connection?.url) facts.push(server.connection.url);
    if (server.connection?.command) {
        facts.push([server.connection.command, ...(server.connection.args || [])].join(" "));
    }

    facts.push(`${server.tool_count} tool${server.tool_count === 1 ? "" : "s"}`);

    if (server.stats?.calls) facts.push(`${server.stats.calls} call${server.stats.calls === 1 ? "" : "s"}`);

    return facts.join(" · ");
}


function ServerRow({ server, mcp, actions }) {

    const stateClass = server.enabled ? server.state : "off";
    const busy = mcp.pending.has(server.name);
    const failure = mcp.rowErrors.get(server.name);

    return html`<div class=${`mcp-server ${stateClass}`}>
        <div class="mcp-head">
            <span class="name">${server.name}</span>
            <span class="chip">${server.transport}</span>
            <span class=${`state ${stateClass}`}>${mcpStateLabel(server)}</span>
            ${server.builtin ? html`<span class="chip">built-in</span>` : null}
        </div>
        <div class="facts">${serverFacts(server)}</div>
        ${server.error ? html`<div class="mcp-error">${server.error}</div>` : null}
        ${failure ? html`<div class="mcp-error">${failure}</div>` : null}
        <div class="mcp-actions">
            <button type="button" class="ghost" disabled=${busy} onClick=${() => actions.toggle(server)}>
                ${server.enabled ? "Disable" : "Enable"}
            </button>
            <button type="button" class="ghost danger" disabled=${busy} onClick=${() => actions.remove(server)}>Remove</button>
        </div>
    </div>`;
}


function Field({ name, label, placeholder, hidden }) {

    return html`<label class="mcp-field" hidden=${hidden}>
        <span class="label">${label}</span>
        <input type="text" name=${name} placeholder=${placeholder} />
    </label>`;
}


function AddForm({ mcp, actions }) {

    const local = mcp.transport === "stdio";

    return html`<form class="mcp-add" key=${mcp.formKey} onSubmit=${event => { event.preventDefault(); actions.connect(event.currentTarget); }}>
        <h3>Connect a server</h3>
        <label class="mcp-field">
            <span class="label">transport</span>
            <select name="transport" onChange=${event => actions.transport(event.currentTarget.value)}>
                ${["stdio", "http", "sse", "websocket"].map(value =>
                    html`<option value=${value} selected=${value === mcp.transport}>${value}</option>`)}
            </select>
        </label>
        <${Field} name="name" label="name" placeholder="github" />
        <${Field} name="command" label="command" placeholder="npx (stdio only)" hidden=${!local} />
        <${Field} name="command_args" label="arguments" placeholder="-y @modelcontextprotocol/server-github" hidden=${!local} />
        <${Field} name="url" label="url" placeholder="https://host/mcp (http, sse, websocket)" hidden=${local} />
        <${Field} name="token" label="token" placeholder="bearer token, optional" hidden=${local} />
        <label class="mcp-field" hidden=${!local}>
            <span class="label">env (JSON or KEY=VALUE lines)</span>
            <textarea
                name="env"
                rows="3"
                class="mcp-env"
                placeholder=${ENV_PLACEHOLDER}
            ></textarea>
        </label>
        <p class="mcp-message">${mcp.formMessage}</p>
        <div class="modal-row">
            <button type="submit" disabled=${mcp.connecting}>Connect</button>
        </div>
    </form>`;
}


function Servers({ mcp, actions }) {

    const payload = mcp.payload || {};

    if (!payload.enabled) {
        return html`<div class="mcp">
            <p class="empty">MCP is switched off. Turn MCP_ENABLED on in Settings to reach external servers.</p>
        </div>`;
    }

    const servers = payload.servers || [];
    const tools = payload.tools || [];

    return html`<div class="mcp">
        ${servers.length === 0
            ? html`<p class="empty">No MCP servers are configured. Add one below, or declare it in .mcp.json in the workspace.</p>`
            : null}
        ${servers.map(server => html`<${ServerRow} key=${server.name} server=${server} mcp=${mcp} actions=${actions} />`)}
        ${(payload.problems || []).map((problem, index) => html`<div class="mcp-error" key=${`p${index}`}>${problem}</div>`)}
        ${tools.length > 0 ? html`<div class="mcp-tools">
            <h3>${`${tools.length} tool${tools.length === 1 ? "" : "s"} available`}</h3>
            ${tools.map(tool => html`<div class="mcp-tool" key=${tool.name}>
                <span class="name">${tool.name}</span>
                <span class="facts">${tool.description || ""}</span>
            </div>`)}
        </div>` : null}
        <${AddForm} mcp=${mcp} actions=${actions} />
    </div>`;
}


function JsonEditor({ mcp, actions }) {

    const message = mcp.configError || mcp.configNotice || "";

    return html`<section class="mcp-tab-panel mcp-json-editor" hidden=${mcp.tab !== "json"}>
        <p class="muted mcp-config-path">${mcp.configPath
            ? `Workspace config: ${mcp.configPath}`
            : "Workspace MCP config (.agent/mcp.json)"}</p>
        <textarea
            key=${mcp.configKey}
            class="mcp-raw-json"
            spellcheck=${false}
            aria-label="Raw MCP server JSON"
            defaultValue=${mcp.configText}
        ></textarea>
        <button type="button" disabled=${mcp.saving} onClick=${event =>
            actions.save(event.currentTarget.parentElement.querySelector(".mcp-raw-json").value)}>Save JSON</button>
        <p class=${`mcp-config-message${mcp.configError ? " bad" : ""}`}>${message}</p>
    </section>`;
}


export function McpBody({ mcp, actions }) {

    return html`<div class="mcp-workspace">
        <div class="mcp-tabs">
            <button type="button" class=${`mcp-tab${mcp.tab === "servers" ? " active" : ""}`} onClick=${() => actions.tab("servers")}>Servers</button>
            <button type="button" class=${`mcp-tab${mcp.tab === "json" ? " active" : ""}`} onClick=${() => actions.tab("json")}>Raw JSON</button>
        </div>
        <div class="mcp-tab-panel" hidden=${mcp.tab !== "servers"}>
            <${Servers} mcp=${mcp} actions=${actions} />
        </div>
        <${JsonEditor} mcp=${mcp} actions=${actions} />
    </div>`;
}
