/*
|--------------------------------------------------------------------------
| System terminal
|--------------------------------------------------------------------------
|
| A real shell on the server, drawn with xterm.js (loaded on first use).
| Output arrives over /api/terminal/:id/stream; keystrokes are batched and
| posted in order to /input; the size follows the dialog. Closing the
| dialog only detaches — the shells keep running and their scrollback is
| replayed when the dialog opens again. Escape goes to the shell (vim,
| less…), not to the dialog; use the ✕ button to close it.
*/

import { state, touch } from "./store.js";
import { mount } from "./dom.js";
import { createTerminalState, TerminalStatus, TerminalToolbar, terminalSubtitle } from "./terminal-view.js";
import { apiRequest } from "./operator-api.js";
import { installCspStyleBridge } from "./csp-style-bridge.js";
import { createEventSource } from "./auth-transport.js";


const THEME = Object.freeze({
    background: "#0a0e17",
    foreground: "#e9edf7",
    cursor: "#6d9bff",
    cursorAccent: "#0a0e17",
    selectionBackground: "rgba(109, 155, 255, 0.35)",
    scrollbarSliderBackground: "rgba(148, 163, 184, 0.45)",
    scrollbarSliderHoverBackground: "rgba(148, 163, 184, 0.72)",
    scrollbarSliderActiveBackground: "rgba(148, 163, 184, 0.92)"
});

let loader = async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("../vendor/xterm.module.js"),
        import("../vendor/xterm-addon-fit.module.js")
    ]);
    return { Terminal, FitAddon };
};

/* the attached screen: one at a time, for the active session */
let screen = null;


/* tests replace xterm.js with a fake */
export function setTerminalLoader(next) {
    loader = next;
}


function terminal() {

    if (!state.terminal) state.terminal = createTerminalState();

    return state.terminal;
}


function changed() {
    state.terminalModal?.setSubtitle(terminalSubtitle(terminal()));
    touch("terminal");
}


async function refreshSessions() {

    const target = terminal();
    if (!target.info) {
        target.loading = true;
        changed();
    }

    const result = await apiRequest("/api/terminal");
    target.loading = false;

    if (!result.ok) {
        target.error = result.error;
        target.info = null;
        changed();
        return false;
    }

    const { sessions, ...info } = result.payload;
    target.info = info;
    target.sessions = sessions || [];
    target.error = null;
    changed();

    return true;
}


function monoFont() {
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim();
        return value || "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    } catch {
        return "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    }
}


function installTouchScroll(element, term) {

    if (typeof term.scrollLines !== "function") return () => {};

    let tracking = false;
    let scrolling = false;
    let startY = 0;
    let lastY = 0;
    let carry = 0;

    const lineHeight = () => {
        const rows = Math.max(1, Number(term.rows) || 24);
        const height = element.clientHeight || (element.getBoundingClientRect ? element.getBoundingClientRect().height : 0);
        return Math.max(12, height > 0 ? height / rows : 18);
    };

    const onStart = event => {
        if (!event.touches || event.touches.length !== 1) {
            tracking = false;
            scrolling = false;
            return;
        }
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".scrollbar")) {
            tracking = false;
            return;
        }
        tracking = true;
        scrolling = false;
        startY = event.touches[0].clientY;
        lastY = startY;
        carry = 0;
    };

    const onMove = event => {
        if (!tracking || !event.touches || event.touches.length !== 1) return;
        const y = event.touches[0].clientY;
        if (!scrolling && Math.abs(y - startY) < 4) return;
        scrolling = true;
        if (event.cancelable) event.preventDefault();
        const deltaY = y - lastY;
        lastY = y;
        carry += deltaY;
        const step = lineHeight();
        const lines = Math.trunc(carry / step);
        if (lines !== 0) {
            carry -= lines * step;
            term.scrollLines(-lines);
        }
    };

    const onEnd = () => {
        tracking = false;
        scrolling = false;
        carry = 0;
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd, { passive: true });
    element.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("touchmove", onMove);
        element.removeEventListener("touchend", onEnd);
        element.removeEventListener("touchcancel", onEnd);
    };
}


function detach() {

    if (!screen) return;

    const current = screen;
    screen = null;

    clearTimeout(current.flushTimer);
    clearTimeout(current.resizeTimer);
    current.stream?.close();
    current.observer?.disconnect();
    current.removeTouch?.();
    current.host.removeEventListener("keydown", current.keepEscape);
    try {
        current.term.dispose();
    } catch {
        /* already disposed */
    }
    current.host.replaceChildren();

    terminal().connection = "idle";
}


function sendInput(current) {

    current.flushTimer = null;

    if (!current.pending) return;

    const data = current.pending;
    current.pending = "";

    /* one request at a time keeps the keystrokes in order */
    current.sending = current.sending.then(async () => {
        const result = await apiRequest(`/api/terminal/${encodeURIComponent(current.id)}/input`, { json: { data } });
        if (!result.ok && screen === current) {
            terminal().error = result.error;
            changed();
        }
    });
}


function queueInput(current, data) {

    current.pending += data;

    if (current.pending.length > 4096) {
        clearTimeout(current.flushTimer);
        sendInput(current);
    } else if (!current.flushTimer) {
        current.flushTimer = setTimeout(() => sendInput(current), state.terminalInputFlushMs);
    }
}


function queueResize(current, cols, rows) {

    clearTimeout(current.resizeTimer);
    current.resizeTimer = setTimeout(() => {
        apiRequest(`/api/terminal/${encodeURIComponent(current.id)}/resize`, { json: { cols, rows } });
    }, state.terminalResizeDebounceMs);
}


function fit(current) {
    try {
        current.fit.fit();
    } catch {
        /* the dialog is hidden or not laid out yet */
    }
}


function connect(current) {

    const target = terminal();

    target.connection = "connecting";
    changed();

    const stream = createEventSource(`/api/terminal/${encodeURIComponent(current.id)}/stream`);
    current.stream = stream;

    stream.onmessage = message => {

        if (screen !== current) return;

        let data;
        try {
            data = JSON.parse(message.data);
        } catch {
            return;
        }

        if (data.type === "snapshot") {
            /* a (re)connect replays the whole scrollback */
            current.term.reset();
            if (data.data) current.term.write(data.data);
            target.connection = data.session?.exited ? "exited" : "connected";
            const session = target.sessions.find(item => item.id === current.id);
            if (session && data.session) Object.assign(session, data.session);
            if (data.session && (data.session.cols !== current.term.cols || data.session.rows !== current.term.rows)) {
                queueResize(current, current.term.cols, current.term.rows);
            }
            changed();
        } else if (data.type === "output") {
            current.term.write(data.data);
        } else if (data.type === "exit") {
            current.term.write(`\r\n\x1b[2m[process exited${data.code !== null ? ` with code ${data.code}` : ""}${data.signal ? `, signal ${data.signal}` : ""}]\x1b[0m\r\n`);
            const session = target.sessions.find(item => item.id === current.id);
            if (session) session.exited = { code: data.code, signal: data.signal, at: data.at };
            target.connection = "exited";
            changed();
        }
    };

    stream.onerror = () => {
        if (screen !== current) return;
        target.connection = stream.readyState === 2 ? "disconnected" : "reconnecting";
        changed();
    };
}


async function attach(id, host) {

    detach();

    const target = terminal();
    let modules;

    try {
        modules = await loader();
    } catch (error) {
        target.error = `The terminal could not be loaded: ${error.message}`;
        changed();
        return null;
    }

    if (target.activeId !== id || !state.terminalModal) return null;

    installCspStyleBridge();

    const term = new modules.Terminal({
        cursorBlink: true,
        fontFamily: monoFont(),
        fontSize: 13,
        scrollback: 5000,
        scrollSensitivity: 3,
        fastScrollSensitivity: 6,
        overviewRuler: { width: 16 },
        theme: THEME
    });
    const fitAddon = new modules.FitAddon();
    term.loadAddon(fitAddon);

    const screenEl = document.createElement("div");
    screenEl.className = "terminal-screen";
    host.replaceChildren(screenEl);

    const current = {
        id,
        term,
        fit: fitAddon,
        host,
        screenEl,
        pending: "",
        flushTimer: null,
        resizeTimer: null,
        sending: Promise.resolve(),
        stream: null,
        observer: null,
        removeTouch: null,
        /* Escape belongs to the shell, not to the dialog around it */
        keepEscape: event => {
            if (event.key === "Escape") event.stopPropagation();
        }
    };

    screen = current;

    host.addEventListener("keydown", current.keepEscape);
    term.open(screenEl);
    current.removeTouch = installTouchScroll(screenEl, term);
    fit(current);

    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            if (screen === current) fit(current);
        });
    }
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
        void document.fonts.ready.then(() => {
            if (screen === current) fit(current);
        });
    }

    term.onData(data => queueInput(current, data));
    term.onResize(({ cols, rows }) => queueResize(current, cols, rows));

    if (typeof ResizeObserver === "function") {
        current.observer = new ResizeObserver(() => fit(current));
        current.observer.observe(screenEl);
    }

    connect(current);
    term.focus();

    return current;
}


function actionsFor(host) {

    return {

        async activate(id) {
            const target = terminal();
            if (target.activeId === id && screen && screen.id === id) return;
            target.activeId = id;
            target.error = null;
            changed();
            await attach(id, host);
        },

        async create() {
            const target = terminal();
            target.busy = true;
            changed();
            const size = screen ? { cols: screen.term.cols, rows: screen.term.rows } : { cols: 100, rows: 30 };
            const result = await apiRequest("/api/terminal", { json: size });
            target.busy = false;
            if (!result.ok) {
                target.error = result.error;
                changed();
                return null;
            }
            target.sessions = [...target.sessions, result.payload.session];
            await this.activate(result.payload.session.id);
            return result.payload.session;
        },

        async kill(id) {
            const target = terminal();
            const result = await apiRequest(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!result.ok && result.status !== 404) {
                target.error = result.error;
                changed();
                return;
            }
            target.sessions = target.sessions.filter(item => item.id !== id);
            if (target.activeId === id) {
                detach();
                target.activeId = null;
                const next = target.sessions.find(item => !item.exited) || target.sessions[0];
                if (next) await this.activate(next.id);
            }
            changed();
        }
    };
}


export async function openTerminal() {

    if (state.terminalModal && state.terminalModal.isOpen()) return state.terminalModal;

    state.terminalModal = null;

    const target = terminal();
    const container = document.createElement("div");
    const toolbar = document.createElement("div");
    const host = document.createElement("div");

    container.className = "terminal-workspace";
    host.className = "terminal-host";
    container.append(toolbar, host);

    const actions = actionsFor(host);
    let disposeToolbar = () => {};
    let disposeStatus = () => {};

    const handle = Modal.open({
        title: "Terminal",
        subtitle: terminalSubtitle(target),
        size: "large",
        className: "terminal-modal",
        onClose: () => {
            disposeToolbar();
            disposeStatus();
            detach();
            state.terminalModal = null;
        }
    });

    state.terminalModal = handle;
    handle.setBody(container);

    const titleSlot = handle.element.querySelector(".modal-head .modal-title");
    if (titleSlot) {
        const statusHost = document.createElement("div");
        statusHost.className = "terminal-head-status";
        titleSlot.append(statusHost);
        disposeStatus = mount(statusHost, () => TerminalStatus({ terminal: state.terminal }), ["terminal"]);
    }

    disposeToolbar = mount(toolbar, () => TerminalToolbar({ terminal: state.terminal, actions }), ["terminal"]);

    if (!(await refreshSessions()) || state.terminalModal !== handle) return handle;

    const live = target.sessions.find(session => session.id === target.activeId && !session.exited) ||
        target.sessions.find(session => !session.exited);

    if (live) await actions.activate(live.id);
    else await actions.create();

    return handle;
}


export const terminalInternals = { actionsFor, detach, refreshSessions, current: () => screen };
