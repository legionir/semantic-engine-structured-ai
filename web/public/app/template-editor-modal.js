/*
|--------------------------------------------------------------------------
| Task template editor modal
|--------------------------------------------------------------------------
|
| Dedicated modal form for creating or editing a saved task template.
*/

import { el } from "./console-core.js";
import { saveTemplate } from "./task-templates.js";


let activeEditorModal = null;


function makeField(labelText, control) {
    const wrap = document.createElement("label");
    wrap.className = "template-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.append(span, control);
    return wrap;
}


function makeSelect(options, className, ariaLabel) {
    const select = document.createElement("select");
    select.className = className;
    select.setAttribute("aria-label", ariaLabel);
    for (const [value, label] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    return select;
}


export function openTemplateEditorModal(template = null, { onSaved = null } = {}) {

    if (activeEditorModal && activeEditorModal.isOpen()) {
        activeEditorModal.close("replace");
    }

    const editingId = template?.id || null;
    const isEdit = Boolean(editingId);

    const form = document.createElement("form");
    form.className = "templates-form";

    const rowTop = document.createElement("div");
    rowTop.className = "templates-form-row";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "template-name-input";
    nameInput.placeholder = "e.g. Security & test review";
    const categoryInput = document.createElement("input");
    categoryInput.type = "text";
    categoryInput.className = "template-category-input";
    categoryInput.placeholder = "General";
    rowTop.append(makeField("Name", nameInput), makeField("Category", categoryInput));

    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.className = "template-desc-input";
    descInput.placeholder = "Short description (optional)";

    const contentInput = document.createElement("textarea");
    contentInput.rows = 4;
    contentInput.className = "template-content-input";
    contentInput.placeholder = "Write a reusable task prompt…";

    const rowOptions = document.createElement("div");
    rowOptions.className = "templates-form-row";
    const modeSelect = makeSelect(
        [["", "Keep current mode"], ["auto", "auto"], ["prompt", "prompt"], ["deny", "deny"], ["plan", "plan"]],
        "template-mode-select",
        "Default mode for template"
    );
    const effortSelect = makeSelect(
        [["", "Keep current effort"], ["inherit", "inherit"], ["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "extra high"]],
        "template-effort-select",
        "Default reasoning effort for template"
    );
    rowOptions.append(makeField("Mode", modeSelect), makeField("Effort", effortSelect));

    const errorEl = document.createElement("p");
    errorEl.className = "templates-error";
    errorEl.hidden = true;

    const formActions = document.createElement("div");
    formActions.className = "templates-form-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ghost template-cancel-btn";
    cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "template-save-btn";
    saveBtn.textContent = isEdit ? "Update template" : "Save template";
    formActions.append(cancelBtn, saveBtn);

    form.append(rowTop, makeField("Description", descInput), makeField("Task description", contentInput), rowOptions, errorEl, formActions);

    if (isEdit && template) {
        nameInput.value = template.name;
        categoryInput.value = template.category === "General" ? "" : template.category;
        descInput.value = template.description || "";
        contentInput.value = template.content;
        modeSelect.value = template.mode || "";
        effortSelect.value = template.effort || "";
    } else {
        const currentDraft = String(el("task")?.value || "");
        if (currentDraft.trim() !== "" && !currentDraft.trim().startsWith("/")) {
            contentInput.value = currentDraft;
        }
    }

    function showError(message) {
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
    }

    const handle = Modal.open({
        title: isEdit ? "Edit Template" : "New Template",
        subtitle: isEdit ? `Update "${template.name}"` : "Save a reusable task description for quick reuse",
        size: "medium",
        className: "template-editor-modal",
        body: form,
        onClose: () => {
            if (activeEditorModal === handle) activeEditorModal = null;
        }
    });

    activeEditorModal = handle;
    cancelBtn.addEventListener("click", () => handle.close("cancel"));

    form.addEventListener("submit", event => {
        event.preventDefault();
        showError("");
        try {
            saveTemplate({
                ...(editingId ? { id: editingId } : {}),
                name: nameInput.value,
                category: categoryInput.value,
                description: descInput.value,
                content: contentInput.value,
                mode: modeSelect.value || null,
                effort: effortSelect.value || null
            });
            handle.close("saved");
            if (typeof onSaved === "function") onSaved();
        } catch (error) {
            showError(error.message || "Could not save template.");
        }
    });

    setTimeout(() => nameInput.focus(), 20);
    return handle;
}
