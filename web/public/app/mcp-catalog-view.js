/*
|--------------------------------------------------------------------------
| MCP catalogue and secrets view (roadmap P4-01 … P4-03)
|--------------------------------------------------------------------------
|
| The catalogue tab draws one card per entry: its pinned command or URL,
| its prerequisites (with a one-click install where there is one), where
| it is installed, and the activation form: a password field per secret
| input, the scope, and the tools it brought once connected. The secrets
| tab lists names only; a value is typed into a form that is remounted
| (emptied) as soon as it was saved.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";
import { SkeletonCards, SkeletonRows } from "./skeleton-view.js";


/*
|--------------------------------------------------------------------------
| Catalogue (P4-02) with prerequisites (P4-03)
|--------------------------------------------------------------------------
*/

function Prerequisite({ item, mcp, actions }) {

    const job = mcp.installs.get(item.id);
    const running = job && job.status === "running";

    return html`<li class=${`mcp-prereq ${item.ok ? "ok" : "missing"}`}>
        <span class="mark">${item.ok ? "✓" : "✗"}</span>
        <span class="label">${item.label}</span>
        ${item.ok ? html`<span class="muted path">${item.path || ""}</span>` : html`<span class="hint">${item.hint}</span>`}
        ${!item.ok && item.installable ? html`<span class="mcp-install">
            <button type="button" class="ghost" disabled=${running} onClick=${() => actions.install(item.id)}>
                ${running ? "Installing…" : "Install"}
            </button>
            ${job ? html`<progress max="100" value=${job.percent || 0}></progress>
                <span class="muted">${job.status === "running"
                    ? `${job.percent || 0}% ${job.phase || ""}`
                    : job.status === "succeeded" ? "installed" : job.error || "failed"}</span>` : null}
        </span>` : null}
    </li>`;
}


function ActivationForm({ entry, mcp, actions, project }) {

    const activation = mcp.activation;

    return html`<form class="mcp-activate" key=${`${entry.id}:${mcp.activationKey}`} onSubmit=${event => { event.preventDefault(); actions.activate(entry, event.currentTarget); }}>
        ${entry.inputs.length === 0 ? html`<p class="muted">No token is needed.</p>` : null}
        ${entry.inputs.map(input => html`<label class="mcp-field" key=${input.id}>
            <span class="label">${input.label}${input.required ? "" : " (optional)"}</span>
            <input
                type=${input.secret_name ? "password" : "text"}
                name=${input.id}
                autocomplete="off"
                defaultValue=${input.secret_name ? "" : input.default || ""}
                placeholder=${input.secret_stored ? `stored as ${input.secret_name} — leave empty to keep it` : input.placeholder || ""}
            />
            ${input.link ? html`<a class="mcp-token-link" href=${input.link} target="_blank" rel="noopener noreferrer">Get one</a>` : null}
            ${input.secret_name ? html`<span class="muted">kept encrypted as \${secret:${input.secret_name}}</span>` : null}
        </label>`)}
        <label class="mcp-field">
            <span class="label">available to</span>
            <select name="scope">
                <option value="global">every project</option>
                ${project ? html`<option value="project">only ${project.name || project.id}</option>` : null}
            </select>
        </label>
        ${activation.error ? html`<p class="mcp-error">${activation.error}</p>` : null}
        <div class="modal-row">
            <button type="submit" disabled=${activation.busy}>${activation.busy ? "Connecting…" : "Activate"}</button>
            <button type="button" class="ghost" onClick=${() => actions.closeEntry()}>Cancel</button>
        </div>
    </form>`;
}


function CatalogCard({ entry, mcp, actions, project, categories }) {

    const open = mcp.activeEntry === entry.id;
    const missing = entry.prerequisites.filter(item => !item.ok);
    const result = mcp.activation.result && mcp.activation.result.catalog === entry.id ? mcp.activation.result : null;
    const failure = mcp.entryErrors.get(entry.id);

    return html`<div class=${`mcp-card${entry.installed.length ? " installed" : ""}`}>
        <div class="mcp-head">
            <span class="name">${entry.title}</span>
            <span class="chip">${categories[entry.category] || entry.category}</span>
            <span class="chip">${entry.transport}</span>
            ${entry.trust !== "default" ? html`<span class="chip">${entry.trust}</span>` : null}
        </div>
        <p class="mcp-card-description">${entry.description}</p>
        <code class="mcp-pinned">${entry.pinned}</code>
        ${entry.prerequisites.length ? html`<ul class="mcp-prereqs">
            ${entry.prerequisites.map(item => html`<${Prerequisite} key=${item.id} item=${item} mcp=${mcp} actions=${actions} />`)}
        </ul>` : null}
        ${entry.installed.map(install => html`<div class="mcp-installed" key=${install.name}>
            <span class=${`mcp-dot ${install.state}`}></span>
            <span>${install.name}</span>
            <span class="muted">${install.scope === "project" ? `projects: ${(install.projects || []).join(", ")}` : "every project"}</span>
            <span class="muted">${install.state}${install.tool_count ? ` · ${install.tool_count} tools` : ""}</span>
            <button type="button" class="ghost danger" disabled=${mcp.deactivating.has(install.name)} onClick=${() => actions.deactivate(entry, install)}>Deactivate</button>
            ${install.error ? html`<div class="mcp-error">${install.error}</div>` : null}
        </div>`)}
        ${failure ? html`<div class="mcp-error">${failure}</div>` : null}
        ${result ? html`<div class="mcp-activated">
            <strong>${`Connected: ${result.tools.length} tool${result.tools.length === 1 ? "" : "s"}`}</strong>
            <ul>${result.tools.map(tool => html`<li key=${tool.name}><span class="name">${tool.name}</span> <span class="muted">${tool.description}</span></li>`)}</ul>
        </div>` : null}
        ${open
            ? html`<${ActivationForm} entry=${entry} mcp=${mcp} actions=${actions} project=${project} />`
            : html`<div class="mcp-actions">
                <button type="button" disabled=${missing.length > 0} title=${missing.length ? `missing: ${missing.map(item => item.label).join(", ")}` : ""} onClick=${() => actions.openEntry(entry)}>
                    ${entry.installed.length ? "Activate again" : "Activate"}
                </button>
                ${entry.homepage ? html`<a class="ghost mcp-token-link mcp-about-link" href=${entry.homepage} target="_blank" rel="noopener noreferrer">About</a>` : null}
            </div>`}
    </div>`;
}


export function Catalog({ mcp, actions, project }) {

    if (mcp.catalogError) {
        return html`<p class="mcp-error">${mcp.catalogError}</p>`;
    }

    if (!mcp.catalog) {
        return html`<${SkeletonCards} count=${4} label="Loading the catalogue…" />`;
    }

    const filter = mcp.catalogFilter.trim().toLowerCase();
    const categories = mcp.catalog.categories || {};
    const servers = mcp.catalog.servers.filter(entry => !filter ||
        `${entry.title} ${entry.description} ${entry.category}`.toLowerCase().includes(filter));

    return html`<div class="mcp-catalog">
        <div class="mcp-catalog-tools">
            <input type="search" placeholder="Filter the catalogue" defaultValue=${mcp.catalogFilter} onInput=${event => actions.filter(event.currentTarget.value)} />
            <label class="mcp-forget"><input type="checkbox" checked=${mcp.forgetSecrets} onChange=${event => actions.forgetSecrets(event.currentTarget.checked)} /> deactivating also deletes secrets nothing else uses</label>
        </div>
        <div class="mcp-cards">
            ${servers.map(entry => html`<${CatalogCard} key=${entry.id} entry=${entry} mcp=${mcp} actions=${actions} project=${project} categories=${categories} />`)}
        </div>
    </div>`;
}


/*
|--------------------------------------------------------------------------
| Secrets (P4-01): names only, values go one way
|--------------------------------------------------------------------------
*/

export function Secrets({ mcp, actions }) {

    if (mcp.secretsError) {
        return html`<p class="mcp-error">${mcp.secretsError}</p>`;
    }

    const secrets = mcp.secrets || [];

    return html`<div class="mcp-secrets">
        <p class="muted">Values are stored encrypted in the data home and are never shown again. Refer to one in an MCP config as \${secret:NAME}.</p>
        ${mcp.secrets === null ? html`<${SkeletonRows} count=${3} label="Loading secrets…" />` : null}
        ${mcp.secrets && secrets.length === 0 ? html`<p class="empty">No secrets are stored.</p>` : null}
        ${secrets.map(secret => html`<div class="mcp-secret" key=${secret.name}>
            <span class="name">${secret.name}</span>
            <span class="muted">${secret.used_by.length ? `used by ${secret.used_by.join(", ")}` : "unused"}</span>
            <span class="muted">${secret.updated_at ? `updated ${new Date(secret.updated_at).toLocaleString()}` : ""}</span>
            <button type="button" class="ghost danger" disabled=${mcp.secretBusy} onClick=${() => actions.deleteSecret(secret)}>Delete</button>
        </div>`)}
        <form class="mcp-secret-add" key=${mcp.secretKey} onSubmit=${event => { event.preventDefault(); actions.saveSecret(event.currentTarget); }}>
            <h3>Add or replace a secret</h3>
            <label class="mcp-field"><span class="label">name</span><input type="text" name="name" placeholder="GITHUB_PAT" autocomplete="off" /></label>
            <label class="mcp-field"><span class="label">value</span><input type="password" name="value" autocomplete="new-password" /></label>
            <p class="mcp-message">${mcp.secretMessage}</p>
            <div class="modal-row"><button type="submit" disabled=${mcp.secretBusy}>Save secret</button></div>
        </form>
    </div>`;
}
