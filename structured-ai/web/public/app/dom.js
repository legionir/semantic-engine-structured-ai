/*
|--------------------------------------------------------------------------
| Console dom (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| DOM primitives: the id lookup every view starts from, element building, and
| the Modal service the three interrupting panels share.
|
| `Modal` is read off globalThis on purpose. modal.js is a classic script, and a
| top-level `const` in one is a *lexical* global: invisible to a module. That
| script now also assigns `globalThis.Modal`, which is the single line the
| module-format decision cost (measured, recorded in گام ۱) — no bundler, no
| rewrite of the modal service, and its CJS export tail still lets the tests
| require it.
|--------------------------------------------------------------------------
*/

/*
| modal.js is a classic script, and a top-level `const` there is a *lexical*
| global: an ES module cannot see it. The service therefore also assigns
| globalThis.Modal, and the one read of that global lives here so that no view
| module has to trust a window property of its own.
*/

const Modal = globalThis.Modal;

export { Modal };

/*
| The console keeps no state of its own beyond what the runtime reports:
| every box on screen is rebuilt from the event stream, so a reload
| reproduces the same picture from the snapshot.
|
| Three things are deliberately modal rather than inline, because they
| interrupt: settings, an approval request, and the full detail of one
| executed call. They share the Modal service in modal.js.
*/

export const el = id => document.getElementById(id);

export const escape = Modal.escape;

export function node(tag, className, text) {

    const element =
        document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined && text !== null) {
        element.textContent = text;
    }

    return element;
}

export function definition(list, label, value) {

    if (value === undefined || value === null || value === "") {
        return;
    }

    list.append(
        node("dt", null, label),
        node("dd", null, String(value))
    );
}
