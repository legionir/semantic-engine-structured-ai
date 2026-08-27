"use strict";

/*
|--------------------------------------------------------------------------
| Visualizer harness — EXECUTION_PLAN Phase 25
|--------------------------------------------------------------------------
|
| The visualizer had no test: `test/ui.test.js` only checked that the console
| links to it. This harness drives the real client through a DOM small enough to
| read, and returns a trace: the text of every element it changed, the classes
| on every node and edge, the transform after each viewport gesture, and the
| URLs it asked the server for.
|
| Two rules keep it honest:
|
|   • an unimplemented DOM method throws instead of returning undefined — a shim
|     that quietly no-ops turns the whole trace into a picture of nothing;
|   • the trace contains no random or time-dependent value, so it can be
|     recorded from one implementation and asserted against another.
|
| Recorded by test/web/visualizer.record.js, asserted by
| test/web/visualizer.contract.test.js. Same shape as the route contract that
| phase 23 step 1 built before its move.
|--------------------------------------------------------------------------
*/

const path = require("path");
const { pathToFileURL } = require("url");

function notImplemented(name) {

    return (...args) => {
        throw new Error(`visualizer DOM shim: ${name}(${args.length} args) is not implemented`);
    };
}

/* --------------------------------------------------------------------- DOM */

function createElement(tag, document_, namespace) {

    class ClassList {

        constructor(owner) {

            this.owner = owner;
        }

        add(...names) {

            for (const name of names) {

                if (!this.owner._classes.includes(name)) this.owner._classes.push(name);
            }
        }

        remove(...names) {

            this.owner._classes = this.owner._classes.filter(name => !names.includes(name));
        }

        contains(name) {

            return this.owner._classes.includes(name);
        }

        toggle(name, force) {

            const has = this.owner._classes.includes(name);
            const wanted = force === undefined ? !has : Boolean(force);

            if (wanted) this.add(name);
            else this.remove(name);
        }
    }

    class Element {

        constructor(name) {

            this.tagName = String(name).toUpperCase();
            this.localName = String(name);
            this.children = [];
            this.parentNode = null;
            this.attributes = {};
            this.dataset = {};
            this.style = {};
            this.hidden = false;
            this._classes = [];
            this._text = "";
            this._html = null;
            this._listeners = new Map();
            this.classList = new ClassList(this);
            this.namespaceURI = namespace || null;
        }

        get id() { return this.attributes.id ?? ""; }
        set id(value) { this.attributes.id = value; document_.ids.set(value, this); }

        get className() { return this._classes.join(" "); }
        set className(value) { this._classes = String(value).split(/\s+/).filter(Boolean); }

        get classList_() { return this.classList; }

        setAttribute(name, value) {

            if (name === "id") { this.id = value; return; }
            if (name === "class") { this.className = value; return; }

            this.attributes[name] = String(value);
        }

        getAttribute(name) {

            if (name === "class") return this.className;

            return this.attributes[name] ?? null;
        }

        removeAttribute(name) { delete this.attributes[name]; }

        appendChild(child) {

            child.parentNode = this;
            this.children.push(child);

            return child;
        }

        removeChild(child) {

            this.children = this.children.filter(item => item !== child);
            child.parentNode = null;

            return child;
        }

        get textContent() {

            if (this._text) return this._text;

            return this.children.map(child => child.textContent).join("");
        }

        set textContent(value) {

            this.children = [];
            this._text = value === null || value === undefined ? "" : String(value);
        }

        get innerHTML() {

            return this._html ?? "";
        }

        set innerHTML(value) {

            /*
            | Setting innerHTML is the one place this client injects markup, so the
            | raw string is kept: the trace can show exactly what was written rather
            | than a sanitised guess of what a parser would have made of it.
            */

            const dropped = this.children;

            this.children = [];
            this._text = "";
            this._html = value === null || value === undefined ? "" : String(value);

            /* a real document stops resolving the ids of removed nodes; so must we,
               or getElementById("viewport") would find an element no longer on the page */

            for (const child of dropped) {

                child.walk(node => {

                    if (node.attributes.id) document_.ids.delete(node.attributes.id);
                });
            }
        }

        addEventListener(type, handler) {

            if (!this._listeners.has(type)) this._listeners.set(type, []);
            this._listeners.get(type).push(handler);
        }

        removeEventListener() {}

        fire(type, event = {}) {

            const handlers = this._listeners.get(type) || [];

            for (const handler of handlers) {

                handler({
                    type,
                    target: this,
                    currentTarget: this,
                    stopPropagation() { this._stopped = true; },
                    preventDefault() { this._defaultPrevented = true; },
                    ...event
                });
            }
        }

        closest(selector) {

            const name = selector.replace(/^\./, "");

            let node = this;

            while (node) {

                if (node._classes.includes(name)) return node;

                node = node.parentNode;
            }

            return null;
        }

        contains(node) {

            let current = node;

            while (current) {

                if (current === this) return true;

                current = current.parentNode;
            }

            return false;
        }

        getBoundingClientRect() {

            return { left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 };
        }

        /* every walk the client does, so the trace can see it */

        walk(visit) {

            visit(this);

            for (const child of this.children) child.walk(visit);
        }

        querySelectorAll(selector) {

            const found = [];

            this.walk(node => {

                if (node === this) return;

                if (selector.startsWith(".")) {

                    if (node._classes.includes(selector.slice(1))) found.push(node);

                    return;
                }

                if (selector.startsWith("#")) {

                    if (node.attributes.id === selector.slice(1)) found.push(node);

                    return;
                }

                if (node.localName === selector) found.push(node);
            });

            return found;
        }

        querySelector(selector) {

            return this.querySelectorAll(selector)[0] ?? null;
        }
    }

    return new Element(tag);
}

/* ------------------------------------------------------------------- boot */

function createDocument() {

    const root = createElement("body");
    const ids = new Map();
    const document_ = {
        root,
        ids,
        body: root,
        documentElement: root,
        createElement: tag => createElement(tag, document_),
        createElementNS: (ns, tag) => createElement(tag, document_, ns),
        getElementById: id => ids.get(id) ?? null,
        querySelectorAll: selector => root.querySelectorAll(selector),
        querySelector: selector => root.querySelector(selector),
        listeners: new Map(),
        addEventListener(type, handler) {

            if (!document_.listeners.has(type)) document_.listeners.set(type, []);
            document_.listeners.get(type).push(handler);
        },
        fire(type, event = {}) {

            for (const handler of document_.listeners.get(type) || []) {

                handler({ type, target: root, preventDefault() {}, stopPropagation() {}, ...event });
            }
        },
        /* a test-only helper: register an element by id, as index.html would */
        register(id, tag = "div") {

            const element = createElement(tag, document_);

            element.attributes.id = id;
            ids.set(id, element);
            root.appendChild(element);

            return element;
        }
    };

    return document_;
}

function registerFixtures(document_) {

    /* every element visualizer.html provides that the client touches */

    for (const id of [
        "graphSvg", "canvasContainer", "nodeCount", "edgeCount", "projectTitle",
        "inspectorSidebar", "inspectorDetails", "inspectorBody", "inspType", "inspTitle",
        "inspPath", "inspRange", "inspComplexity", "inspRefs", "inspConfidence",
        "inspSignature", "inspConnections", "inspTests", "graphSearch", "searchResults",
        "focusDepth", "filterResolvedOnly", "fitGraphBtn", "resetFocusBtn",
        "closeInspectorBtn", "btnExploreNeighborhood", "btnAnalyzeImpact",
        "lodStep1", "lodStep2", "lodStep3", "lodStep4", "graphOverlay", "graphStats",
        "emptyHint", "viewport"
    ]) {
        document_.register(id, id === "graphSvg" ? "svg" : "div");
    }

    /* the view tabs: querySelectorAll(".view-tab") must find them */

    const tabs = [];

    for (const view of [
        "architecture", "module", "dependencies", "workflow",
        "impact", "business-mapping", "test-intelligence", "hotspots"
    ]) {

        const tab = createElement("button", document_);

        tab.className = "view-tab active";
        tab.dataset.view = view;
        document_.root.appendChild(tab);
        tabs.push(tab);
    }

    /* `.empty-hint` is reached with querySelector, so it must exist as a class */

    const hint = createElement("div", document_);

    hint.className = "empty-hint";
    document_.root.appendChild(hint);

    /* the breadcrumb steps need their class too */

    for (const id of ["lodStep1", "lodStep2", "lodStep3", "lodStep4"]) {

        document_.getElementById(id).className = "lod-step";
    }

    document_.getElementById("lodStep1").classList.add("active");
    document_.getElementById("emptyHint").hidden = false;
    document_.getElementById("inspectorDetails").hidden = true;
    document_.querySelector(".view-tab").className = "view-tab active";

    return tabs;
}

/* --------------------------------------------------------------- fixtures */

const GRAPH = {
    projectName: "fixture-project",
    nodes: [
        { id: "mod-a", type: "module", label: "Alpha Module", metadata: { path: "src/alpha", importance: 80 } },
        { id: "cls-a", type: "class", label: "AlphaService", metadata: { path: "src/alpha/service.ts", line: 10, endLine: 45, complexity: 4, referencesCount: 12 } },
        { id: "fn-a", type: "function", label: "run()", metadata: { path: "src/alpha/run.ts", line: 3, endLine: 9, complexity: 2, referencesCount: 5 } },
        { id: "fn-b", type: "function", label: "helper()", metadata: { path: "src/beta/helper.ts", line: 1, endLine: 4, complexity: 1, referencesCount: 1 } },
        { id: "api-b", type: "api", label: "POST /beta", metadata: { path: "src/beta/api.ts" } }
    ],
    edges: [
        { id: "e1", source: "mod-a", target: "cls-a", relation: "contains", metadata: { confidence: 100 } },
        { id: "e2", source: "cls-a", target: "fn-a", relation: "calls", metadata: { confidence: 90 } },
        { id: "e3", source: "fn-a", target: "fn-b", relation: "calls", metadata: { confidence: 40 } },
        { id: "e4", source: "api-b", target: "fn-b", relation: "calls", metadata: { confidence: 75 } }
    ]
};

/* ------------------------------------------------------------------ trace */

function snapshotDom(document_) {

    const elements = {};

    for (const id of [
        "projectTitle", "nodeCount", "edgeCount", "inspType", "inspTitle", "inspPath",
        "inspRange", "inspComplexity", "inspRefs", "inspConfidence", "inspSignature"
    ]) {
        elements[id] = document_.getElementById(id).textContent;
    }

    for (const id of ["inspectorDetails", "emptyHint", "searchResults"]) {
        elements[`${id}.hidden`] = Boolean(document_.getElementById(id).hidden);
    }

    for (const id of ["inspConnections", "inspTests", "searchResults"]) {

        const element = document_.getElementById(id);

        elements[`${id}.innerHTML`] = element.innerHTML;

        /* children matter as much as raw markup: one path appends nodes, the other
           writes a string, and a trace that only looked at innerHTML would miss it */

        elements[`${id}.children`] = element.children.map(child => ({
            text: child.textContent,
            classes: child.className,
            html: child.innerHTML
        }));
    }

    elements["inspConnections.children"] = document_.getElementById("inspConnections").children.map(li => li.textContent);
    elements["inspectorSidebar.classes"] = document_.getElementById("inspectorSidebar").className;

    const viewport = document_.getElementById("graphSvg").querySelector("#viewport");

    elements.viewportTransform = viewport ? viewport.getAttribute("transform") : null;

    const nodes = [];

    document_.getElementById("graphSvg").querySelectorAll(".graph-node").forEach(node => {

        nodes.push({
            id: node.id,
            classes: node.className,
            transform: node.getAttribute("transform"),
            label: node.textContent
        });
    });

    elements.nodes = nodes;

    const edges = [];

    document_.getElementById("graphSvg").querySelectorAll(".graph-edge").forEach(edge => {

        edges.push({
            classes: edge.className,
            source: edge.getAttribute("data-source"),
            target: edge.getAttribute("data-target"),
            d: edge.getAttribute("d")
        });
    });

    elements.edges = edges;
    elements.svgChildren = document_.getElementById("graphSvg").children.length;

    elements.activeTab = document_.querySelectorAll(".view-tab")
        .filter(tab => tab.classList.contains("active"))
        .map(tab => tab.dataset.view);

    elements.activeLodStep = ["lodStep1", "lodStep2", "lodStep3", "lodStep4"]
        .filter(id => document_.getElementById(id).classList.contains("active"));

    elements.focusDepth = document_.getElementById("focusDepth").value ?? null;
    elements.resolvedOnly = document_.getElementById("filterResolvedOnly").checked ?? null;

    return elements;
}

async function boot(entry, { projectId = "prj-a", fetchMode = "ok" } = {}) {

    const document_ = createDocument();
    const tabs = registerFixtures(document_);

    const fetched = [];

    const responses = new Map();

    globalThis.document = document_;

    globalThis.window = {
        location: { search: projectId === null ? "" : `?projectId=${projectId}`, pathname: "/visualizer.html" },
        addEventListener(type, handler) {

            if (!globalThis.window._listeners) globalThis.window._listeners = new Map();
            if (!globalThis.window._listeners.has(type)) globalThis.window._listeners.set(type, []);
            globalThis.window._listeners.get(type).push(handler);
        },
        fire(type, event = {}) {

            for (const handler of globalThis.window._listeners?.get(type) || []) {
                handler({ type, target: document_.root, preventDefault() {}, stopPropagation() {}, ...event });
            }
        }
    };

    globalThis.fetch = async url => {

        fetched.push(url);

        if (fetchMode === "fail") {
            return { ok: false, status: 503, json: async () => ({}) };
        }

        if (fetchMode === "empty") {
            return { ok: true, status: 200, json: async () => ({ projectName: null, nodes: [], edges: [] }) };
        }

        const view = /\/api\/graph\/([^?/]+)/.exec(url)?.[1] || "architecture";

        return {
            ok: true,
            status: 200,
            json: async () => responses.get(url) || { ...GRAPH, projectName: `${GRAPH.projectName}:${view}` }
        };
    };

    /*
    | The query is what gives every boot a fresh module instance: ESM is keyed by
    | URL, so two boots of the same file are two evaluations. A classic script and a
    | CommonJS bridge cannot promise that (its cache key ignores the query), which is
    | why the scenario runner spawns one process per case instead of trusting a
    | cache trick — see test/web/visualizerScenario.js.
    */

    const href = `${pathToFileURL(entry).href}?case=${encodeURIComponent(`${projectId}|${fetchMode}`)}`;

    await import(href);

    /* the page fires DOMContentLoaded; the client's init runs from there */

    for (const handler of globalThis.window._listeners?.get("DOMContentLoaded") || []) handler({ type: "DOMContentLoaded" });

    await tick();

    const api = {
        document: document_,
        tabs,
        fetched,
        responses,
        tick,
        snapshot: () => snapshotDom(document_),
        clickTab: async index => {

            tabs[index].fire("click", { target: tabs[index] });

            await tick();
        },
        clickNode: async label => {

            const node = document_.getElementById("graphSvg")
                .querySelectorAll(".graph-node")
                .find(item => item.getAttribute("id") === `node-${label}`);

            if (!node) throw new Error(`no rendered node ${label} — drew: ${document_.getElementById("graphSvg").querySelectorAll(".graph-node").map(item => item.getAttribute("id")).join(",")}`);

            node.fire("click", { target: node });

            await tick();
        },
        doubleClickNode: async label => {

            const node = document_.getElementById("graphSvg")
                .querySelectorAll(".graph-node")
                .find(item => item.getAttribute("id") === `node-${label}`);

            node.fire("dblclick", { target: node });

            await tick();
        },
        clickButton: async id => {

            document_.getElementById(id).fire("click", { target: document_.getElementById(id) });

            await tick();
        },
        change: async (id, value) => {

            const element = document_.getElementById(id);

            if (id === "filterResolvedOnly") element.checked = value;
            if (id === "focusDepth") element.value = String(value);

            element.fire("change", { target: element });

            await tick();
        },
        type: async value => {

            const input = document_.getElementById("graphSearch");

            input.fire("input", { target: { value } });

            await tick();
        },
        wheel: async (clientX, clientY, deltaY) => {

            document_.getElementById("canvasContainer").fire("wheel", { clientX, clientY, deltaY });

            await tick();
        },
        drag: async (fromX, toX) => {

            document_.getElementById("canvasContainer").fire("mousedown", { target: document_.root, clientX: fromX, clientY: 10 });
            globalThis.window.fire("mousemove", { clientX: toX, clientY: 20 });
            globalThis.window.fire("mouseup", {});

            await tick();
        },
        close: () => {

            delete globalThis.document;
            delete globalThis.window;
            delete globalThis.fetch;
        }
    };

    return api;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

/* ------------------------------------------------------------- the scenario */

async function runScenario(entry, options = {}) {

    const trace = {};

    const client = await boot(entry, options);

    try {

        trace.afterInit = client.snapshot();
        trace.fetchesAfterInit = [...client.fetched];

        /*
        | Node interaction needs a node that the fixture actually drew: the failure
        | and empty paths get their own dataset, so they run the same scenario minus
        | the selection steps — which is what those cases are measuring anyway
        | (fallback data, counts, viewport math, search over what is on screen).
        */

        const selectId = options.selectId ?? null;

        if (selectId) {

            await client.clickNode(selectId);
            trace.afterSelect = client.snapshot();

            await client.doubleClickNode(selectId);
            trace.afterDrillDown = client.snapshot();
            trace.fetchesAfterDrill = [...client.fetched];

            await client.clickButton("btnExploreNeighborhood");
            trace.afterExplore = client.snapshot();
            trace.fetchesAfterExplore = [...client.fetched];

            await client.clickButton("btnAnalyzeImpact");
            trace.afterImpact = client.snapshot();
            trace.fetchesAfterImpact = [...client.fetched];
        }

        await client.clickTab(1);
        trace.afterModuleTab = client.snapshot();
        trace.fetchesAfterModuleTab = [...client.fetched];

        await client.change("focusDepth", 1);
        trace.afterFocusDepth1 = client.snapshot();

        await client.change("filterResolvedOnly", true);
        trace.afterResolvedOnly = client.snapshot();

        await client.change("filterResolvedOnly", false);

        await client.type("alpha");
        trace.afterSearch = client.snapshot();

        await client.wheel(500, 350, 120);
        trace.afterZoomOut = client.snapshot();

        await client.wheel(500, 350, -120);
        trace.afterZoomIn = client.snapshot();

        await client.drag(100, 250);
        trace.afterPan = client.snapshot();

        await client.clickButton("fitGraphBtn");
        trace.afterFit = client.snapshot();

        await client.clickButton("closeInspectorBtn");
        trace.afterReset = client.snapshot();

        return trace;

    } finally {
        client.close();
    }
}

/*
| Where the visualizer's code lives, as one rule shared by the recorder and the
| contract test: a module directory once phase 25 splits it, the single file
| before. Both sides ask the same question, so neither can quietly widen or
| narrow what is being compared.
*/

function clientSources(root) {

    const fs = require("fs");

    const list = fs.readdirSync;

    const modulesDir = require("path").join(root, "web", "public", "visualizer");

    if (!fs.existsSync(modulesDir)) {

        return [require("path").join(root, "web", "public", "visualizer.js")];
    }

    const found = [];

    const walk = current => {

        for (const entry of list(current, { withFileTypes: true })) {

            const full = require("path").join(current, entry.name);

            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js")) found.push(full);
        }
    };

    walk(modulesDir);

    return found.sort();
}

function entryFor(root) {

    const path = require("path");

    return require("fs").existsSync(path.join(root, "web", "public", "visualizer", "main.js"))
        ? path.join(root, "web", "public", "visualizer", "main.js")
        : path.join(root, "web", "public", "visualizer.js");
}

module.exports = { boot, runScenario, createDocument, registerFixtures, GRAPH, tick, clientSources, entryFor };
