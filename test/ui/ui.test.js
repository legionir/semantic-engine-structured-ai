"use strict";

/*
| Console behaviour tests. They run against a happy-dom window loaded with
| the real index.html (see harness.js), so a selector, a nesting or an id
| that only works in a hand-written shim fails here the way it would fail
| in a browser.
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

        if (process.env.UI_TRACE) {
            console.log(error.stack);
        }
    }
}


const browser = harness.createWindow();

harness.installGlobals(browser);

const Modal =
    require(
        path.join(harness.PUBLIC_DIR, "modal.js")
    );


const card = harness.panels(document);


function backdrops() {

    return [...document.body.children].filter(
        child => child.classList.contains("modal-backdrop")
    );
}


async function main() {

    console.log("modal service");

    await require("./scenarios/modal-service")({ test, Modal, backdrops });

    console.log("\nconsole rendering");

    const console_ = await loadConsole();

    await require("./scenarios/execution-card")({ test, Modal, backdrops, card, console_ });

    await require("./scenarios/conversation")({ test, card, console_ });

    await require("./scenarios/settings-and-modals")({ test, Modal, backdrops, card, console_ });

    await require("./scenarios/events-log")({ test, Modal, backdrops, card, console_ });

    await require("./scenarios/projects")({ test, Modal, backdrops, card, console_ });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}


/*
| Loads the canonical console renderer into the page, with stubs for the
| network and the event stream.
*/

async function loadConsole() {

    const settings = [
        {
            key: "MAX_ITERATIONS",
            group: "budget",
            type: "number",
            value: 50,
            source: "default",
            description: "Iterations before the run stops."
        },
        {
            key: "AGENT_PROXY_URL",
            group: "endpoint",
            type: "string",
            value: "so…05",
            source: "environment",
            secret: true,
            description: "Optional outbound HTTP or SOCKS5 proxy."
        },
        {
            key: "ENDPOINT_MAIN_MODEL",
            group: "endpoint.main",
            type: "string",
            value: "main-model",
            source: "default",
            description: "Main model."
        },
        {
            key: "ENDPOINT_L1_MODEL",
            group: "endpoint.l1",
            type: "string",
            value: "layer-model",
            source: "default",
            description: "Layer model."
        }
    ];

    return harness.bootConsole({
        Modal,
        defaults: url =>
            url === "/api/settings"
                ? { settings }
                : url === "/api/state"
                    ? { turns: 1 }
                    : url === "/api/sessions"
                        ? { current: "s-1", sessions: [] }
                        : { call: { name: "fs_read", arguments: {}, result: {} } }
    });
}


main();
