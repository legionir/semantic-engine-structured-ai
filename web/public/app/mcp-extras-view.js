/*
|--------------------------------------------------------------------------
| MCP panel views, roadmap group 6
|--------------------------------------------------------------------------
|
|   ServerControls  per-tool switches, read / write approval, OAuth
|                   sign-in, resources and prompts, the running call's
|                   progress (P4-07, P4-08, P4-10)
|   ImportPanel     paste another client's config, preview, resolve
|                   duplicates, merge (P4-05)
|   RegistryPanel   the MCP registry, behind its trust warning (P4-12)
|
| State and actions: mcp-extras.js.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";
import { approvalLabel, createMcpExtrasState, importSummary, progressLabel, registryInputs } from "./mcp-extras.js";


function ToolSwitches({ server, actions, busy }) {

    const tools = server.tools || [];

    if (tools.length === 0) {
        return html`<p class="muted">No tools listed yet.</p>`;
    }

    return html`<ul class="mcp-tool-switches">
        ${tools.map(tool => html`<li key=${tool.name} class=${tool.enabled ? "" : "off"}>
            <label>
                <input
                    type="checkbox"
                    checked=${tool.enabled}
                    disabled=${busy}
                    onChange=${event => actions.toolEnabled(server.name, tool.name, event.currentTarget.checked)}
                />
                <span class="name">${tool.name}</span>
                <span class=${`chip ${tool.read_only ? "read" : "write"}`}>${tool.read_only ? "read" : "write"}</span>
            </label>
            <span class="facts">${tool.description || ""}</span>
        </li>`)}
    </ul>`;
}


function ApprovalSelect({ server, kind, actions, busy }) {

    const current = (server.approval && server.approval[kind]) || "inherit";

    return html`<label class="mcp-field mcp-approval">
        <span class="label">${kind === "read" ? "read-only tools" : "writing tools"}</span>
        <select disabled=${busy} onChange=${event => actions.approval(server.name, kind, event.currentTarget.value, server.approval)}>
            ${["inherit", "always", "never"].map(value =>
                html`<option value=${value} selected=${value === current}>${approvalLabel(value)}</option>`)}
        </select>
    </label>`;
}


function Browser({ browsing, actions }) {

    if (browsing.error) return html`<div class="mcp-error">${browsing.error}</div>`;
    if (!browsing.items) return html`<p class="muted">loading…</p>`;

    if (browsing.kind === "resources") {
        return html`<div class="mcp-browser">
            ${browsing.items.length === 0 && browsing.templates.length === 0 ? html`<p class="muted">This server offers no resources.</p>` : null}
            <ul>${browsing.items.map(item => html`<li key=${item.uri}>
                <button type="button" class="linkish" onClick=${() => actions.readResource(browsing.server, item.uri)}>${item.name || item.uri}</button>
                <span class="facts">${item.uri}${item.mimeType ? ` · ${item.mimeType}` : ""}</span>
            </li>`)}</ul>
            ${browsing.templates.length ? html`<p class="muted">templates: ${browsing.templates.map(item => item.uriTemplate).join(", ")}</p>` : null}
            ${browsing.reading ? html`<pre class="mcp-resource-text">${browsing.reading.text}</pre>` : null}
        </div>`;
    }

    return html`<div class="mcp-browser">
        ${browsing.items.length === 0 ? html`<p class="muted">This server offers no prompts.</p>` : null}
        <ul>${browsing.items.map(prompt => html`<li key=${prompt.name}>
            <button type="button" class="linkish" onClick=${() => actions.usePrompt(browsing.server, prompt)}>/${browsing.server}:${prompt.name}</button>
            <span class="facts">${prompt.description || ""}</span>
        </li>`)}</ul>
        <p class="muted">Type / in the message box to use these as commands.</p>
    </div>`;
}


export function ServerControls({ server, mcp, actions }) {

    const box = mcp.extras || createMcpExtrasState();
    const busy = mcp.pending.has(server.name);
    const open = box.expanded.has(server.name);
    const capabilities = server.capabilities || [];
    const progress = (mcp.progress || new Map()).get(server.name);
    const browsing = box.browsing && box.browsing.server === server.name ? box.browsing : null;

    return html`<div class="mcp-controls">
        ${progress ? html`<div class="mcp-progress">
            <progress max=${progress.total || 1} value=${progress.total ? progress.progress : undefined}></progress>
            <span class="muted">${progressLabel(progress)}</span>
        </div>` : null}
        ${server.oauth ? html`<div class="mcp-oauth">
            ${server.oauth.signed_in
                ? html`<span class="chip ok">signed in</span>
                    <button type="button" class="ghost" disabled=${busy} onClick=${() => actions.signOut(server.name)}>Sign out</button>`
                : html`<span class="chip warn">sign-in needed</span>
                    <button type="button" disabled=${busy} onClick=${() => actions.signIn(server.name)}>Sign in</button>`}
        </div>` : null}
        <div class="mcp-actions">
            <button type="button" class="ghost" onClick=${() => actions.expand(server.name)}>${open ? "Hide tools" : `Tools & approval`}</button>
            ${capabilities.includes("resources") ? html`<button type="button" class="ghost" onClick=${() => actions.browse(server.name, "resources")}>Resources</button>` : null}
            ${capabilities.includes("prompts") ? html`<button type="button" class="ghost" onClick=${() => actions.browse(server.name, "prompts")}>Prompts</button>` : null}
        </div>
        ${open ? html`<div class="mcp-tools-panel">
            <div class="mcp-approval-row">
                <${ApprovalSelect} server=${server} kind="read" actions=${actions} busy=${busy} />
                <${ApprovalSelect} server=${server} kind="write" actions=${actions} busy=${busy} />
            </div>
            ${server.agents ? html`<p class="muted">Only for: ${server.agents.join(", ")}</p>` : null}
            <${ToolSwitches} server=${server} actions=${actions} busy=${busy} />
        </div>` : null}
        ${browsing ? html`<${Browser} browsing=${browsing} actions=${actions} />` : null}
    </div>`;
}


export function ImportPanel({ mcp, actions }) {

    const box = (mcp.extras || createMcpExtrasState()).imports;
    const summary = importSummary(box.preview);

    return html`<div class="mcp mcp-import">
        <p class="muted">Paste the MCP configuration of another client (Claude Desktop, Cursor, VS Code, Zed, Windsurf…). Nothing is written until you import.</p>
        <textarea
            class="mcp-raw-json mcp-import-text"
            spellcheck=${false}
            aria-label="MCP configuration to import"
            placeholder='{"mcpServers": {"github": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"]}}}'
            defaultValue=${box.text}
            onInput=${event => actions.importText(event.currentTarget.value)}
        ></textarea>
        <div class="modal-row">
            <label class="mcp-field">
                <span class="label">into</span>
                <select onChange=${event => actions.importTarget(event.currentTarget.value)}>
                    <option value="user" selected=${box.target === "user"}>All projects (user config)</option>
                    <option value="workspace" selected=${box.target === "workspace"}>This workspace (.agent/mcp.json)</option>
                </select>
            </label>
            <button type="button" class="ghost" disabled=${box.busy} onClick=${() => actions.previewImport()}>Preview</button>
        </div>
        ${box.preview ? html`<div class="mcp-import-preview">
            <p>${`${summary.total} server${summary.total === 1 ? "" : "s"}${summary.client ? ` from ${summary.client}` : ""}: ${summary.fresh} new, ${summary.identical} already the same, ${summary.conflicts} conflicting, ${summary.invalid} invalid`}</p>
            <ul>${box.preview.entries.map(entry => html`<li key=${entry.name} class=${`import-${entry.status}`}>
                <span class="name">${entry.name}</span>
                <span class="chip">${entry.status}</span>
                ${entry.error ? html`<span class="mcp-error">${entry.error}</span>` : null}
                ${(entry.needs_input || []).length ? html`<span class="muted">asks for: ${entry.needs_input.join(", ")}</span>` : null}
                ${entry.status === "conflict" ? html`<select aria-label=${`what to do with ${entry.name}`} onChange=${event => {
                    const value = event.currentTarget.value;
                    actions.resolution(entry.name, value === "rename" ? `rename:${entry.name}-imported` : value);
                }}>
                    <option value="">choose…</option>
                    <option value="skip">keep mine (skip)</option>
                    <option value="replace">replace mine</option>
                    <option value="rename">${`import as ${entry.name}-imported`}</option>
                </select>` : null}
            </li>`)}</ul>
            <button type="button" disabled=${box.busy || summary.total === summary.invalid} onClick=${() => actions.runImport()}>Import</button>
        </div>` : null}
        ${box.error ? html`<p class="mcp-config-message bad">${box.error}</p>` : null}
        ${box.notice ? html`<p class="mcp-config-message">${box.notice}</p>` : null}
    </div>`;
}


export function RegistryPanel({ mcp, actions }) {

    const box = (mcp.extras || createMcpExtrasState()).registry;
    const inputs = registryInputs(box.picked);

    return html`<div class="mcp mcp-registry">
        <div class="mcp-trust-warning" role="note">
            <strong>Registry servers are not reviewed.</strong>
            Anyone can publish to the MCP registry. A server you add runs with the access you give it; a local one runs as a program on this machine.
            Add only servers whose publisher you trust. Added servers start restricted: every call asks for approval.
        </div>
        <form class="modal-row" onSubmit=${event => { event.preventDefault(); actions.searchRegistry(false); }}>
            <input type="search" placeholder="search by name, at least 3 letters" defaultValue=${box.query} onInput=${event => actions.registryQuery(event.currentTarget.value)} />
            <button type="submit" disabled=${box.busy}>Search</button>
        </form>
        ${box.error ? html`<p class="mcp-config-message bad">${box.error}</p>` : null}
        ${box.notice ? html`<p class="mcp-config-message">${box.notice}</p>` : null}
        ${box.results && box.results.length === 0 ? html`<p class="empty">Nothing found.</p>` : null}
        ${(box.results || []).map(server => html`<div class="mcp-server" key=${server.name}>
            <div class="mcp-head">
                <span class="name">${server.title || server.name}</span>
                <span class="chip">${server.version || ""}</span>
                ${server.installable ? null : html`<span class="chip warn">not runnable here</span>`}
            </div>
            <div class="facts">${server.name}${server.repository ? ` · ${server.repository}` : ""}</div>
            <div class="facts">${server.description}</div>
            ${server.installable ? html`<div class="mcp-actions">
                <button type="button" class="ghost" onClick=${() => actions.pickRegistry(server)}>${box.picked && box.picked.name === server.name ? "Cancel" : "Add…"}</button>
            </div>` : null}
            ${box.picked && box.picked.name === server.name ? html`<div class="mcp-registry-add">
                ${inputs.map(input => html`<label class="mcp-field" key=${input.name}>
                    <span class="label">${input.name}${input.required ? " *" : ""}</span>
                    <input
                        type=${input.secret ? "password" : "text"}
                        autocomplete="off"
                        placeholder=${input.description || input.default || ""}
                        onInput=${event => actions.registryInput(input.name, event.currentTarget.value)}
                    />
                </label>`)}
                ${inputs.some(input => input.secret) ? html`<p class="muted">Secret values go to the encrypted secret store; the config only names them.</p>` : null}
                <label class="mcp-ack">
                    <input type="checkbox" checked=${box.acknowledged} onChange=${event => actions.acknowledge(event.currentTarget.checked)} />
                    I trust this publisher and understand the server is not reviewed.
                </label>
                <button type="button" disabled=${box.busy || !box.acknowledged} onClick=${() => actions.addFromRegistry()}>Add server</button>
            </div>` : null}
        </div>`)}
        ${box.cursor ? html`<button type="button" class="ghost" disabled=${box.busy} onClick=${() => actions.searchRegistry(true)}>More</button>` : null}
    </div>`;
}
