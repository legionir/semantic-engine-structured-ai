/*
|--------------------------------------------------------------------------
| Task templates controller
|--------------------------------------------------------------------------
|
| Modal dialog for searching, loading, importing, exporting, editing, and
| deleting saved task templates, plus a dedicated editor modal for creating
| or updating templates.
*/

import { el } from "./console-core.js";
import { writeTaskDraft } from "./composer-controller.js";
import {
    deleteTemplate,
    exportTemplatesJson,
    getTemplate,
    importTemplatesFromJson,
    inspectTemplateImport,
    listTemplates,
    markTemplateUsed,
    matchTemplates
} from "./task-templates.js";
import { openTemplateEditorModal as openEditorModal } from "./template-editor-modal.js";
import { SAMPLE_TASK_TEMPLATES, seedSampleTemplates } from "./task-template-samples.js";


let activeListModal = null;
let listSearchValue = "";
let refreshActiveList = null;


export function applyTemplateToComposer(template) {
    if (!template) return false;
    const field = el("task");
    if (field) {
        field.value = template.content;
        writeTaskDraft(template.content);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
    }
    if (template.mode) {
        const modeSelect = el("approvalMode");
        if (modeSelect && modeSelect.value !== template.mode) {
            modeSelect.value = template.mode;
            modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }
    if (template.effort) {
        const effortSelect = el("taskEffort");
        if (effortSelect && effortSelect.value !== template.effort) {
            effortSelect.value = template.effort;
            effortSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }
    markTemplateUsed(template.id);
    return true;
}


export function loadTemplateByName(query) {

    const wanted = String(query ?? "").trim();
    if (!wanted) return null;

    const template = getTemplate(wanted) || matchTemplates(wanted)[0] || null;
    if (!template) return null;

    applyTemplateToComposer(template);
    return template;
}


export function isTemplatesModalOpen() {
    return Boolean(activeListModal && activeListModal.isOpen());
}

export function closeTemplatesModal(reason = "dismiss") {
    if (activeListModal && activeListModal.isOpen()) {
        activeListModal.close(reason);
    }
    activeListModal = null;
}

function templatesSubtitle(totalCount, filteredCount) {
    if (totalCount === 0) return "0 saved templates";
    if (filteredCount !== totalCount) {
        return `${filteredCount} of ${totalCount} template${totalCount === 1 ? "" : "s"}`;
    }
    return `${totalCount} saved template${totalCount === 1 ? "" : "s"}`;
}

function renderTemplatesModalBody(container, modalHandle) {
    const head = document.createElement("div");
    head.className = "templates-modal-head";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "templates-search";
    searchInput.placeholder = "Filter templates…";
    searchInput.setAttribute("aria-label", "Filter saved templates");
    searchInput.value = listSearchValue;

    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "template-new-btn";
    newButton.textContent = "New template";
    newButton.addEventListener("click", () => {
        openTemplateEditorModal(null);
    });
    head.append(searchInput, newButton);

    const meta = document.createElement("div");
    meta.className = "templates-modal-meta";
    const countEl = document.createElement("span");
    countEl.className = "muted templates-count";

    const actionsEl = document.createElement("div");
    actionsEl.className = "templates-modal-actions";

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "ghost template-action-btn template-import-btn";
    importBtn.textContent = "Import";
    importBtn.title = "Import task templates from a JSON file";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "ghost template-action-btn template-export-btn";
    exportBtn.textContent = "Export";
    exportBtn.title = "Export task templates to a JSON file";

    const samplesBtn = document.createElement("button");
    samplesBtn.type = "button";
    samplesBtn.className = "ghost template-action-btn template-samples-btn";
    samplesBtn.textContent = "Samples";
    samplesBtn.title = "Add back any of the built-in sample templates that are missing";

    actionsEl.append(samplesBtn, importBtn, exportBtn);
    meta.append(countEl, actionsEl);

    let pendingDeleteId = null;

    const msgEl = document.createElement("p");
    msgEl.className = "templates-modal-msg";
    msgEl.hidden = true;

    const conflictEl = document.createElement("div");
    conflictEl.className = "templates-import-conflict";
    conflictEl.hidden = true;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.className = "template-import-input";
    fileInput.hidden = true;

    const list = document.createElement("ul");
    list.className = "templates-list";

    const empty = document.createElement("p");
    empty.className = "empty templates-empty";
    empty.hidden = true;

    function showMessage(text, isError = false) {
        msgEl.textContent = text;
        msgEl.className = `templates-modal-msg ${isError ? "is-error" : "is-success"}`;
        msgEl.hidden = !text;
    }

    function clearConflictPrompt() {
        conflictEl.replaceChildren();
        conflictEl.hidden = true;
    }

    function applyImportResult(result) {
        clearConflictPrompt();
        paintList();
        const parts = [`Imported ${result.imported} template${result.imported === 1 ? "" : "s"}`];
        if (result.skipped) parts.push(`skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}`);
        if (result.failed) parts.push(`${result.failed} failed`);
        showMessage(`${parts.join(", ")}.`);
    }

    function showConflictPrompt(text, conflicts) {
        const names = conflicts.slice(0, 3).map(c => c.name).join(", ");
        const extra = conflicts.length > 3 ? ` (+${conflicts.length - 3} more)` : "";
        const summary = document.createElement("p");
        summary.className = "templates-import-conflict-text";
        summary.textContent = `${conflicts.length} duplicate template${conflicts.length === 1 ? "" : "s"} found (${names}${extra}). Overwrite existing entries or skip duplicates?`;

        const btns = document.createElement("div");
        btns.className = "templates-import-conflict-actions";

        const overwriteBtn = document.createElement("button");
        overwriteBtn.type = "button";
        overwriteBtn.className = "template-import-overwrite-btn";
        overwriteBtn.textContent = "Overwrite duplicates";
        overwriteBtn.addEventListener("click", () => {
            try {
                applyImportResult(importTemplatesFromJson(text, { overwrite: true }));
            } catch (err) {
                clearConflictPrompt();
                showMessage(err.message || "Failed to import templates.", true);
            }
        });

        const skipBtn = document.createElement("button");
        skipBtn.type = "button";
        skipBtn.className = "ghost template-import-skip-btn";
        skipBtn.textContent = "Skip duplicates";
        skipBtn.addEventListener("click", () => {
            try {
                applyImportResult(importTemplatesFromJson(text, { overwrite: false, skipDuplicates: true }));
            } catch (err) {
                clearConflictPrompt();
                showMessage(err.message || "Failed to import templates.", true);
            }
        });

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "ghost template-import-cancel-btn";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => {
            clearConflictPrompt();
        });

        btns.append(overwriteBtn, skipBtn, cancelBtn);
        conflictEl.replaceChildren(summary, btns);
        conflictEl.hidden = false;
    }

    importBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
            const text = typeof file.text === "function"
                ? await file.text()
                : await new Promise((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(String(r.result || ""));
                    r.onerror = () => rej(r.error || new Error("Failed to read file"));
                    r.readAsText(file);
                });
            const inspected = inspectTemplateImport(text);
            if (inspected.conflicts.length > 0) {
                showMessage("");
                showConflictPrompt(text, inspected.conflicts);
            } else {
                applyImportResult(importTemplatesFromJson(text, { overwrite: true }));
            }
        } catch (err) {
            clearConflictPrompt();
            showMessage(err.message || "Failed to import templates.", true);
        } finally {
            fileInput.value = "";
        }
    });

    exportBtn.addEventListener("click", () => {
        const all = listTemplates();
        if (all.length === 0) return showMessage("No templates to export.", true);
        try {
            const jsonText = exportTemplatesJson();
            if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
                try {
                    const blob = new Blob([jsonText], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "task-templates.json";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 200);
                } catch {
                    /* fallback for headless/test environments where Blob is cross-realm */
                }
            }
            showMessage(`Exported ${all.length} template${all.length === 1 ? "" : "s"}.`);
        } catch (err) {
            showMessage(err.message || "Failed to export templates.", true);
        }
    });

    samplesBtn.addEventListener("click", () => {
        const added = seedSampleTemplates({ force: true });
        showMessage(added
            ? `Added ${added} sample template${added === 1 ? "" : "s"}.`
            : `All ${SAMPLE_TASK_TEMPLATES.length} sample templates are already here.`);
        paintList();
    });

    function paintList() {
        listSearchValue = searchInput.value;
        const all = listTemplates();
        const filtered = matchTemplates(listSearchValue);

        countEl.textContent = all.length === 0
            ? "0 saved templates"
            : `${filtered.length} of ${all.length} template${all.length === 1 ? "" : "s"}`;
        modalHandle.setSubtitle(templatesSubtitle(all.length, filtered.length));

        list.replaceChildren();

        if (filtered.length === 0) {
            empty.textContent = all.length === 0
                ? "No saved templates yet. Click New template to save one, or Samples for a starter set."
                : `No templates match "${listSearchValue.trim()}".`;
            empty.hidden = false;
            return;
        }

        empty.hidden = true;

        for (const template of filtered) {
            const li = document.createElement("li");
            li.className = "template-item";
            li.dataset.templateId = template.id;

            const itemHead = document.createElement("div");
            itemHead.className = "template-item-head";
            const title = document.createElement("strong");
            title.className = "template-item-name";
            title.textContent = template.name;
            const catBadge = document.createElement("span");
            catBadge.className = "chip template-item-category";
            catBadge.textContent = template.category || "General";
            itemHead.append(title, catBadge);

            if (template.mode) {
                const modeChip = document.createElement("span");
                modeChip.className = "chip template-item-meta";
                modeChip.textContent = `mode: ${template.mode}`;
                itemHead.appendChild(modeChip);
            }
            if (template.effort) {
                const effortChip = document.createElement("span");
                effortChip.className = "chip template-item-meta";
                effortChip.textContent = `effort: ${template.effort}`;
                itemHead.appendChild(effortChip);
            }
            li.appendChild(itemHead);

            if (template.description) {
                const desc = document.createElement("p");
                desc.className = "template-item-desc";
                desc.textContent = template.description;
                li.appendChild(desc);
            }

            const preview = document.createElement("pre");
            preview.className = "template-item-preview";
            preview.textContent = template.content;
            li.appendChild(preview);

            const actions = document.createElement("div");
            actions.className = "template-item-actions";
            const loadBtn = document.createElement("button");
            loadBtn.type = "button";
            loadBtn.className = "template-load-btn";
            loadBtn.textContent = "Load";
            loadBtn.addEventListener("click", () => {
                applyTemplateToComposer(template);
                closeTemplatesModal("loaded");
            });

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "ghost template-edit-btn";
            editBtn.textContent = "Edit";
            editBtn.addEventListener("click", () => {
                openTemplateEditorModal(template);
            });

            if (pendingDeleteId === template.id) {
                const confirmDeleteBtn = document.createElement("button");
                confirmDeleteBtn.type = "button";
                confirmDeleteBtn.className = "danger template-confirm-delete-btn";
                confirmDeleteBtn.textContent = "Confirm delete";
                confirmDeleteBtn.addEventListener("click", () => {
                    pendingDeleteId = null;
                    deleteTemplate(template.id);
                    paintList();
                });

                const cancelDeleteBtn = document.createElement("button");
                cancelDeleteBtn.type = "button";
                cancelDeleteBtn.className = "ghost template-cancel-delete-btn";
                cancelDeleteBtn.textContent = "Cancel";
                cancelDeleteBtn.addEventListener("click", () => {
                    pendingDeleteId = null;
                    paintList();
                });

                actions.append(loadBtn, editBtn, confirmDeleteBtn, cancelDeleteBtn);
            } else {
                const deleteBtn = document.createElement("button");
                deleteBtn.type = "button";
                deleteBtn.className = "ghost template-delete-btn";
                deleteBtn.textContent = "Delete";
                deleteBtn.addEventListener("click", () => {
                    pendingDeleteId = template.id;
                    paintList();
                });

                actions.append(loadBtn, editBtn, deleteBtn);
            }
            li.appendChild(actions);
            list.appendChild(li);
        }
    }

    searchInput.addEventListener("input", paintList);
    container.replaceChildren(head, meta, msgEl, conflictEl, list, empty, fileInput);
    paintList();
    refreshActiveList = paintList;
    setTimeout(() => searchInput.focus(), 20);
}


export function openTemplatesModal() {

    if (isTemplatesModalOpen()) {
        return activeListModal;
    }

    activeListModal = null;

    const body = document.createElement("div");
    body.className = "templates-body";

    const all = listTemplates();
    const handle = Modal.open({
        title: "Task Templates",
        subtitle: templatesSubtitle(all.length, all.length),
        size: "medium",
        className: "templates-modal",
        body,
        onClose: () => {
            listSearchValue = "";
            if (activeListModal === handle) {
                activeListModal = null;
                refreshActiveList = null;
            }
        }
    });

    activeListModal = handle;
    renderTemplatesModalBody(body, handle);
    return handle;
}


export function toggleTemplatesModal() {

    if (isTemplatesModalOpen()) {
        closeTemplatesModal("toggle");
        return null;
    }
    return openTemplatesModal();
}


export function openTemplateEditorModal(template = null) {

    return openEditorModal(template, {
        onSaved: () => {
            if (isTemplatesModalOpen() && typeof refreshActiveList === "function") {
                refreshActiveList();
            }
        }
    });
}
