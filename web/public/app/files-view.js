/*
|--------------------------------------------------------------------------
| Files view
|--------------------------------------------------------------------------
|
| A two-pane file manager: the directory on the left (breadcrumb, entries,
| new file / new folder, rename and delete per entry), the open file on
| the right in a plain-text editor with Save (Ctrl/Cmd+S), Revert and
| Download. The root is the workspace or a registered project. An edited
| buffer lives in state.files, so closing the dialog does not lose it.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";
import { authenticatedUrl } from "./auth-transport.js";
import { formatBytes, formatStamp, query } from "./operator-api.js";
import { SkeletonLines, SkeletonRows } from "./skeleton-view.js";


export function createFilesState() {

    return {
        projectId: "",
        path: ".",
        listing: null,
        loading: false,
        fileLoading: false,
        error: null,
        filter: "",
        open: null,
        editorKey: 0
    };
}


export function isDirty(files) {
    return Boolean(files.open && files.open.content !== null && files.open.draft !== files.open.content);
}


export function filesSubtitle(files) {

    const where = files.listing?.root || "";

    return isDirty(files) ? `${where} · unsaved changes` : where;
}


export function fileEditorTitle(files) {

    return files.open?.name || files.open?.path?.split("/").pop() || "File";
}


export function fileEditorSubtitle(files) {

    return filesSubtitle(files);
}


export function downloadUrl(files, filePath) {
    return authenticatedUrl(`/api/files/download${query({ path: filePath, projectId: files.projectId || undefined })}`);
}


function crumbs(current) {

    const parts = current === "." ? [] : current.split("/");

    return [{ label: "root", path: "." }, ...parts.map((part, index) => ({
        label: part,
        path: parts.slice(0, index + 1).join("/")
    }))];
}


/* drawn by CSS (operator.css), so no emoji font is needed */
function iconClass(entry) {

    if (entry.type === "symlink") return entry.target_type === "broken" ? "link broken" : "link";
    if (entry.type === "directory") return "dir";

    return "file";
}


function EntryRow({ entry, files, actions }) {

    const isDir = entry.type === "directory" || entry.target_type === "directory";
    const selected = files.open && files.open.path === entry.path;

    return html`<li class=${`file-entry${selected ? " selected" : ""}`}>
        <button
            type="button"
            class="file-entry-open"
            title=${entry.path}
            onClick=${() => (isDir ? actions.navigate(entry.path) : actions.openFile(entry.path))}
        >
            <span class=${`file-icon ${iconClass(entry)}`} aria-hidden="true"></span>
            <span class="file-name">${entry.name}</span>
            <span class="file-meta">${isDir ? "" : formatBytes(entry.size)}</span>
        </button>
        <span class="file-entry-actions">
            <button type="button" class="ghost" title="Rename or move" aria-label=${`Rename ${entry.name}`} onClick=${() => actions.rename(entry)}>✎</button>
            <button type="button" class="ghost danger" title="Delete" aria-label=${`Delete ${entry.name}`} onClick=${() => actions.remove(entry)}>✕</button>
        </span>
    </li>`;
}


function Browser({ files, projects, actions }) {

    const listing = files.listing;
    const filter = files.filter.trim().toLowerCase();
    const entries = (listing?.entries || []).filter(entry => !filter || entry.name.toLowerCase().includes(filter));

    return html`<section class="files-browser" aria-label="Directory">
        <div class="files-toolbar">
            <select class="files-root" aria-label="Root" onChange=${event => actions.root(event.currentTarget.value)}>
                <option value="" selected=${!files.projectId}>Workspace</option>
                ${projects.map(project => html`<option value=${project.id} selected=${files.projectId === project.id}>${project.name || project.id}</option>`)}
            </select>
            <button type="button" class="ghost" title="New file" onClick=${() => actions.create("file")}>+ File</button>
            <button type="button" class="ghost" title="New folder" onClick=${() => actions.create("directory")}>+ Folder</button>
            <button type="button" class="ghost" title="Refresh" aria-label="Refresh" onClick=${() => actions.refresh()}>↻</button>
        </div>
        <div class="files-crumbs-row">
            <nav class="files-crumbs" aria-label="Path">
                ${crumbs(listing?.path || files.path).map(crumb => html`<button type="button" class="files-crumb" key=${crumb.path} onClick=${() => actions.navigate(crumb.path)}>${crumb.label}</button>`)}
            </nav>
            ${files.loading && listing ? html`<span class="muted files-refreshing">Refreshing…</span>` : null}
        </div>
        <input
            type="search"
            class="files-filter"
            placeholder="Filter this folder"
            aria-label="Filter this folder"
            value=${files.filter}
            onInput=${event => actions.filter(event.currentTarget.value)}
        />
        ${files.error ? html`<p class="files-error" role="alert">${files.error}</p>` : null}
        ${files.loading && !listing
            ? html`<div class="files-list-loading"><${SkeletonRows} count=${6} compact=${true} label="Loading…" /></div>`
            : html`<ul class="file-list">
                ${listing?.parent !== null && listing?.parent !== undefined
                    ? html`<li class="file-entry"><button type="button" class="file-entry-open" onClick=${() => actions.navigate(listing.parent)}>
                        <span class="file-icon up" aria-hidden="true"></span><span class="file-name">..</span><span class="file-meta"></span>
                    </button></li>`
                    : null}
                ${entries.map(entry => html`<${EntryRow} key=${entry.path} entry=${entry} files=${files} actions=${actions} />`)}
                ${listing && entries.length === 0 && !files.loading
                    ? html`<li class="file-list-empty"><p class="empty">${filter ? "Nothing matches the filter." : "This folder is empty."}</p></li>`
                    : null}
            </ul>`}
        ${listing?.truncated ? html`<p class="muted files-truncated">Only the first 5000 entries are shown.</p>` : null}
    </section>`;
}


function onEditorKey(event, actions) {

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        actions.save();
        return;
    }

    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const area = event.currentTarget;
        area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end");
        actions.edit(area.value);
    }
}


function Editor({ files, actions }) {

    if (files.fileLoading) {
        return html`<section class="files-editor" aria-label="Editor">
            <${SkeletonLines} rows=${8} label="Loading file…" />
        </section>`;
    }

    const file = files.open;

    if (!file) {
        return html`<section class="files-editor empty-editor"><p class="empty">Select a file to view or edit it.</p></section>`;
    }

    const dirty = isDirty(files);
    const editable = file.content !== null;

    return html`<section class="files-editor" aria-label="Editor">
        <div class="files-editor-head">
            <span class="files-editor-path" title=${file.path}>${dirty ? "● " : ""}${file.path}</span>
            <span class="muted files-editor-meta">${formatBytes(file.size)}${file.mtime_ms ? ` · ${formatStamp(file.mtime_ms)}` : ""}</span>
        </div>
        ${file.error ? html`<p class="files-error" role="alert">${file.error}</p>` : null}
        ${file.message ? html`<p class="files-message">${file.message}</p>` : null}
        ${file.binary ? html`<p class="empty">This is a binary file; it can be downloaded but not edited here.</p>` : null}
        ${file.too_large ? html`<p class="empty">${`This file is larger than ${formatBytes(file.max_bytes)}; download it instead.`}</p>` : null}
        ${editable ? html`<textarea
            key=${`${file.path}:${files.editorKey}`}
            class="files-textarea"
            spellcheck=${false}
            aria-label=${`Contents of ${file.path}`}
            defaultValue=${file.draft}
            onInput=${event => actions.edit(event.currentTarget.value)}
            onKeyDown=${event => onEditorKey(event, actions)}
        ></textarea>` : null}
    </section>`;
}


export function FileEditorFooter({ files, actions }) {

    const file = files.open;

    if (files.fileLoading || !file) {
        return null;
    }

    const dirty = isDirty(files);
    const editable = file.content !== null;

    return html`
        ${editable ? html`<button type="button" class="ghost" disabled=${!dirty || file.saving} onClick=${() => actions.revert()}>Revert</button>` : null}
        <button type="button" class="ghost" onClick=${() => actions.reload()}>Reload</button>
        <a class="ghost button" href=${downloadUrl(files, file.path)} download>Download</a>
        ${editable ? html`<button type="button" disabled=${!dirty || file.saving} onClick=${() => actions.save()}>${file.saving ? "Saving…" : "Save"}</button>` : null}
    `;
}


export function FileEditorBody({ files, actions }) {

    return html`<${Editor} files=${files} actions=${actions} />`;
}


export function FilesBody({ files, projects, actions }) {

    return html`<div class="files-workspace">
        <${Browser} files=${files} projects=${projects || []} actions=${actions} />
    </div>`;
}
