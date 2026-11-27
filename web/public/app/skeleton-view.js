/*
|--------------------------------------------------------------------------
| Skeleton loading primitives
|--------------------------------------------------------------------------
|
| Lightweight, compositor-only placeholders for async panels and modals.
| Keeps an accessible .sr-only label so screen readers and tests see
| meaningful status text immediately while data loads.
*/

import { html } from "./dom.js";


const LINE_WIDTHS = ["w-90", "w-75", "w-85", "w-60", "w-70", "w-50"];


export function SkeletonLines({ rows = 4, compact = false, label = "Loading…" }) {

    const items = Array.from({ length: rows }, (_, index) => LINE_WIDTHS[index % LINE_WIDTHS.length]);

    return html`<div class=${`skeleton-wrap${compact ? " compact" : ""}`} role="status" aria-busy="true">
        ${label ? html`<span class="sr-only">${label}</span>` : null}
        ${items.map((width, index) => html`<div key=${index} class=${`skeleton-line ${width}`}></div>`)}
    </div>`;
}


export function SkeletonRows({ count = 5, compact = false, label = "Loading…" }) {

    const items = Array.from({ length: count }, (_, index) => index);

    return html`<div class=${`skeleton-list${compact ? " compact" : ""}`} role="status" aria-busy="true">
        ${label ? html`<span class="sr-only">${label}</span>` : null}
        ${items.map(index => html`<div key=${index} class="skeleton-row">
            <div class=${`skeleton-line ${LINE_WIDTHS[index % LINE_WIDTHS.length]}`}></div>
            <div class="skeleton-line short w-45"></div>
        </div>`)}
    </div>`;
}


export function SkeletonCards({ count = 4, label = "Loading…" }) {

    const items = Array.from({ length: count }, (_, index) => index);

    return html`<div class="skeleton-grid" role="status" aria-busy="true">
        ${label ? html`<span class="sr-only">${label}</span>` : null}
        ${items.map(index => html`<div key=${index} class="skeleton-card">
            <div class="skeleton-line short w-45"></div>
            <div class="skeleton-line tall w-75"></div>
            <div class="skeleton-line short w-90"></div>
        </div>`)}
    </div>`;
}


export function SkeletonTerminal({ label = "Connecting terminal…" }) {

    return html`<div class="skeleton-terminal" role="status" aria-busy="true">
        ${label ? html`<span class="sr-only">${label}</span>` : null}
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-85"></div>
        <div class="skeleton-line w-45"></div>
    </div>`;
}
