/*
|--------------------------------------------------------------------------
| Terminal view
|--------------------------------------------------------------------------
|
| The chrome around the system terminal: one tab per open shell, a button
| for a new one, a close button per tab and a status line (PTY mode,
| shell, working directory). The terminal itself is an xterm.js instance
| on a host element the controller owns outside this tree, so a redraw of
| the tabs never touches the screen.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";
import { SkeletonTerminal } from "./skeleton-view.js";


export function createTerminalState() {

    return {
        info: null,
        loading: false,
        sessions: [],
        activeId: null,
        error: null,
        busy: false,
        connection: "idle"
    };
}


export function terminalSubtitle(terminal) {

    if (!terminal.info && terminal.loading) return "Connecting…";

    return "";
}


function modeLabel(mode) {

    if (mode === "pty") return "PTY";
    if (mode === "script") return "PTY via script(1)";
    return "pipes (no PTY: full-screen programs will not work)";
}


export function TerminalStatus({ terminal }) {

    const info = terminal.info;
    const active = terminal.sessions.find(session => session.id === terminal.activeId) || null;

    if (!info) return null;

    return html`<div class="terminal-status muted">
        <span class="terminal-mode">${modeLabel(info.mode)}</span>
        ${active ? html`<span class="terminal-pid">${`pid ${active.pid ?? "?"}`}</span>` : null}
        <span class="terminal-cwd">${info.cwd}</span>
        <span class=${`terminal-connection ${terminal.connection}`}>${terminal.connection}</span>
    </div>`;
}


function tabLabel(session, index) {

    const name = String(session.shell || "shell").split(/[\\/]/).pop();

    return `${index + 1}: ${name}${session.exited ? " (exited)" : ""}`;
}


export function TerminalToolbar({ terminal, actions }) {

    const info = terminal.info;
    const atLimit = info && terminal.sessions.filter(session => !session.exited).length >= info.max_sessions;

    return html`<div class="terminal-toolbar">
        <div class="terminal-tabs" role="tablist" aria-label="Open terminals">
            ${terminal.sessions.map((session, index) => html`<div
                key=${session.id}
                class=${`terminal-tab${session.id === terminal.activeId ? " active" : ""}${session.exited ? " exited" : ""}`}
            >
                <button
                    type="button"
                    role="tab"
                    class="terminal-tab-select"
                    aria-selected=${session.id === terminal.activeId}
                    onClick=${() => actions.activate(session.id)}
                >${tabLabel(session, index)}</button>
                <button
                    type="button"
                    class="terminal-tab-close"
                    aria-label=${`Close terminal ${index + 1}`}
                    title="Close (ends the shell)"
                    onClick=${() => actions.kill(session.id)}
                >✕</button>
            </div>`)}
            <button
                type="button"
                class="terminal-new"
                disabled=${terminal.busy || atLimit || !info}
                title=${atLimit ? "The maximum number of terminals is open" : "Open a new terminal"}
                onClick=${() => actions.create()}
            >+ New terminal</button>
        </div>
        ${terminal.error ? html`<p class="terminal-error" role="alert">${terminal.error}</p>` : null}
        ${terminal.loading && !info ? html`<${SkeletonTerminal} label="Connecting terminal…" />` : null}
        ${info && terminal.sessions.length === 0 && !terminal.busy
            ? html`<p class="empty">No terminal is open. Use “New terminal” to start a shell.</p>`
            : null}
    </div>`;
}
