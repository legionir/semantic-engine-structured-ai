/*
|--------------------------------------------------------------------------
| Phone tab bar
|--------------------------------------------------------------------------
|
| Under 640px (styles/mobile-tabs.css) the page keeps one bar at the
| bottom: Chat · History · Files · Projects · More.
|
|   Chat       back to the conversation: closes the dialogs that can be
|              dismissed, the More sheet and the project dashboard
|   History,   the same dialogs as the header buttons they stand for
|   Files,
|   Projects
|   More       the header menu, as a sheet above the bar, with the
|              project bar's controls (it is hidden on phones) on top
|
| More carries a badge: the number of approvals waiting, or a dot when the
| log has new errors. From 640px up the bar is not shown and the header
| menu and the project bar are back; this module then has nothing to do.
*/

import { el } from "./console-core.js";


const TAB_TARGETS = { history: "historyButton", files: "filesButton", projects: "projectsButton" };


function header() {

    return el("consoleHeader");
}


export function isMoreOpen() {

    return Boolean(header()?.classList.contains("menu-open"));
}


export function setMoreOpen(open) {

    const bar = header();
    if (!bar) return;

    bar.classList.toggle("menu-open", open);
    el("mobileMenuToggle")?.setAttribute("aria-expanded", String(open));
    syncTabs();
}


/* the project the sheet names: the project bar's label and path */
function fillSheetProject() {

    const name = el("mobileSheetProjectName");
    const path = el("mobileSheetWorkspace");

    if (name) name.textContent = el("activeProjectName")?.textContent?.trim() || "";
    if (path) path.textContent = el("workspace")?.textContent?.trim() || "";
}


export function syncTabs() {

    const more = isMoreOpen();

    if (more) fillSheetProject();

    el("tabMore")?.setAttribute("aria-expanded", String(more));

    const chat = el("tabChat");
    if (!chat) return;

    if (more) chat.removeAttribute("aria-current");
    else chat.setAttribute("aria-current", "page");
}


/* approvals waiting (a number) beat new log errors (a dot) */
export function syncMoreBadge() {

    const badge = el("tabMoreBadge");
    if (!badge) return;

    const approvals = el("approvalsButton");
    const count = approvals && !approvals.hidden ? Number(el("approvalsCount")?.textContent || 0) : 0;
    const logs = el("logsBadge");
    const logErrors = Boolean(logs && !logs.hidden);

    badge.classList.toggle("dot", count === 0 && logErrors);
    badge.textContent = count > 0 ? String(count) : "";
    badge.hidden = count === 0 && !logErrors;

    el("tabMore")?.setAttribute("aria-label", count > 0 ? `More, ${count} approval${count === 1 ? "" : "s"} waiting` : logErrors ? "More, new log errors" : "More");
}


export function showChat() {

    setMoreOpen(false);

    /* an approval cannot be dismissed (Modal.closeTop returns false): it stays */
    const modal = globalThis.Modal;
    for (let guard = 0; modal && modal.openCount > 0 && guard < 20; guard++) {
        if (!modal.closeTop("tab")) break;
    }

    const dashboard = el("projectDashboard");
    if (dashboard && !dashboard.hidden) el("dashboardBack")?.click();

    const chat = el("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
}


function selectTab(tab) {

    if (tab === "chat") {
        showChat();
        return;
    }

    if (tab === "more") {
        setMoreOpen(!isMoreOpen());
        return;
    }

    setMoreOpen(false);
    el(TAB_TARGETS[tab])?.click();
}


export function initMobileTabs() {

    const bar = el("mobileTabs");
    if (!bar) return;

    bar.addEventListener("click", event => {
        const tab = event.target.closest("[data-tab]");
        if (tab) selectTab(tab.dataset.tab);
    });

    el("sheetNewConversation")?.addEventListener("click", () => el("clearButton")?.click());
    el("sheetNewProject")?.addEventListener("click", () => el("newProjectButton")?.click());

    /* the header menu closes itself (a choice, Escape, a click outside):
       the tabs follow its class, and the badge follows its counters */
    if (typeof MutationObserver === "function") {
        const bar = header();
        if (bar) new MutationObserver(syncTabs).observe(bar, { attributes: true, attributeFilter: ["class"] });

        const watched = [el("approvalsButton"), el("approvalsCount"), el("logsBadge")].filter(Boolean);
        const observer = new MutationObserver(syncMoreBadge);
        for (const node of watched) observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
    }

    syncTabs();
    syncMoreBadge();
}


export const mobileTabsActions = { selectTab, fillSheetProject };
