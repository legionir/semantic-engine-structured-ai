/*
|--------------------------------------------------------------------------
| Files
|--------------------------------------------------------------------------
|
| The file manager's actions. Every change goes through /api/files and the
| listing is re-read from the server afterwards, so the panel never shows
| a file the server did not confirm. A save sends the mtime the editor
| loaded; when the file changed on disk meanwhile the operator chooses
| between overwriting and reloading. Unsaved edits are never discarded
| without a confirmation. Uploads send each file's raw bytes to
| PUT /api/files/upload one at a time; a name that already exists is
| replaced only after the operator confirms.
*/

import { state, touch } from "./store.js";
import { mount, mountInModal } from "./dom.js";
import { createFilesState, FileEditorBody, FileEditorFooter, fileEditorSubtitle, fileEditorTitle, FilesBody, filesSubtitle, isDirty } from "./files-view.js";
import { apiRequest, confirmDialog, promptDialog, query } from "./operator-api.js";


function files() {

    if (!state.files) state.files = createFilesState();

    return state.files;
}


function changed() {
    const target = files();
    state.filesModal?.setSubtitle(filesSubtitle(target));
    if (state.fileEditorModal && state.fileEditorModal.isOpen()) {
        if (target.open) state.fileEditorModal.setTitle(fileEditorTitle(target));
        state.fileEditorModal.setSubtitle(fileEditorSubtitle(target));
    }
    touch("files");
}


function ask(message, initial = "", title = "Files") {
    return promptDialog(message, initial, { title });
}


function confirmed(message, confirmLabel = "Confirm", confirmClass = "") {
    return confirmDialog(message, { title: "Files", confirmLabel, confirmClass });
}


function scoped(extra = {}) {
    const projectId = files().projectId;
    return projectId ? { ...extra, projectId } : extra;
}


function join(dir, name) {
    return dir === "." || dir === "" ? name : `${dir}/${name}`;
}


function validName(name) {
    return typeof name === "string" && name.trim() !== "" && !name.includes("\0");
}


export async function listDirectory(dirPath = files().path) {

    const target = files();
    target.loading = true;
    changed();

    const result = await apiRequest(`/api/files${query(scoped({ path: dirPath }))}`);

    target.loading = false;

    if (!result.ok) {
        target.error = result.error;
        changed();
        return false;
    }

    target.listing = result.payload;
    target.path = result.payload.path;
    target.error = null;
    changed();

    return true;
}


async function loadFile(filePath) {

    const target = files();
    target.fileLoading = true;
    changed();

    const result = await apiRequest(`/api/files/content${query(scoped({ path: filePath }))}`);

    target.fileLoading = false;

    if (!result.ok) {
        target.error = result.error;
        changed();
        return false;
    }

    const file = result.payload;
    target.open = {
        ...file,
        draft: file.content ?? "",
        saving: false,
        error: null,
        message: ""
    };
    target.editorKey++;
    target.error = null;
    changed();

    return true;
}


const actions = {

    async navigate(dirPath) {
        files().filter = "";
        return listDirectory(dirPath);
    },

    async root(projectId) {
        const target = files();
        if (isDirty(target) && !(await confirmed("Discard the unsaved changes?", "Discard"))) {
            changed();
            return false;
        }
        target.projectId = projectId || "";
        target.open = null;
        target.path = ".";
        return listDirectory(".");
    },

    refresh() {
        return listDirectory(files().path);
    },

    filter(value) {
        files().filter = String(value ?? "");
        touch("files");
    },

    async openFile(filePath) {
        const target = files();
        if (target.open?.path === filePath) {
            openFileEditorModal(filePath);
            return true;
        }
        if (isDirty(target) && !(await confirmed(`Discard the unsaved changes to ${target.open.path}?`, "Discard"))) return false;
        const editor = openFileEditorModal(filePath);
        const ok = await loadFile(filePath);
        if (!ok && state.fileEditorModal === editor && !target.open) {
            editor.close("error");
        }
        return ok;
    },

    async closeFile() {
        const target = files();
        if (isDirty(target) && !(await confirmed(`Discard the unsaved changes to ${target.open.path}?`, "Discard"))) return false;
        target.open = null;
        state.fileEditorModal?.close("close");
        changed();
        return true;
    },

    edit(text) {
        const file = files().open;
        if (!file) return;
        const wasDirty = file.draft !== file.content;
        file.draft = text;
        file.message = "";
        if (wasDirty !== (file.draft !== file.content)) changed();
    },

    async save(force = false) {
        const target = files();
        const file = target.open;
        if (!file || file.content === null || file.saving) return false;
        file.saving = true;
        file.error = null;
        changed();

        const result = await apiRequest("/api/files/content", {
            method: "PUT",
            json: scoped({
                path: file.path,
                content: file.draft,
                expected_mtime_ms: force ? undefined : file.mtime_ms
            })
        });

        file.saving = false;

        if (result.status === 409 && !force) {
            changed();
            if (await confirmed(`${file.path} changed on disk since it was opened. Overwrite it with your version?`, "Overwrite", "danger")) {
                return actions.save(true);
            }
            file.error = "Not saved: the file changed on disk. Use Reload to see the current version (your edits will be replaced).";
            changed();
            return false;
        }

        if (!result.ok) {
            file.error = result.error;
            changed();
            return false;
        }

        Object.assign(file, result.payload.entry, { content: file.draft, message: "Saved." });
        changed();
        await listDirectory(target.path);

        return true;
    },

    revert() {
        const target = files();
        if (!target.open) return;
        target.open.draft = target.open.content ?? "";
        target.open.error = null;
        target.editorKey++;
        changed();
    },

    async reload() {
        const target = files();
        if (!target.open) return false;
        if (isDirty(target) && !(await confirmed("Reload from disk and discard your unsaved changes?", "Reload"))) return false;
        return loadFile(target.open.path);
    },

    async create(type) {
        const target = files();
        const name = await ask(
            type === "directory" ? "New folder name (a/b/c creates the whole path):" : "New file name:",
            "",
            type === "directory" ? "New folder" : "New file"
        );
        if (!validName(name)) return false;
        const filePath = join(target.listing?.path || target.path, name.trim());
        const result = await apiRequest("/api/files", { json: scoped({ path: filePath, type }) });
        if (!result.ok) {
            target.error = result.error;
            changed();
            return false;
        }
        await listDirectory(target.path);
        if (type === "file") await actions.openFile(result.payload.entry.path);
        return true;
    },

    dragging(on) {
        const target = files();
        if (target.dragging === Boolean(on)) return;
        target.dragging = Boolean(on);
        touch("files");
    },

    async upload(list) {
        const target = files();
        const picked = Array.from(list || []).filter(file => file && typeof file.name === "string" && validName(file.name));
        if (picked.length === 0 || target.upload?.active) return false;
        const dir = target.listing?.path || target.path;
        const upload = { active: true, total: picked.length, done: 0, current: "", failed: [] };
        target.upload = upload;
        target.error = null;
        changed();

        const errors = [];

        for (const file of picked) {
            upload.current = file.name;
            touch("files");
            const filePath = join(dir, file.name);
            const send = overwrite => apiRequest(`/api/files/upload${query(scoped({ path: filePath, overwrite: overwrite ? "1" : undefined }))}`, {
                method: "PUT",
                headers: { "content-type": "application/octet-stream" },
                body: file
            });
            let result = await send(false);
            if (result.status === 409 && result.payload?.exists) {
                result = (await confirmed(`${filePath} already exists. Replace it with the uploaded file?`, "Replace", "danger"))
                    ? await send(true)
                    : { ok: false, error: "skipped" };
            }
            if (!result.ok) {
                upload.failed.push(file.name);
                if (result.error !== "skipped") errors.push(`${file.name}: ${result.error}`);
            }
            upload.done++;
        }

        upload.active = false;
        upload.current = "";
        changed();
        await listDirectory(target.path);
        /* after the refresh, which clears the error of the listing */
        if (errors.length) {
            target.error = errors.join(" · ");
            changed();
        }

        return upload.failed.length === 0;
    },

    async rename(entry) {
        const target = files();
        const next = await ask(`Rename or move ${entry.path} to (relative to the root):`, entry.path, "Rename");
        if (!validName(next) || next.trim() === entry.path) return false;
        const result = await apiRequest("/api/files/rename", { json: scoped({ from: entry.path, to: next.trim() }) });
        if (!result.ok) {
            target.error = result.error;
            changed();
            return false;
        }
        if (target.open && (target.open.path === entry.path || target.open.path.startsWith(`${entry.path}/`))) {
            target.open.path = result.payload.entry.path + target.open.path.slice(entry.path.length);
            target.open.name = target.open.path.split("/").pop();
        }
        await listDirectory(target.path);
        return true;
    },

    async remove(entry) {
        const target = files();
        const isDir = entry.type === "directory";
        if (!(await confirmed(isDir ? `Delete the folder ${entry.path} and everything in it?` : `Delete ${entry.path}?`, "Delete", "danger"))) return false;
        const result = await apiRequest(`/api/files${query(scoped({ path: entry.path, recursive: isDir ? "1" : undefined }))}`, { method: "DELETE" });
        if (!result.ok) {
            target.error = result.error;
            changed();
            return false;
        }
        if (target.open && (target.open.path === entry.path || target.open.path.startsWith(`${entry.path}/`))) {
            target.open = null;
            state.fileEditorModal?.close("deleted");
        }
        await listDirectory(target.path);
        return true;
    }
};


function openFileEditorModal(filePath) {

    if (state.fileEditorModal && state.fileEditorModal.isOpen()) {
        state.fileEditorModal.setTitle(filePath.split("/").pop() || filePath);
        state.fileEditorModal.setSubtitle(fileEditorSubtitle(files()));
        return state.fileEditorModal;
    }

    let dispose = () => {};
    let disposeFooter = () => {};

    const footerHost = document.createElement("div");
    footerHost.className = "modal-row files-editor-actions";

    const handle = Modal.open({
        title: filePath.split("/").pop() || filePath,
        subtitle: fileEditorSubtitle(files()),
        size: "large",
        className: "file-editor-modal",
        footer: footerHost,
        onClose: () => {
            dispose();
            disposeFooter();
            state.fileEditorModal = null;
        }
    });

    state.fileEditorModal = handle;
    dispose = mountInModal(
        handle,
        () => FileEditorBody({ files: state.files, actions }),
        ["files"],
        {},
        "file-editor-modal-content"
    );
    disposeFooter = mount(
        footerHost,
        () => FileEditorFooter({ files: state.files, actions }),
        ["files"]
    );

    return handle;
}


export async function openFiles() {

    if (state.filesModal && state.filesModal.isOpen()) return state.filesModal;

    state.filesModal = null;

    const target = files();
    let dispose = () => {};

    const handle = Modal.open({
        title: "Files",
        subtitle: filesSubtitle(target),
        size: "large",
        className: "files-modal",
        onClose: () => {
            state.fileEditorModal?.close("parent");
            dispose();
            state.filesModal = null;
        }
    });

    state.filesModal = handle;
    dispose = mountInModal(
        handle,
        () => FilesBody({ files: state.files, projects: state.projects, actions }),
        ["files", "projects"],
        {},
        "files-modal-content"
    );

    await listDirectory(target.path);

    return handle;
}


export const filesActions = actions;
