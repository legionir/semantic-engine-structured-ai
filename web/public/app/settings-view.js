/*
|--------------------------------------------------------------------------
| Settings view
|--------------------------------------------------------------------------
|
| The Settings and LLM settings modals draw the same body from the store.
| A save or a server-side change reloads the list and redraws in place, so
| the filter, the focused field, a value being typed, and a row's saved or
| rejected mark all survive (the old body was rebuilt from scratch on every
| reload and lost them).
|
| The runtime policy row is drawn here too (see PolicyRow).
|
| Text inputs are uncontrolled (defaultValue): a redraw never overwrites
| what the operator is typing, and a Persian IME composition is never cut.
| The row structure (.setting > div, control, span.src) is what app.css
| and the tests address.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";


export const GROUP_ORDER = [
    "endpoint",
    "endpoint.main", "endpoint.l1", "endpoint.l2", "endpoint.l3", "endpoint.summary",
    "memory", "archive", "journal", "context", "budget", "delegation", "planning", "hooks",
    "persistence", "policy", "tools", "mcp", "output", "workspace"
];

const LLM_KEYS = [
    "AGENT_PROVIDER", "AGENT_PROVIDER_REGION", "AGENT_MODEL", "AGENT_BASE_URL", "AGENT_API_KEY",
    "AGENT_PROXY_URL", "AZURE_OPENAI_API_VERSION", "BEDROCK_ACCESS_KEY_ID",
    "BEDROCK_SECRET_ACCESS_KEY", "BEDROCK_SESSION_TOKEN"
];

const CATALOG_KEYS = [
    "AGENT_PROVIDER", "AGENT_PROVIDER_REGION", "AGENT_BASE_URL", "AGENT_API_KEY",
    "AZURE_OPENAI_API_VERSION", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY",
    "BEDROCK_SESSION_TOKEN"
];


export function isLlmSetting(setting) {

    return String(setting.group || "").startsWith("endpoint") || LLM_KEYS.includes(setting.key);
}


/* a change to one of these can change which models the provider offers */
export function modelCatalogConfigChanged(key) {

    return CATALOG_KEYS.includes(key) ||
        /^ENDPOINT_(MAIN|L1|L2|L3|SUMMARY)_(BASE_URL|API_KEY)$/.test(key);
}


export function isModelSetting(setting) {

    return /(?:^|_)MODEL$/.test(setting.key);
}


function modelRole(key) {

    return key.match(/^ENDPOINT_(MAIN|L1|L2|L3|SUMMARY)_MODEL$/)?.[1] || "MAIN";
}


export function settingMatches(setting, term) {

    return term === "" ||
        setting.key.toLowerCase().includes(term) ||
        String(setting.description || "").toLowerCase().includes(term);
}


export function groupSettings(list) {

    const groups = new Map();

    for (const setting of list) {
        if (!groups.has(setting.group)) groups.set(setting.group, []);
        groups.get(setting.group).push(setting);
    }

    return [...groups.entries()].sort(
        ([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)
    );
}


function modelOptions(setting, catalog) {

    const current = setting.value || "";
    const offered = catalog?.catalog
        ? catalog.catalog.byRole?.[modelRole(setting.key)] || catalog.catalog.models || []
        : [];

    return [current, ...offered.filter(name => name !== current)];
}


function hintText(setting, status, catalog) {

    if (status?.kind === "rejected" && status.message) {
        return status.message;
    }

    if (isModelSetting(setting)) {
        if (catalog?.error) return `Could not load models: ${catalog.error}`;
        const roleError = catalog?.catalog?.errors?.[modelRole(setting.key)];
        if (roleError) return `Using the main model list: ${roleError}`;
    }

    return `${setting.description || ""}${setting.fixed ? " (fixed at startup)" : ""}`;
}


function Control({ setting, catalog, onSave }) {

    const save = event => onSave(setting, event.currentTarget);

    if (setting.type === "boolean" || setting.type === "enum" || isModelSetting(setting)) {

        const values =
            isModelSetting(setting)
                ? modelOptions(setting, catalog)
                : setting.type === "boolean"
                    ? ["true", "false"]
                    : setting.values || [];

        return html`<select
            value=${String(setting.value ?? "")}
            disabled=${Boolean(setting.fixed)}
            title=${isModelSetting(setting) && catalog?.error ? catalog.error : undefined}
            onChange=${save}
        >
            ${values.map(option => html`<option key=${option} value=${option}>${option || "Choose a model"}</option>`)}
        </select>`;
    }

    return html`<input
        type=${setting.secret ? "password" : setting.type === "number" ? "number" : "text"}
        placeholder=${setting.secret && setting.value ? "Configured — enter a replacement" : undefined}
        min=${setting.min}
        max=${setting.max}
        defaultValue=${setting.secret || setting.value === null || setting.value === undefined ? "" : String(setting.value)}
        disabled=${Boolean(setting.fixed)}
        onChange=${save}
    />`;
}


function Row({ setting, status, catalog, term, onSave, onReset }) {

    const catalogTrouble =
        isModelSetting(setting) &&
        (catalog?.error || catalog?.catalog?.errors?.[modelRole(setting.key)]);

    const classes = [
        "setting",
        status?.kind || "",
        catalogTrouble ? "model-list-unavailable" : ""
    ].filter(Boolean).join(" ");

    const resettable = setting.source === "override" && !setting.fixed;

    return html`<div
        class=${classes}
        data-key=${setting.key}
        data-hint=${String(setting.description || "").toLowerCase()}
        hidden=${!settingMatches(setting, term)}
    >
        <div>
            <div class="label">${setting.key}</div>
            <div class="hint">${hintText(setting, status, catalog)}</div>
        </div>
        <${Control} setting=${setting} catalog=${catalog} onSave=${onSave} />
        <span
            class=${`src ${setting.source}`}
            title=${setting.source === "override" ? "changed here, click to restore" : setting.source}
            style=${resettable ? "cursor: pointer" : undefined}
            onClick=${resettable ? () => onReset(setting) : undefined}
        >${setting.source}</span>
    </div>`;
}


export const APPROVAL_MODES = ["auto", "prompt", "deny"];

/* what the settings filter matches the runtime policy row against */
const POLICY_TEXT = `runtime policy approval ${APPROVAL_MODES.join(" ")} until done auto continue`;


/*
| The runtime policy controls, drawn from the store. The header keeps its
| own pair (ids approvalMode / autoContinue); both pairs show the same
| state and change it through the same action, so nothing is moved
| between the page and the modal.
*/
function PolicyRow({ policy, hidden }) {

    return html`<div class="policy-row" hidden=${hidden}>
        <span class="policy-title">runtime policy</span>
        <label class="chip select" title="tool approval policy">
            approval
            <select
                value=${policy.approvalMode ?? ""}
                onChange=${event => policy.onApprovalMode(event.currentTarget.value)}
            >
                ${APPROVAL_MODES.map(mode => html`<option key=${mode} value=${mode}>${mode}</option>`)}
            </select>
        </label>
        <label class="chip checkbox" title="keep starting cycles while the plan has open steps">
            <input
                type="checkbox"
                checked=${Boolean(policy.autoContinue)}
                onChange=${event => policy.onAutoContinue(event.currentTarget.checked)}
            /> until done
        </label>
    </div>`;
}


/*
| props: list, ui {filter}, status Map(key → {kind, message}), catalog
| ({catalog} | {error} | null), policy ({approvalMode, autoContinue,
| onApprovalMode, onAutoContinue} draws the runtime policy row; null
| leaves it out).
*/
export function SettingsBody({ list, ui, status, catalog, policy, onFilter, onSave, onReset }) {

    const term = ui.filter;
    const policyHidden = term !== "" && !POLICY_TEXT.includes(term);

    return html`
        <input
            class="filter"
            type="search"
            placeholder="filter settings and policy"
            onInput=${event => onFilter(event.currentTarget.value.trim().toLowerCase())}
        />
        <section class="runtime-policy-settings" hidden=${!policy || policyHidden}>
            <h3>runtime policy</h3>
            ${policy ? html`<${PolicyRow} policy=${policy} hidden=${policyHidden} />` : null}
        </section>
        ${groupSettings(list).map(([name, settings]) => html`<div
            class="group"
            key=${name}
            hidden=${!settings.some(setting => settingMatches(setting, term))}
        >
            <h3>${name}</h3>
            ${settings.map(setting => html`<${Row}
                key=${setting.key}
                setting=${setting}
                status=${status.get(setting.key)}
                catalog=${catalog}
                term=${term}
                onSave=${onSave}
                onReset=${onReset}
            />`)}
        </div>`)}
    `;
}
