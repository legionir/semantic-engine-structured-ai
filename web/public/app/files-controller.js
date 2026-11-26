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
| without a confirmation.
*/

import { state, touch } from "./store.js";
import { mountInModal } from "./dom.js";
import { createFilesState, FilesBody, filesSubtitle, isDirty } from "./files-view.js";
import { apiRequest, query } from "./operator-api.js";


function files() {

    if (!state.files) state.files = createFilesState();

    return state.files;
}


function changed() {
    state.filesModal?.setSubtitle(filesSubtitle(files()));
    touch("files");
}


function ask(message, initial = "") {
    return typeof window !== "undefined" && typeof window.prompt === "function" ? window.prompt(message, initial) : null;
}


function confirmed(message) {
    return typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm(message);
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
    const result = await apiRequest(`/api/files/content${query(scoped({ path: filePath }))}`);

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
        if (isDirty(target) && !confirmed("Discard the unsaved changes?")) {
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
        if (target.open?.path === filePath) return true;
        if (isDirty(target) && !confirmed(`Discard the unsaved changes to ${target.open.path}?`)) return false;
        return loadFile(filePath);
    },

    closeFile() {
        const target = files();
        if (isDirty(target) && !confirmed(`Discard the unsaved changes to ${target.open.path}?`)) return false;
        target.open = null;
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
            if (confirmed(`${file.path} changed on disk since it was opened. Overwrite it with your version?`)) {
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
        if (isDirty(target) && !confirmed("Reload from disk and discard your unsaved changes?")) return false;
        return loadFile(target.open.path);
    },

    async create(type) {
        const target = files();
        const name = ask(type === "directory" ? "New folder name (a/b/c creates the whole path):" : "New file name:");
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

    async rename(entry) {
        const target = files();
        const next = ask(`Rename or move ${entry.path} to (relative to the root):`, entry.path);
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
        if (!confirmed(isDir ? `Delete the folder ${entry.path} and everything in it?` : `Delete ${entry.path}?`)) return false;
        const result = await apiRequest(`/api/files${query(scoped({ path: entry.path, recursive: isDir ? "1" : undefined }))}`, { method: "DELETE" });
        if (!result.ok) {
            target.error = result.error;
            changed();
            return false;
        }
        if (target.open && (target.open.path === entry.path || target.open.path.startsWith(`${entry.path}/`))) {
            target.open = null;
        }
        await listDirectory(target.path);
        return true;
    }
};


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
            dispose();
            state.filesModal = null;
        }
    });

    state.filesModal = handle;
    dispose = mountInModal(
        handle,
        () => FilesBody({ files: state.files, projects: state.projects, actions }),
        ["files", "projects"]
    );

    await listDirectory(target.path);

    return handle;
}


export const filesActions = actions;
