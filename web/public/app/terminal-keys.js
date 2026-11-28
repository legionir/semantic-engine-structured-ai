/*
|--------------------------------------------------------------------------
| Terminal keys
|--------------------------------------------------------------------------
|
| The keys a phone keyboard does not have — Esc, Tab, Ctrl, arrows, ^C… —
| as a row of buttons under the screen. A button never takes the focus
| (the on-screen keyboard stays where it is), so a key is sent straight
| to the shell. Ctrl and Alt are sticky: tap one, then a key on the
| keyboard, and that key arrives modified (Ctrl then C is ^C).
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";


/* label, title and what reaches the shell; `cursor` keys follow the mode vim and less switch on */
export const TERMINAL_KEYS = Object.freeze([
    { id: "esc", label: "Esc", title: "Escape", data: "\x1b" },
    { id: "tab", label: "Tab", title: "Tab (completion)", data: "\t" },
    { id: "ctrl", label: "Ctrl", title: "Ctrl: the next key is sent with Ctrl", modifier: "ctrl" },
    { id: "alt", label: "Alt", title: "Alt: the next key is sent with Alt", modifier: "alt" },
    { id: "ctrl-c", label: "^C", title: "Ctrl+C: interrupt the running command", data: "\x03" },
    { id: "ctrl-d", label: "^D", title: "Ctrl+D: end of input / exit", data: "\x04" },
    { id: "ctrl-z", label: "^Z", title: "Ctrl+Z: suspend", data: "\x1a" },
    { id: "ctrl-l", label: "^L", title: "Ctrl+L: clear the screen", data: "\x0c" },
    { id: "left", label: "←", title: "Left", cursor: "D" },
    { id: "up", label: "↑", title: "Up (previous command)", cursor: "A" },
    { id: "down", label: "↓", title: "Down (next command)", cursor: "B" },
    { id: "right", label: "→", title: "Right", cursor: "C" },
    { id: "home", label: "Home", title: "Home", cursor: "H" },
    { id: "end", label: "End", title: "End", cursor: "F" },
    { id: "pgup", label: "PgUp", title: "Page up", data: "\x1b[5~" },
    { id: "pgdn", label: "PgDn", title: "Page down", data: "\x1b[6~" }
]);


export function createModifiers() {
    return { ctrl: false, alt: false };
}


/* the bytes a key sends: arrows are ESC O x in application cursor mode, ESC [ x otherwise */
export function keySequence(key, { applicationCursor = false } = {}) {

    if (key.cursor) return `\x1b${applicationCursor ? "O" : "["}${key.cursor}`;

    return key.data || "";
}


/*
| Typed input with the sticky modifiers applied: Ctrl turns a letter (and
| @ [ \ ] ^ _ space ?) into its control character, Alt puts ESC before
| it. Returns null when nothing is armed, so the input goes through as is.
*/
export function applyModifiers(data, modifiers) {

    if (!modifiers || (!modifiers.ctrl && !modifiers.alt) || typeof data !== "string" || !data) return null;

    let text = data;

    if (modifiers.ctrl && [...text].length === 1) {
        const char = text.toUpperCase();
        const code = char.charCodeAt(0);
        if (char === "?") text = "\x7f";
        else if (char === " ") text = "\x00";
        else if (code >= 64 && code <= 95) text = String.fromCharCode(code & 0x1f);
    }

    return modifiers.alt ? `\x1b${text}` : text;
}


export function TerminalKeys({ terminal, actions }) {

    const modifiers = terminal.modifiers || createModifiers();
    const usable = Boolean(terminal.activeId) && terminal.connection === "connected";

    /* the focus stays in the terminal: a tap must not close the phone keyboard */
    const keepFocus = event => event.preventDefault();

    return html`<div class="terminal-keys" role="toolbar" aria-label="Terminal keys">
        ${TERMINAL_KEYS.map(key => html`<button
            key=${key.id}
            type="button"
            class=${`terminal-key${key.modifier ? " modifier" : ""}${key.modifier && modifiers[key.modifier] ? " armed" : ""}`}
            data-key=${key.id}
            title=${key.title}
            aria-label=${key.title}
            aria-pressed=${key.modifier ? Boolean(modifiers[key.modifier]) : undefined}
            disabled=${!usable}
            onPointerDown=${keepFocus}
            onMouseDown=${keepFocus}
            onClick=${() => (key.modifier ? actions.toggleModifier(key.modifier) : actions.sendKey(key))}
        >${key.label}</button>`)}
    </div>`;
}
