"use strict";

/*
| ui.test.js: the phone tab bar (web/public/app/mobile-tabs.js)
|
| Chat · History · Files · Projects · More, under 640px only. The tabs
| open the same dialogs as the header buttons they stand for, More opens
| the header menu as a sheet with the project bar's controls, and its
| badge counts waiting approvals (or shows a dot for new log errors).
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const harness = require("../harness");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const byId = id => document.getElementById(id);


module.exports = async function mobileTabsCases({ test, backdrops }) {

    const header = () => byId("consoleHeader");
    const tab = name => document.querySelector(`#mobileTabs [data-tab="${name}"]`);
    const closeAll = () => {
        for (let i = 0; i < 10 && globalThis.Modal.openCount > 0; i++) globalThis.Modal.closeTop("test");
    };

    await test("the tab bar is Chat, History, Files, Projects, More, and only phones see it", async () => {

        const tabs = [...byId("mobileTabs").querySelectorAll("[data-tab]")];
        assert.deepEqual(tabs.map(item => item.textContent.trim()), ["Chat", "History", "Files", "Projects", "More"]);
        assert.equal(byId("tabChat").getAttribute("aria-current"), "page");
        assert.equal(byId("tabMore").getAttribute("aria-controls"), "consoleMenu");

        const html = fs.readFileSync(path.join(harness.PUBLIC_DIR, "index.html"), "utf8");
        assert.match(html, /href="\/styles\/mobile-tabs\.css"/);

        /* every rule that shows the bar or moves the menu is inside the phone query */
        const css = fs.readFileSync(path.join(harness.PUBLIC_DIR, "styles", "mobile-tabs.css"), "utf8");
        const [outside, inside = ""] = css.split("@media (max-width: 639.98px)");
        assert.match(outside, /\.mobile-tabs,\s*\.mobile-sheet-project \{ display: none; \}/);
        assert.doesNotMatch(outside.replace(/\/\*[\s\S]*?\*\//g, ""), /\.project-bar|\.meta|\.mobile-menu-toggle/);
        assert.match(inside, /\.project-bar \{ display: none; \}/);
        assert.match(inside, /\.mobile-menu-toggle \{ display: none; \}/);
    });

    await test("History, Files and Projects open their dialogs; Chat closes them", async () => {

        for (const name of ["history", "files", "projects"]) {
            closeAll();
            tab(name).dispatch("click");
            await sleep(20);
            assert.ok(backdrops().length > 0, `${name} opened a dialog`);

            tab("chat").dispatch("click");
            await sleep(10);
            assert.equal(backdrops().length, 0, `Chat closed the ${name} dialog`);
            assert.equal(byId("tabChat").getAttribute("aria-current"), "page");
        }
    });

    await test("More opens the menu as a sheet with the project's controls, and closes again", async () => {

        closeAll();
        tab("more").dispatch("click");
        await sleep(5);

        assert.ok(header().classList.contains("menu-open"), "the header menu is open");
        assert.equal(byId("tabMore").getAttribute("aria-expanded"), "true");
        assert.equal(byId("tabChat").getAttribute("aria-current"), null);
        assert.equal(byId("mobileSheetProjectName").textContent, byId("activeProjectName").textContent.trim());

        /* the document's click-outside handler does not undo the tab's own click */
        assert.ok(header().classList.contains("menu-open"));

        tab("more").dispatch("click");
        await sleep(5);
        assert.equal(header().classList.contains("menu-open"), false, "More toggles the sheet");
        assert.equal(byId("tabMore").getAttribute("aria-expanded"), "false");
        assert.equal(byId("tabChat").getAttribute("aria-current"), "page");

        /* choosing an item closes the sheet (the menu's own handler) */
        tab("more").dispatch("click");
        await sleep(5);
        byId("skillsButton").dispatch("click");
        await sleep(5);
        assert.equal(header().classList.contains("menu-open"), false);
        assert.equal(byId("tabMore").getAttribute("aria-expanded"), "false");
        closeAll();

        /* a click elsewhere closes it too */
        tab("more").dispatch("click");
        await sleep(5);
        byId("chat").dispatch("click");
        await sleep(5);
        assert.equal(header().classList.contains("menu-open"), false);
    });

    await test("the sheet's New conversation and New project act like the project bar's buttons", async () => {

        const clicked = [];
        const spy = id => {
            const listener = () => clicked.push(id);
            byId(id).addEventListener("click", listener);
            return () => byId(id).removeEventListener("click", listener);
        };
        const undo = [spy("clearButton"), spy("newProjectButton")];

        try {
            tab("more").dispatch("click");
            byId("sheetNewProject").dispatch("click");
            await sleep(10);
            assert.deepEqual(clicked, ["newProjectButton"]);
            assert.equal(header().classList.contains("menu-open"), false);
            closeAll();

            byId("sheetNewConversation").dispatch("click");
            await sleep(10);
            assert.deepEqual(clicked, ["newProjectButton", "clearButton"]);
        } finally {
            undo.forEach(fn => fn());
            closeAll();
        }
    });

    await test("More counts waiting approvals, or shows a dot for new log errors", async () => {

        const badge = byId("tabMoreBadge");
        const approvals = byId("approvalsButton");
        const logs = byId("logsBadge");
        const before = { approvals: approvals.hidden, count: byId("approvalsCount").textContent, logs: logs.hidden };

        try {
            approvals.hidden = true;
            logs.hidden = true;
            await sleep(5);
            assert.equal(badge.hidden, true);

            logs.hidden = false;
            await sleep(5);
            assert.equal(badge.hidden, false);
            assert.ok(badge.classList.contains("dot"));
            assert.equal(byId("tabMore").getAttribute("aria-label"), "More, new log errors");

            byId("approvalsCount").textContent = "2";
            approvals.hidden = false;
            await sleep(5);
            assert.equal(badge.textContent, "2");
            assert.equal(badge.classList.contains("dot"), false);
            assert.equal(byId("tabMore").getAttribute("aria-label"), "More, 2 approvals waiting");
        } finally {
            approvals.hidden = before.approvals;
            byId("approvalsCount").textContent = before.count;
            logs.hidden = before.logs;
            await sleep(5);
        }
    });
};
