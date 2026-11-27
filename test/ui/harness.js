"use strict";

/*
|--------------------------------------------------------------------------
| Browser harness for the console tests
|--------------------------------------------------------------------------
|
| The console used to be tested against a hand-written DOM shim. That shim
| implemented only what the imperative renderer touched, so it could not
| run a real renderer (Preact needs text nodes, attributes, comment nodes,
| event bubbling) and it silently disagreed with browsers in places
| (selectors without a dot, children as an Array, no parser for
| index.html).
|
| This harness gives every test a happy-dom window loaded with the real
| index.html, minus its scripts, and installs the browser globals the
| console reads. Network and the event stream stay stubbed, exactly as
| before: fetch records every request and EventSource hands the test a
| synchronous `send`.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");
const { Window } = require("happy-dom");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "web", "public");


/*
| Only the <body> matters to the console, and the scripts are loaded by
| the test itself so it controls their order and their globals.
*/

function pageBody() {

    const html =
        fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

    const match =
        html.match(/<body[^>]*>([\s\S]*)<\/body>/i);

    return (match ? match[1] : html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}


/*
| Tests describe events as `el.dispatch(type, init)`. This turns that into
| a real event of the right class, so listeners see what a browser would
| send. When `init.target` names a descendant, the event is dispatched on
| that node and bubbles up — the browser's way of delivering, say, a
| mousedown on a dialog to the backdrop's listener.
*/

function installDispatch(window) {

    const keyTypes = new Set(["keydown", "keyup", "keypress"]);
    const mouseTypes = new Set(["click", "mousedown", "mouseup", "dblclick"]);

    /*
    | happy-dom builds per-window subclasses, so window.EventTarget is not
    | necessarily the prototype its nodes inherit from. The method goes on
    | whichever prototype actually owns dispatchEvent for the document,
    | and on the window's own chain.
    */
    const owners = new Set();

    for (const start of [window.document, window.document.createElement("div"), window]) {

        let proto = Object.getPrototypeOf(start);

        while (proto && !Object.prototype.hasOwnProperty.call(proto, "dispatchEvent")) {
            proto = Object.getPrototypeOf(proto);
        }

        if (proto) owners.add(proto);
    }

    for (const owner of owners) Object.defineProperty(owner, "dispatch", {
        configurable: true,
        value(type, init = {}) {

            const { target, ...rest } = init;

            const Ctor =
                keyTypes.has(type)
                    ? window.KeyboardEvent
                    : mouseTypes.has(type)
                        ? window.MouseEvent
                        : window.Event;

            const event =
                new Ctor(type, { bubbles: true, cancelable: true, ...rest });

            for (const [key, value] of Object.entries(rest)) {

                if (!(key in event)) {
                    Object.defineProperty(event, key, { value });
                }
            }

            const node =
                target && target !== this && typeof target.dispatchEvent === "function"
                    ? target
                    : this;

            return node.dispatchEvent(event);
        }
    });
}


function createWindow() {

    const window = new Window({
        url: "http://localhost/",
        width: 1280,
        height: 900,
        settings: {
            disableJavaScriptEvaluation: true,
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            disableComputedStyleRendering: true
        }
    });

    installDispatch(window);

    /* tests resize the viewport by assignment, as a browser would on rotate */
    Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 1280
    });

    return window;
}


/*
| The page globals. Location and history are plain objects: happy-dom
| navigates on a pathname assignment, and a test that sets a deep link
| wants the console to read it, not to reload the page.
*/

function installGlobals(window, { withPage = true } = {}) {

    if (withPage) {
        window.document.body.innerHTML = pageBody();
    }

    const location = {
        pathname: "/",
        search: "",
        hash: "",
        href: "http://localhost/"
    };

    const history = {
        pushState(state, title, url) {
            const parsed = new URL(String(url || "/"), "http://localhost");
            location.pathname = parsed.pathname;
            location.search = parsed.search;
        },
        replaceState(state, title, url) {
            this.pushState(state, title, url);
        }
    };

    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        Node: window.Node,
        Element: window.Element,
        HTMLElement: window.HTMLElement,
        Event: window.Event,
        KeyboardEvent: window.KeyboardEvent,
        MouseEvent: window.MouseEvent,
        CustomEvent: window.CustomEvent,
        FormData: window.FormData,
        File: window.File,
        Blob: window.Blob,
        DocumentFragment: window.DocumentFragment,
        getComputedStyle: window.getComputedStyle.bind(window),
        matchMedia: window.matchMedia.bind(window),
        requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0),
        cancelAnimationFrame: id => clearTimeout(id),
        location,
        history
    };

    for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(global, key, {
            configurable: true,
            writable: true,
            value
        });
    }

    return { location, history };
}


/*
| A Storage that a test can also read as a plain object, which is how the
| suite asserts what the console remembered.
*/

function createStorage() {

    const store = {};

    const storage = {
        getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: key => { delete store[key]; },
        clear: () => { for (const key of Object.keys(store)) delete store[key]; }
    };

    return { store, storage };
}


/*
| fetch: records every request and answers from a reply table, falling
| back to the defaults the console needs to boot.
*/

function createFetch(defaults) {

    const posted = [];
    const replies = new Map();

    const fetch = async (url, options = {}) => {

        let body = null;

        if (options.body && typeof options.body === "string") {
            body = JSON.parse(options.body);
        } else if (options.body) {
            body = options.body;
        }

        posted.push({ url, method: options.method || "GET", body });

        /* "POST /api/x" answers one method; "/api/x" answers any */
        const method = (options.method || "GET").toUpperCase();
        const reply =
            replies.has(`${method} ${url}`)
                ? replies.get(`${method} ${url}`)
                : replies.has(url)
                    ? replies.get(url)
                    : defaults(url);

        if (reply && reply.__status) {

            return {
                ok: reply.__status >= 200 && reply.__status < 300,
                status: reply.__status,
                json: async () => reply.body || {}
            };
        }

        if (reply instanceof Error) {
            throw reply;
        }

        return {
            ok: true,
            status: 200,
            json: async () => reply
        };
    };

    return { fetch, posted, replies };
}


/*
| EventSource: the newest stream is the one the test drives. Messages are
| delivered synchronously, the same way the shim did, so a test can assert
| on the DOM right after `send`.
*/

function createEventSource() {

    const box = { stream: null, url: "/api/events", opened: [] };

    class EventSource {

        constructor(url) {
            box.url = url || "/api/events";
            box.stream = this;
            box.opened.push(this);
            this.readyState = 1;
            this.closed = false;
        }

        close() {
            this.closed = true;
            this.readyState = 2;
        }
    }

    return { EventSource, box };
}


/*
| Boots the console the way the browser does: modal.js is a global, then
| auth-gate's import of app/main.js. ESM modules are cached per process,
| so each test file boots the console once and shares it.
*/

async function bootConsole({ Modal, defaults }) {

    const { pathToFileURL } = require("url");

    /* index.html ships the dashboard hidden; the console relies on it */
    document.getElementById("projectDashboard").hidden = true;

    const { store, storage } = createStorage();

    /* a returning operator: the starter templates were seeded on an earlier
       visit, so the scenarios start from an empty template list (seeding
       itself is tested in settings-and-modals.js) */
    store["structured-ai.taskTemplates.samplesSeeded"] = "1";

    global.localStorage = storage;

    window.innerWidth = 1280;

    const { fetch, posted, replies } = createFetch(defaults);

    global.fetch = fetch;
    global.Modal = Modal;

    const { EventSource, box } = createEventSource();

    global.EventSource = EventSource;

    await import(pathToFileURL(path.join(PUBLIC_DIR, "app", "main.js")).href);

    const deliver = event => box.stream.onmessage({ data: JSON.stringify(event) });

    return {
        posted,
        storage: store,
        streams: box.opened,
        sourceUrl: () => box.url,
        reply: (url, payload) => replies.set(url, payload),
        send: deliver,
        snapshot: value => deliver({ type: "snapshot", snapshot: value })
    };
}


/*
| Execution and Events have no page copy: they are drawn only inside their
| modal. Reading one opens its modal when it is not open and leaves it
| open, so a test can watch it update; closePanels() ends that.
*/
function panels(document) {

    const dialog = kind => {
        const selector = `.modal.${kind}-modal`;
        if (!document.querySelector(selector)) {
            document.getElementById(`${kind}Button`).dispatch("click");
        }
        return document.querySelector(selector);
    };

    return {
        tree: () => dialog("execution").querySelector(".tree"),
        archive: () => dialog("execution").querySelector(".execution-archive"),
        execSummary: () => dialog("execution").querySelector(".modal-subtitle"),
        log: () => dialog("events").querySelector("ul.log"),
        filter: () => dialog("events").querySelector(".log-filter"),
        type: () => dialog("events").querySelector(".log-type"),
        count: () => dialog("events").querySelector(".log-count"),
        clear: () => dialog("events").querySelector(".log-clear"),
        close() {
            for (const open of document.querySelectorAll(".modal.execution-modal, .modal.events-modal")) {
                open.querySelector(".modal-close").dispatch("click");
            }
        }
    };
}


module.exports = {
    bootConsole,
    panels,
    PUBLIC_DIR,
    pageBody,
    createWindow,
    installGlobals,
    createStorage,
    createFetch,
    createEventSource
};
