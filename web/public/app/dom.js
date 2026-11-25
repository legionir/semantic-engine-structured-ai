/*
|--------------------------------------------------------------------------
| Rendering infrastructure
|--------------------------------------------------------------------------
|
| The console has no build step, so components are written with htm tagged
| templates over Preact's h(). Text interpolated into a template is always
| a text node: nothing here parses markup, and no view may assign
| innerHTML (test/ui/reactive.test.js enforces that).
|
| State lives in plain objects owned by store.js. A view does not subscribe
| to individual fields; it names the store regions it draws from, and
| mount() re-renders it — synchronously, inside the signal effect — when
| any of those regions is touched. Preact's diff then keeps every DOM node
| that did not change, which is what preserves focus, selection, scroll
| position and the open/closed state of <details> across updates.
|--------------------------------------------------------------------------
*/

import { h, render, Fragment } from "../vendor/preact.module.js";
import htm from "../vendor/htm.module.js";
import { effect, untracked } from "../vendor/signals-core.module.js";
import { watch } from "./store.js";

export { h, render, Fragment, effect, untracked };

export const html = htm.bind(h);

export const byId = id => document.getElementById(id);


/*
| A view that throws must not take the event stream down with it: the
| error is reported and every other region keeps rendering.
*/

function guarded(fn) {

    try {
        fn();
    } catch (error) {
        if (typeof console !== "undefined") console.error("[console] render failed:", error);
    }
}


/*
| Renders `View(props)` into `container` now and again whenever one of the
| named regions changes. Returns a disposer that stops the updates and
| unmounts the tree. A missing container is not an error: the console
| must keep handling events even if a page variant leaves a panel out.
*/

export function mount(container, View, regions = [], props = {}, hooks = {}) {

    if (!container) {
        return () => {};
    }

    const stop = effect(() => {

        for (const name of regions) {
            watch(name);
        }

        untracked(() => guarded(() => {
            const memo = hooks.before ? hooks.before(container) : undefined;
            render(h(View, props), container);
            if (hooks.after) hooks.after(container, memo);
        }));
    });

    return () => {
        stop();
        render(null, container);
    };
}


/*
| Keeps a static element of index.html (a status dot, a counter, a button
| label) in step with the store: `apply` runs now and whenever one of the
| regions changes. For elements whose children the store decides, use
| mount() instead.
*/

export function bind(regions, apply) {

    return effect(() => {

        for (const name of regions) {
            watch(name);
        }

        untracked(() => guarded(apply));
    });
}


/*
| A list that follows its newest entry only while the reader is already
| at the bottom: someone scrolled up to read is not yanked back down.
*/

export const stickToBottom = {

    before(container) {
        const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
        return !(gap > 48);
    },

    after(container, atBottom) {
        if (atBottom) container.scrollTop = container.scrollHeight;
    }
};


/* stickToBottom for a scroller inside the mounted view */
export function stickInside(selector) {

    return {
        before: container => {
            const target = container.querySelector(selector);
            return target ? stickToBottom.before(target) : true;
        },
        after: (container, atBottom) => {
            const target = container.querySelector(selector);
            if (target) stickToBottom.after(target, atBottom);
        }
    };
}


/*
| A modal body is a detached element the Modal service places in the
| dialog; `className` makes it the view's root (".detail", ".settings"…)
| so the dialog keeps the structure it always had. The caller disposes
| the returned function from the modal's onClose, so a closed modal never
| keeps re-rendering in the background.
*/

export function mountInModal(handle, View, regions = [], props = {}, className = "", hooks = {}) {

    const container = document.createElement("div");

    if (className) container.className = className;

    const dispose = mount(container, View, regions, { ...props, handle }, hooks);

    handle.setBody(container);

    return dispose;
}


/*
| Classic DOM helper for the few places that still hand a finished node to
| the Modal service (footers). Text goes through textContent only.
*/

export function create(tag, className, text) {

    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;

    return element;
}


export function clear(element) {

    if (element) element.replaceChildren();

    return element;
}
