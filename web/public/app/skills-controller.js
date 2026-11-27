/*
|--------------------------------------------------------------------------
| Skills: the `/skill` command and the skill manager
|--------------------------------------------------------------------------
|
| Every skill the runtime can load (GET /api/skills): the registry, the
| runtime's own, the operator's, the project's and the shipped libraries.
|
|   /skill <name> [message]   sends the message with that skill's complete
|                             text; the turn carries no skill list. Any
|                             skill works, sent to the AI or not.
|   /skill  (or Skills menu)  opens the manager: search every skill and
|                             choose which ones are sent to the AI in the
|                             prompt's skill index (PUT /api/skills/prompt).
*/

import { state } from "./store.js";
import { el, notifyError } from "./console-core.js";
import { apiFetch } from "./auth-transport.js";
import { writeTaskDraft } from "./composer-controller.js";


const cache = { key: null, at: 0, data: null, pending: null };
const ui = { modal: null, query: "", filter: "all" };


function projectKey() {

    return state.currentProjectId || "";
}


export async function loadSkills({ force = false } = {}) {

    const key = projectKey();

    if (!force && cache.data && cache.key === key && Date.now() - cache.at < state.skillsCacheMs) {
        return cache.data;
    }

    if (!force && cache.pending && cache.key === key) return cache.pending;

    const params = key ? `?projectId=${encodeURIComponent(key)}` : "";

    cache.key = key;
    cache.pending = apiFetch(`/api/skills${params}`)
        .then(async response => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || `Skills could not be loaded (${response.status}).`);
            cache.data = payload;
            cache.at = Date.now();
            return payload;
        })
        .finally(() => {
            cache.pending = null;
        });

    return cache.pending;
}


/* name prefix first, then name substring, then description */
export function rankSkills(skills, query, limit = 30) {

    const wanted = String(query || "").trim().toLowerCase();
    const scored = [];

    for (const skill of skills || []) {
        const name = skill.name.toLowerCase();
        const at = name.indexOf(wanted);
        const rank = !wanted ? (skill.prompt_enabled ? 0 : 1)
            : at === 0 ? 0
            : at > 0 ? 1
            : String(skill.description || "").toLowerCase().includes(wanted) ? 2
            : -1;
        if (rank >= 0) scored.push({ rank, skill });
    }

    scored.sort((a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name));

    return scored.slice(0, limit).map(entry => entry.skill);
}


/* items for the composer's completion list after "/skill " */
export async function matchSkillItems(query) {

    const data = await loadSkills();

    return rankSkills(data.skills, query).map(skill => ({
        type: "skill",
        path: skill.name,
        description: shortText(skill.description, 90)
    }));
}


function shortText(text, limit) {

    const value = String(text || "").replace(/\s+/g, " ").trim();

    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}


function useSkill(name) {

    const field = el("task");
    if (!field) return;

    const rest = field.value.replace(/^\/skills?(\s+\S*)?\s*/i, "");
    field.value = `/skill ${name} ${rest}`;
    field.setSelectionRange(field.value.length, field.value.length);
    writeTaskDraft(field.value);
    field.focus();
}


/* the `/skill` slash command; submit(task) sends a task like the composer */
export function skillSlashCommand({ submit }) {

    return {
        name: "skill",
        aliases: ["skills"],
        description: "Send a message with one skill's full text attached (no args: browse skills)",
        usage: "/skill <name> [message]",
        category: "Tools",
        acceptsArgs: true,
        execute: async args => {
            /* the message keeps its line breaks */
            const [, name = "", message = ""] = /^(\S*)\s*([\s\S]*)$/.exec(String(args || "").trim()) || [];
            if (!name) {
                await openSkillsModal();
                return { preserveInput: true };
            }
            const data = await loadSkills();
            if (!data.skills.some(skill => skill.name === name)) {
                throw new Error(`Unknown skill "${name}". Type /skill to browse every skill.`);
            }
            const sent = await submit(`/skill ${name}${message ? ` ${message}` : ""}`);
            return sent === false ? { preserveInput: true } : { sent: true };
        }
    };
}


function node(tag, className, text) {

    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}


function visible(skills) {

    const ranked = ui.query ? rankSkills(skills, ui.query, skills.length) : [...skills];

    return ranked.filter(skill =>
        ui.filter === "all" ||
        (ui.filter === "enabled" && skill.prompt_enabled) ||
        (ui.filter === "recommended" && skill.recommended) ||
        (ui.filter === "library" && skill.origin === "library") ||
        (ui.filter === "own" && skill.origin !== "library"));
}


function summaryText(data) {

    const prompt = data.prompt || {};
    const namesOnly = prompt.names_only ? ` · ${prompt.names_only} by name only (over budget)` : "";

    return `${prompt.enabled} of ${data.skills.length} skills sent to the AI · index ${prompt.index_chars} / ${prompt.max_chars} chars${namesOnly}`;
}


async function toggle(skill, enabled, message) {

    const response = await apiFetch("/api/skills/prompt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: skill.name, enabled })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        message(response.status === 403 ? "Changing which skills are sent to the AI needs the admin token." : payload.error || `Failed (${response.status}).`, true);
        return false;
    }

    return true;
}


function skillRow(skill, { onToggle, onUse }) {

    const row = node("li", `skill-row${skill.prompt_enabled ? " is-enabled" : ""}`);
    row.dataset.skill = skill.name;

    const head = node("div", "skill-row-head");
    const label = node("label", "skill-toggle");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(skill.prompt_enabled);
    box.className = "skill-enabled";
    box.title = "Send this skill to the AI in the skill index";
    box.setAttribute("aria-label", `Send ${skill.name} to the AI`);
    box.addEventListener("change", () => onToggle(skill, box.checked, box));
    label.append(box, node("span", "skill-name", skill.name));
    head.append(label);

    for (const badge of [skill.kind, skill.library || skill.origin, skill.recommended ? "recommended" : null].filter(Boolean)) {
        head.append(node("span", "chip skill-badge", badge));
    }

    const use = node("button", "ghost skill-use-btn", "Use");
    use.type = "button";
    use.title = `Put /skill ${skill.name} in the composer`;
    use.addEventListener("click", () => onUse(skill));
    head.append(use);

    row.append(head, node("p", "skill-desc", shortText(skill.description, 260)));

    return row;
}


function renderBody(body, data, handle) {

    const search = node("input", "skills-search");
    search.type = "search";
    search.placeholder = "Search every skill…";
    search.setAttribute("aria-label", "Search skills");
    search.value = ui.query;

    const filter = node("select", "skills-filter");
    filter.setAttribute("aria-label", "Show");
    for (const [value, text] of [["all", "All"], ["enabled", "Sent to AI"], ["recommended", "Recommended"], ["own", "Built-in & project"], ["library", "Library"]]) {
        const option = node("option", null, text);
        option.value = value;
        filter.append(option);
    }
    filter.value = ui.filter;

    const reset = node("button", "ghost skills-reset-btn", "Reset to recommended");
    reset.type = "button";

    const summary = node("p", "muted skills-summary", summaryText(data));
    const message = node("p", "skills-msg");
    message.hidden = true;
    const list = node("ul", "skills-list");

    const say = (text, isError = false) => {
        message.textContent = text;
        message.className = `skills-msg ${isError ? "is-error" : "is-success"}`;
        message.hidden = !text;
    };

    const refresh = async () => {
        data = await loadSkills({ force: true });
        summary.textContent = summaryText(data);
        paint();
    };

    const onToggle = async (skill, enabled, box) => {
        box.disabled = true;
        const ok = await toggle(skill, enabled, say);
        if (!ok) box.checked = !enabled;
        box.disabled = false;
        if (ok) {
            say(`${skill.name} ${enabled ? "is sent" : "is no longer sent"} to the AI.`);
            await refresh();
        }
    };

    const onUse = skill => {
        useSkill(skill.name);
        handle.close("used");
    };

    function paint() {
        const shown = visible(data.skills);
        list.replaceChildren(...shown.map(skill => skillRow(skill, { onToggle, onUse })));
        if (shown.length === 0) list.append(node("li", "empty", "No skill matches."));
    }

    search.addEventListener("input", () => {
        ui.query = search.value;
        paint();
    });

    filter.addEventListener("change", () => {
        ui.filter = filter.value;
        paint();
    });

    reset.addEventListener("click", async () => {
        const response = await apiFetch("/api/skills/prompt/reset", { method: "POST" });
        if (!response.ok) {
            say(response.status === 403 ? "Resetting the selection needs the admin token." : `Reset failed (${response.status}).`, true);
            return;
        }
        say("Back to the recommended skills.");
        await refresh();
    });

    const head = node("div", "skills-modal-head");
    head.append(search, filter, reset);

    const hint = node("p", "muted skills-hint", "Checked skills are listed to the AI in every request. Any skill — checked or not — can be attached to one message with /skill <name> <message>.");

    body.replaceChildren(head, summary, hint, message, list);
    paint();
    setTimeout(() => search.focus(), 20);
}


export async function openSkillsModal() {

    if (ui.modal && ui.modal.isOpen()) return ui.modal;

    let data;

    try {
        data = await loadSkills({ force: true });
    } catch (error) {
        notifyError(error.message);
        return null;
    }

    const body = node("div", "skills-body");

    const handle = Modal.open({
        title: "Skills",
        subtitle: `${data.skills.length} skills · ${(data.libraries || []).map(library => `${library.title}: ${library.skills}`).join(" · ")}`,
        size: "medium",
        className: "skills-modal",
        body,
        onClose: () => {
            if (ui.modal === handle) ui.modal = null;
        }
    });

    ui.modal = handle;
    renderBody(body, data, handle);

    return handle;
}


export const skillsActions = { rankSkills, useSkill, summaryText, visible, ui, cache };
