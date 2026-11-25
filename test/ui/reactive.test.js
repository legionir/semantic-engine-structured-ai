"use strict";

/*
|--------------------------------------------------------------------------
| Reactive console: invariants and regressions
|--------------------------------------------------------------------------
|
| The console renders from a store through Preact views. These tests pin
| what that rewrite promised: views never build HTML from strings, the
| vendored renderer is the one the manifest names, redraws keep what the
| operator did (folded cards, scroll, a dismissed modal), a replayed
| snapshot neither re-triggers side effects nor costs a redraw per event,
| and every action that can fail says so.
|--------------------------------------------------------------------------
*/

const path = require("path");
const harness = require("./harness");


const results = [];

async function test(name, fn) {
    try {
        try {
            await fn();
        } finally {
            card.close();
        }
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
        if (process.env.UI_TRACE) console.log(error.stack);
    }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

const browser = harness.createWindow();
harness.installGlobals(browser);

const Modal = require(path.join(harness.PUBLIC_DIR, "modal.js"));

const byId = id => document.getElementById(id);
const card = harness.panels(document);
const backdrops = () =>
    [...document.body.children].filter(child => child.classList.contains("modal-backdrop"));

const errorBubbles = () =>
    [...byId("chat").querySelectorAll(".bubble")].filter(bubble => bubble.className.includes("error"));


async function staticChecks() {

    console.log("static invariants");

    await require("./scenarios/static-invariants")({ test });

    console.log("\nsafe markdown");

    await require("./scenarios/markdown")({ test });

    console.log("\nlogin gate");

    await require("./scenarios/auth-gate")({ test });
}


async function behaviour() {

    console.log("\nreactive behaviour");

    const console_ = await harness.bootConsole({
        Modal,
        defaults: url =>
            url === "/api/settings" ? { settings: [] }
                : url === "/api/state" ? { turns: 1 }
                    : url === "/api/sessions" ? { current: "s-1", sessions: [] }
                        : url === "/api/projects" ? { projects: [] }
                            : {}
    });

    await settle();

    const requests = pattern => console_.posted.filter(item => pattern.test(item.url));

    await require("./scenarios/rendering")({ test, console_, settle, byId, card, requests });

    await require("./scenarios/failures")({ test, console_, settle, byId, card, backdrops, errorBubbles, Modal });
}


(async () => {
    await staticChecks();
    await behaviour();
    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
})();
