/*
|--------------------------------------------------------------------------
| Composer: @path completion and pasted pictures (roadmap P1-09)
|--------------------------------------------------------------------------
|
| Typing @ followed by part of a path lists matching files and folders of
| the target project (GET /api/mentions); ArrowUp/ArrowDown move, Enter or
| Tab inserts, Escape closes. The runtime reads every @path into the
| message when it is sent, so the agent starts with the file in front of
| it.
|
| A picture pasted into the composer (a screenshot from the clipboard) is
| attached like a chosen file; the runtime shows attached pictures to the
| model.
*/

import { state } from "./store.js";
import { el } from "./console-core.js";
import { renderAttachments } from "./composer-controller.js";


const ui = { items: [], active: 0, start: -1, request: 0, timer: null };


function mentionAtCaret(textarea) {

    const caret = textarea.selectionStart;
    const before = textarea.value.slice(0, caret);
    const match = /(^|[\s(["'])@([^\s@"'()]*)$/.exec(before);

    return match ? { start: caret - match[2].length, query: match[2] } : null;
}


function list() {

    return el("mentionList");
}


function close() {

    ui.items = [];
    ui.start = -1;
    const box = list();
    if (box) {
        box.hidden = true;
        box.replaceChildren();
    }
    el("task")?.setAttribute("aria-expanded", "false");
}


function draw() {

    const box = list();
    if (!box) return;

    if (ui.items.length === 0) {
        close();
        return;
    }

    box.replaceChildren(...ui.items.map((item, index) => {
        const option = document.createElement("li");
        option.id = `mention-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === ui.active));
        option.className = `mention-option${index === ui.active ? " active" : ""}`;
        option.textContent = item.path;
        option.dataset.type = item.type;
        option.addEventListener("mousedown", event => {
            event.preventDefault();
            ui.active = index;
            choose();
        });
        return option;
    }));

    box.hidden = false;
    el("task")?.setAttribute("aria-expanded", "true");
    el("task")?.setAttribute("aria-activedescendant", `mention-option-${ui.active}`);
}


async function lookup(query, start) {

    const ticket = ++ui.request;
    const projectId = state.currentProjectId;
    const params = new URLSearchParams({ q: query });
    if (projectId) params.set("projectId", projectId);

    try {
        const response = await fetch(`/api/mentions?${params}`);
        const payload = response.ok ? await response.json() : { entries: [] };
        if (ticket !== ui.request) return;
        ui.items = Array.isArray(payload.entries) ? payload.entries : [];
        ui.active = 0;
        ui.start = start;
        draw();
    } catch {
        if (ticket === ui.request) close();
    }
}


function choose() {

    const textarea = el("task");
    const item = ui.items[ui.active];

    if (!textarea || !item || ui.start < 0) {
        close();
        return;
    }

    const caret = textarea.selectionStart;
    const suffix = item.type === "directory" ? "" : " ";
    textarea.value = `${textarea.value.slice(0, ui.start)}${item.path}${suffix}${textarea.value.slice(caret)}`;
    const position = ui.start + item.path.length + suffix.length;
    textarea.setSelectionRange(position, position);
    close();

    /* a folder keeps completing inside itself */
    if (item.type === "directory") onInput();
}


function onInput() {

    const textarea = el("task");
    const found = textarea ? mentionAtCaret(textarea) : null;

    clearTimeout(ui.timer);

    if (!found) {
        ui.request++;
        close();
        return;
    }

    ui.timer = setTimeout(() => lookup(found.query, found.start), 120);
}


function onKeydown(event) {

    if (ui.items.length === 0 || list()?.hidden) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        ui.active = (ui.active + step + ui.items.length) % ui.items.length;
        draw();
    } else if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        choose();
    } else if (event.key === "Escape") {
        event.preventDefault();
        close();
    }
}


function onPaste(event) {

    const files = [...(event.clipboardData?.files || [])].filter(file => /^image\//.test(file.type));

    if (files.length === 0) return;

    event.preventDefault();

    for (const file of files) {
        const extension = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "png";
        const named = file.name && file.name !== "image.png"
            ? file
            : new File([file], `pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, { type: file.type });
        state.attachments.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: named, uploaded: new Map() });
    }

    state.attachmentError = null;
    renderAttachments();
}


export function initMentions() {

    const textarea = el("task");
    if (!textarea) return;

    textarea.addEventListener("input", onInput);
    textarea.addEventListener("keydown", onKeydown);
    textarea.addEventListener("paste", onPaste);
    textarea.addEventListener("blur", () => setTimeout(close, 150));
}


export const mentionActions = { mentionAtCaret, close, choose, lookup, onPaste };
