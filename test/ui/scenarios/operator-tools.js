"use strict";

/*
| Console behaviour — the Logs, Terminal and Files dialogs
|
| Runs last inside ui.test.js. The three dialogs talk to their own routes
| (with query strings), so this group answers those from a small scripted
| server and hands every other request to the console's usual stub.
| xterm.js is replaced by a fake that records what it is given.
*/

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");


const settle = async (rounds = 6) => {
    for (let index = 0; index < rounds; index++) await new Promise(resolve => setTimeout(resolve, 0));
};


function scriptedServer(fallback) {

    const calls = [];
    const routes = [];

    const fetch = async (url, options = {}) => {
        const method = (options.method || "GET").toUpperCase();
        const route = routes.find(item => item.method === method && item.match(url));
        if (!route) return fallback(url, options);
        const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
        calls.push({ method, url, body });
        const answer = await route.answer({ url, body, raw: options.body, headers: options.headers || {}, query: new URL(url, "http://console").searchParams });
        const status = answer && answer.__status ? answer.__status : 200;
        const payload = answer && answer.__status ? answer.body : answer;
        return { ok: status >= 200 && status < 300, status, json: async () => payload };
    };

    const on = (method, pattern, answer) => {
        const match = typeof pattern === "string" ? url => url.split("?")[0] === pattern : url => pattern.test(url);
        routes.unshift({ method, match, answer });
    };

    return { fetch, on, calls };
}


function fakeXterm() {

    const made = [];

    class Terminal {
        constructor(options) {
            this.options = options;
            this.cols = 80;
            this.rows = 24;
            this.text = "";
            this.resets = 0;
            this.addons = [];
            this.listeners = { data: [], resize: [] };
            made.push(this);
        }
        loadAddon(addon) { this.addons.push(addon); }
        open(host) {
            this.host = host;
            const screen = host.ownerDocument.createElement("div");
            screen.className = "xterm";
            host.append(screen);
        }
        onData(fn) { this.listeners.data.push(fn); }
        onResize(fn) { this.listeners.resize.push(fn); }
        write(text) { this.text += text; }
        reset() { this.resets++; this.text = ""; }
        focus() { this.focused = true; }
        scrollLines(lines) { this.scrolledLines = (this.scrolledLines || 0) + lines; }
        dispose() { this.disposed = true; }
        type(text) { this.listeners.data.forEach(fn => fn(text)); }
    }

    class FitAddon {
        fit() { this.fitted = (this.fitted || 0) + 1; }
    }

    return { made, load: async () => ({ Terminal, FitAddon }) };
}


module.exports = async function OperatorTools({ test, backdrops, console_ }) {

    const app = file => import(pathToFileURL(path.join(__dirname, "..", "..", "..", "web", "public", "app", file)).href);
    const { logsInternals, installPanelErrorReporting } = await app("logs-controller.js");
    const { setTerminalLoader } = await app("terminal-controller.js");
    const { state } = await app("store.js");

    const server = scriptedServer(global.fetch);
    global.fetch = server.fetch;
    const dialog = kind => document.querySelector(`.modal.${kind}-modal`);
    const close = kind => dialog(kind)?.querySelector(".modal-close").dispatch("click");
    const deliver = (stream, event) => stream.onmessage({ data: JSON.stringify(event) });

    let logEntries = [
        { id: 1, at: "2026-11-25T10:00:00.000Z", level: "info", source: "run", message: "Run started: hi" },
        { id: 2, at: "2026-11-25T10:00:01.000Z", level: "error", source: "ai", message: "AI request failed: HTTP 401 from api.example (gpt)", details: { status: 401, model: "gpt", provider: "api.example", response: "{\"error\":\"bad key ****\"}" } },
        { id: 3, at: "2026-11-25T10:00:02.000Z", level: "warn", source: "ai", message: "Retrying AI request in 600 ms (attempt 1/3)" }
    ];
    const summary = () => ({ counts: { debug: 0, info: 1, warn: 1, error: 1 }, sources: ["ai", "run"], total: logEntries.length, last_id: logEntries.at(-1)?.id || 0, file: "/data/logs/structured-ai.jsonl" });
    server.on("GET", "/api/logs", ({ query }) => {
        const after = Number(query.get("after")) || 0;
        const level = query.get("level");
        return { entries: logEntries.filter(entry => entry.id > after && (!level || entry.level === level)), summary: summary() };
    });

    await test("the Logs dialog lists entries newest first, filters them and expands an AI failure", async () => {
        document.getElementById("logsButton").dispatch("click");
        await settle();
        const modal = dialog("logs");
        assert.ok(modal, "the dialog opened");
        assert.match(modal.querySelector(".modal-subtitle").textContent, /1 error/);
        const messages = () => [...modal.querySelectorAll(".log-entry .log-message")].map(node => node.textContent);
        assert.deepEqual(messages(), ["Retrying AI request in 600 ms (attempt 1/3)", "AI request failed: HTTP 401 from api.example (gpt)", "Run started: hi"]);
        assert.match(modal.querySelector(".logs-file").textContent, /structured-ai\.jsonl/);
        const toolbar = modal.querySelector(".logs-toolbar");
        assert.equal(toolbar.querySelectorAll(".logs-filter").length, 2);
        assert.ok(toolbar.querySelector(".logs-search"));
        assert.equal(toolbar.querySelector(".logs-actions"), null, "actions moved to modal footer");
        const foot = modal.querySelector(".modal-foot");
        assert.ok([...foot.querySelectorAll("button")].find(button => button.textContent === "Refresh"));
        assert.ok(foot.querySelector('a[href="/api/logs/download"]'));
        assert.ok([...foot.querySelectorAll("button")].find(button => button.textContent === "Clear"));

        const level = modal.querySelector("select[aria-label='Minimum level']");
        level.value = "error";
        level.dispatch("change");
        assert.deepEqual(messages(), ["AI request failed: HTTP 401 from api.example (gpt)"]);
        level.value = "debug";
        level.dispatch("change");

        const search = modal.querySelector(".logs-search");
        search.value = "retrying";
        search.dispatch("input");
        assert.equal(messages().length, 1);
        search.value = "";
        search.dispatch("input");

        const failure = [...modal.querySelectorAll(".log-entry")].find(row => row.classList.contains("level-error"));
        assert.match(failure.querySelector(".log-facts").textContent, /HTTP 401/);
        failure.querySelector(".log-entry-head").dispatch("click");
        assert.match(modal.querySelector(".log-response pre").textContent, /bad key/);
        assert.match(modal.querySelector(".log-details").textContent, /"provider": "api.example"/);
    });

    await test("a live entry arrives through the log stream, and Clear empties the list after a confirmation", async () => {
        const modal = dialog("logs");
        const stream = console_.streams.at(-1);
        assert.equal(stream.closed, false);
        logEntries = [...logEntries, { id: 4, at: "2026-11-25T10:00:03.000Z", level: "error", source: "tool", message: "Tool write_file failed: EACCES" }];
        deliver(stream, { type: "snapshot", summary: summary() });
        deliver(stream, { type: "entry", entry: logEntries.at(-1) });
        assert.equal(modal.querySelector(".log-entry .log-message").textContent, "Tool write_file failed: EACCES");

        server.on("DELETE", "/api/logs", () => ({ ok: true, summary: { ...summary(), total: 0 } }));
        const clear = [...modal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Clear");
        clear.dispatch("click");
        await settle();
        const declineModal = document.querySelector(".modal.confirm-modal");
        assert.ok(declineModal, "confirmation modal opened before clearing logs");
        [...declineModal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Cancel").dispatch("click");
        await settle();
        assert.equal(modal.querySelectorAll(".log-entry").length, 4, "declined: nothing cleared");

        clear.dispatch("click");
        await settle();
        const acceptModal = document.querySelector(".modal.confirm-modal");
        assert.ok(acceptModal);
        [...acceptModal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Clear").dispatch("click");
        await settle();
        assert.equal(modal.querySelectorAll(".log-entry").length, 0);
        assert.ok(server.calls.some(call => call.method === "DELETE" && call.url === "/api/logs"));

        close("logs");
        assert.equal(stream.closed, true, "closing the dialog closes its stream");
        assert.equal(state.logsModal, null);
    });

    await test("the header badge counts new errors while the dialog is closed and stops for a scoped token", async () => {
        const badge = document.getElementById("logsBadge");
        state.logs.badgePrimed = true;
        logEntries = [...logEntries, { id: 5, at: "2026-11-25T10:01:00.000Z", level: "error", source: "ai", message: "AI request gave up" }];
        await logsInternals.pollBadge();
        await settle();
        assert.deepEqual([badge.hidden, badge.textContent], [false, "1"]);

        document.getElementById("logsButton").dispatch("click");
        await settle();
        assert.equal(badge.hidden, true, "opening the dialog marks everything seen");
        close("logs");

        server.on("GET", "/api/logs", () => ({ __status: 403, body: { error: "forbidden" } }));
        await logsInternals.pollBadge();
        const before = server.calls.length;
        await logsInternals.pollBadge();
        assert.equal(server.calls.length, before, "no more polling once the log is forbidden");
    });

    await test("panel errors are reported once each, and opaque cross-origin errors are skipped", async () => {
        const target = new window.EventTarget();
        server.on("POST", "/api/logs", () => ({ __status: 201, body: { id: 9 } }));
        const remove = installPanelErrorReporting(target);
        const error = new Error("render exploded");
        const fire = init => target.dispatchEvent(Object.assign(new window.Event("error"), init));
        fire({ message: "render exploded", error, filename: "/app/x.js", lineno: 4 });
        fire({ message: "render exploded", error, filename: "/app/x.js", lineno: 4 });
        fire({ message: "Script error." });
        target.dispatchEvent(Object.assign(new window.Event("unhandledrejection"), { reason: new Error("promise lost") }));
        await settle();
        remove();
        const reports = server.calls.filter(call => call.method === "POST" && call.url === "/api/logs").map(call => call.body.message);
        assert.deepEqual(reports, ["Console: render exploded", "Console: promise lost"]);
    });

    const xterm = fakeXterm();
    setTerminalLoader(xterm.load);
    let terminals = [];
    let nextId = 1;
    server.on("GET", "/api/terminal", () => ({ enabled: true, mode: "pty", shell: "/opt/shells/bash", cwd: "/work", max_sessions: 2, sessions: terminals }));
    server.on("POST", "/api/terminal", ({ body }) => {
        const session = { id: `t${nextId++}`, pid: 100 + nextId, shell: "/opt/shells/bash", cwd: "/work", mode: "pty", cols: body.cols, rows: body.rows, exited: null };
        terminals = [...terminals, session];
        return { __status: 201, body: { session } };
    });
    server.on("POST", /^\/api\/terminal\/t\d+\/(input|resize)$/, () => ({ ok: true }));
    server.on("DELETE", /^\/api\/terminal\/t\d+$/, ({ url }) => {
        terminals = terminals.filter(session => !url.endsWith(`/${session.id}`));
        return { ok: true };
    });

    await test("the Terminal dialog opens a shell, replays its stream and sends keystrokes in order", async () => {
        document.getElementById("terminalButton").dispatch("click");
        await settle(10);
        const modal = dialog("terminal");
        assert.ok(modal);
        assert.equal(terminals.length, 1, "no live shell existed, so one was opened");
        const term = xterm.made.at(-1);
        assert.ok(modal.querySelector(".terminal-host .terminal-screen .xterm"), "xterm drew inside zero-padding terminal-screen");
        assert.equal(term.focused, true);
        assert.equal(term.options.scrollSensitivity, 3);
        assert.ok(term.options.theme.scrollbarSliderBackground);

        const screenNode = modal.querySelector(".terminal-screen");
        screenNode.dispatchEvent(Object.assign(new window.Event("touchstart", { bubbles: true }), { touches: [{ clientY: 100 }] }));
        screenNode.dispatchEvent(Object.assign(new window.Event("touchmove", { bubbles: true, cancelable: true }), { touches: [{ clientY: 160 }] }));
        screenNode.dispatchEvent(Object.assign(new window.Event("touchend", { bubbles: true }), { touches: [] }));
        assert.ok(term.scrolledLines < 0, "dragging down scrolls up into scrollback history");

        const stream = console_.streams.at(-1);
        deliver(stream, { type: "snapshot", session: terminals[0], data: "$ previous\r\n" });
        deliver(stream, { type: "output", data: "$ " });
        assert.equal(term.text, "$ previous\r\n$ ");
        assert.match(modal.querySelector(".modal-head .terminal-status").textContent, /connected/);
        assert.equal(modal.querySelector(".terminal-toolbar .terminal-status"), null, "status moved from toolbar body into modal header");

        term.type("l");
        term.type("s\r");
        await new Promise(resolve => setTimeout(resolve, 30));
        await settle();
        const inputs = server.calls.filter(call => call.url.endsWith("/input")).map(call => call.body.data);
        assert.deepEqual(inputs, ["ls\r"], "batched into one request");

        const escape = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        modal.querySelector(".terminal-host .xterm").dispatchEvent(escape);
        assert.ok(dialog("terminal"), "Escape goes to the shell, not to the dialog");

        deliver(stream, { type: "exit", code: 0, signal: null });
        assert.match(term.text, /process exited with code 0/);
        assert.match(modal.querySelector(".terminal-tab-select").textContent, /exited/);
    });

    await test("tabs open, switch and close; closing the dialog only detaches", async () => {
        const modal = dialog("terminal");
        modal.querySelector(".terminal-new").dispatch("click");
        await settle(10);
        assert.equal(terminals.length, 2);
        assert.equal(modal.querySelectorAll(".terminal-tab").length, 2);
        assert.equal(modal.querySelector(".terminal-new").disabled, false, "the exited shell does not count");

        const first = xterm.made.at(-2);
        assert.equal(first.disposed, true, "the previous screen was released");
        modal.querySelectorAll(".terminal-tab-close")[0].dispatch("click");
        await settle(10);
        assert.deepEqual(terminals.map(session => session.id), ["t2"]);
        assert.equal(modal.querySelectorAll(".terminal-tab").length, 1);

        const stream = console_.streams.at(-1);
        close("terminal");
        assert.equal(stream.closed, true);
        assert.equal(xterm.made.at(-1).disposed, true);
        assert.equal(terminals.length, 1, "the shell keeps running on the server");
        assert.equal(backdrops().length, 0);
    });

    await test("a disabled terminal shows the server's reason", async () => {
        server.on("GET", "/api/terminal", () => ({ __status: 403, body: { error: "The system terminal is disabled (CONSOLE_TERMINAL_ENABLED=false)." } }));
        document.getElementById("terminalButton").dispatch("click");
        await settle(10);
        assert.match(dialog("terminal").textContent, /CONSOLE_TERMINAL_ENABLED=false/);
        close("terminal");
    });

    const disk = { "README.md": { content: "# Demo\n", mtime_ms: 1000 } };
    server.on("GET", "/api/files", ({ query }) => ({
        root: "/work",
        path: query.get("path") || ".",
        parent: null,
        truncated: false,
        entries: [
            { name: "src", path: "src", type: "directory", size: null, mtime_ms: 1 },
            ...Object.keys(disk).map(name => ({ name, path: name, type: "file", size: disk[name].content.length, mtime_ms: disk[name].mtime_ms }))
        ]
    }));
    server.on("GET", "/api/files/content", ({ query }) => {
        const file = disk[query.get("path")];
        return file ? { name: query.get("path"), path: query.get("path"), type: "file", size: file.content.length, mtime_ms: file.mtime_ms, binary: false, too_large: false, content: file.content } : { __status: 404, body: { error: "Not found" } };
    });
    server.on("PUT", "/api/files/content", ({ body }) => {
        const file = disk[body.path];
        if (body.expected_mtime_ms !== undefined && file.mtime_ms !== body.expected_mtime_ms) return { __status: 409, body: { error: "changed", current_mtime_ms: file.mtime_ms } };
        disk[body.path] = { content: body.content, mtime_ms: file.mtime_ms + 1 };
        return { entry: { name: body.path, path: body.path, type: "file", size: body.content.length, mtime_ms: file.mtime_ms + 1 } };
    });

    await test("the Files dialog opens a file in a separate editor modal, edits and saves it with Ctrl+S, and resolves a conflict", async () => {
        document.getElementById("filesButton").dispatch("click");
        await settle(10);
        const modal = dialog("files");
        const open = name => [...modal.querySelectorAll(".file-entry-open")].find(button => button.querySelector(".file-name").textContent === name);
        assert.deepEqual([...modal.querySelectorAll(".file-name")].map(node => node.textContent), ["src", "README.md"]);
        assert.equal(modal.querySelector(".files-textarea"), null, "file browser modal no longer renders inline editor");

        open("README.md").dispatch("click");
        await settle(10);
        const editorModal = dialog("file-editor");
        assert.ok(editorModal, "opening a file opens the separate file editor modal");
        assert.equal(modal.isConnected, true, "the Files modal stays open underneath");
        assert.ok(editorModal.querySelector(".modal-foot .files-editor-actions"), "editor actions live in the modal footer");
        assert.equal(editorModal.querySelector(".modal-body .files-editor-actions"), null, "no editor actions in modal body");
        assert.ok(editorModal.querySelector(".files-editor-head .files-editor-path"));
        assert.ok(editorModal.querySelector(".files-editor-head .files-editor-meta"));
        const editor = editorModal.querySelector(".files-textarea");
        assert.equal(editor.value, "# Demo\n");

        editor.value = "# Demo\nmore\n";
        editor.dispatch("input");
        assert.match(editorModal.querySelector(".files-editor-path").textContent, /●/, "unsaved changes are marked");
        editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
        await settle(10);
        assert.equal(disk["README.md"].content, "# Demo\nmore\n");
        assert.match(editorModal.querySelector(".files-message").textContent, /Saved/);

        disk["README.md"].mtime_ms = 5000;
        const editor2 = editorModal.querySelector(".files-textarea");
        editor2.value = "mine\n";
        editor2.dispatch("input");
        const saveButton = () => [...editorModal.querySelectorAll(".files-editor-actions button")].find(button => button.textContent === "Save");
        saveButton().dispatch("click");
        await settle(10);
        const cancelOverwrite = document.querySelector(".modal.confirm-modal");
        assert.ok(cancelOverwrite, "conflict opened a confirmation modal");
        [...cancelOverwrite.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Cancel").dispatch("click");
        await settle(10);
        assert.match(editorModal.querySelector(".files-editor .files-error").textContent, /changed on disk/);
        assert.equal(disk["README.md"].content, "# Demo\nmore\n", "declined: the newer file is kept");

        saveButton().dispatch("click");
        await settle(10);
        const confirmOverwrite = document.querySelector(".modal.confirm-modal");
        assert.ok(confirmOverwrite);
        [...confirmOverwrite.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Overwrite").dispatch("click");
        await settle(10);
        assert.equal(disk["README.md"].content, "mine\n", "confirmed: overwritten");
        const puts = server.calls.filter(call => call.method === "PUT");
        assert.equal(puts.at(-1).body.expected_mtime_ms, undefined, "the overwrite does not send the stale mtime");

        const footerButtons = [...editorModal.querySelectorAll(".files-editor-actions button, .files-editor-actions a")];
        assert.equal(footerButtons.find(button => button.textContent === "Close"), undefined, "Close button was removed from footer");
        assert.equal(footerButtons.at(-1)?.textContent, "Save", "Save is the first button from the right");

        editorModal.querySelector(".modal-close").dispatch("click");
        await settle(10);
        assert.equal(dialog("file-editor"), null, "editor modal closed");
        assert.equal(dialog("files"), modal, "Files browser modal remains open");

        modal.querySelector('button[aria-label="Rename README.md"]').dispatch("click");
        await settle(10);
        const promptModal = document.querySelector(".modal.prompt-modal");
        assert.ok(promptModal?.querySelector(".modal-prompt-input"), "Rename modal renders styled prompt input");
        [...promptModal.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Cancel").dispatch("click");
        await settle(10);

        close("files");
        assert.equal(backdrops().length, 0);
    });

    server.on("PUT", "/api/files/upload", ({ query, raw, headers }) => {
        const name = query.get("path");
        if (disk[name] && query.get("overwrite") !== "1") return { __status: 409, body: { error: `Already exists: ${name}`, exists: true } };
        if (raw && raw.tooBig) return { __status: 413, body: { error: "The upload is larger than CONSOLE_FILE_UPLOAD_MAX_BYTES (1024 bytes)." } };
        const created = !disk[name];
        disk[name] = { content: raw.text, mtime_ms: 7000, uploadedAs: headers["content-type"] };
        return { __status: created ? 201 : 200, body: { entry: { name, path: name, type: "file", size: raw.size, mtime_ms: 7000, created } } };
    });

    await test("the Files dialog uploads picked or dropped files into the current folder, asking before it replaces one", async () => {
        document.getElementById("filesButton").dispatch("click");
        await settle(10);
        const modal = dialog("files");
        const uploadButton = modal.querySelector(".files-toolbar .files-upload-button");
        const input = modal.querySelector(".files-toolbar input.files-upload-input");
        assert.ok(uploadButton, "Upload sits in the Files toolbar");
        assert.equal(uploadButton.textContent.trim(), "⇪ Upload");
        assert.ok(input && input.hidden && input.multiple, "a hidden multi-file picker backs the button");
        let picked = 0;
        input.click = () => { picked++; };
        uploadButton.dispatch("click");
        assert.equal(picked, 1, "the button opens the file picker");

        const file = (name, text, extra = {}) => ({ name, size: text.length, text, ...extra });
        Object.defineProperty(input, "files", { value: [file("logo.png", "PNGDATA"), file("README.md", "replaced readme")], configurable: true });
        input.dispatch("change");
        await settle(10);
        const confirmReplace = document.querySelector(".modal.confirm-modal");
        assert.ok(confirmReplace, "a name that exists asks first");
        assert.match(confirmReplace.textContent, /README\.md already exists/);
        [...confirmReplace.querySelectorAll(".modal-foot button")].find(button => button.textContent === "Replace").dispatch("click");
        await settle(10);
        assert.equal(disk["logo.png"].content, "PNGDATA", "the raw file is the request body");
        assert.equal(disk["logo.png"].uploadedAs, "application/octet-stream");
        assert.equal(disk["README.md"].content, "replaced readme", "confirmed: replaced");
        const uploads = server.calls.filter(call => call.url.startsWith("/api/files/upload"));
        assert.deepEqual(uploads.map(call => new URL(call.url, "http://x").searchParams.get("overwrite")), [null, null, "1"], "overwrite=1 only after the confirmation");
        assert.match(modal.querySelector(".files-upload-status").textContent, /Uploaded 2 of 2/);
        assert.ok([...modal.querySelectorAll(".file-name")].some(node => node.textContent === "logo.png"), "the listing is re-read after the upload");

        /* drag and drop onto the directory pane */
        const browser = modal.querySelector(".files-browser");
        const drag = (type, files = []) => {
            const event = new window.Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "none" } });
            browser.dispatchEvent(event);
            return event;
        };
        assert.equal(drag("dragenter").defaultPrevented, true, "dragging files over the pane accepts the drop");
        await settle(4);
        assert.ok(modal.querySelector(".files-browser").classList.contains("drop-target"), "the pane is highlighted while dragging");
        assert.match(modal.querySelector(".files-drop-hint").textContent, /Drop to upload into root/);
        drag("drop", [file("notes.txt", "dropped"), file("huge.bin", "x", { tooBig: true })]);
        await settle(10);
        assert.equal(modal.querySelector(".files-browser").classList.contains("drop-target"), false);
        assert.equal(disk["notes.txt"].content, "dropped", "a dropped file is uploaded");
        assert.equal(disk["huge.bin"], undefined);
        const status = modal.querySelector(".files-upload-status");
        assert.ok(status.classList.contains("has-failures"));
        assert.match(status.textContent, /Uploaded 1 of 2 · failed: huge\.bin/);
        assert.match(modal.querySelector(".files-error").textContent, /huge\.bin: .*CONSOLE_FILE_UPLOAD_MAX_BYTES/);

        close("files");
        assert.equal(backdrops().length, 0);
    });
};
