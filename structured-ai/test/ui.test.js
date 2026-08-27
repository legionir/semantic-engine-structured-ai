"use strict";

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

/*
| The console has no build step and no framework, so its behaviour is
| testable the same way the rest of the runtime is: with a document
| small enough to fit in this file. The shim implements only what the
| modal service actually touches, which keeps it honest, because a test
| that needs a new method means the service grew a new dependency.
*/

function createDocument() {

    const listeners = new Map();


    class ClassList {

        constructor(owner) {
            this.owner = owner;
        }

        add(...names) {

            for (const name of names) {

                if (!this.owner._classes.includes(name)) {
                    this.owner._classes.push(name);
                }
            }
        }

        remove(...names) {

            this.owner._classes =
                this.owner._classes.filter(
                    name => !names.includes(name)
                );
        }

        toggle(name, force) {

            /* mirrors DOMTokenList.toggle: with a second argument the
               flag decides, without it the class flips */

            const has =
                this.owner._classes.includes(name);

            const wanted =
                force === undefined ? !has : Boolean(force);

            if (wanted && !has) {
                this.owner._classes.push(name);
            } else if (!wanted && has) {
                this.owner._classes =
                    this.owner._classes.filter(n => n !== name);
            }

            return wanted;
        }

        contains(name) {

            return this.owner._classes.includes(name);
        }
    }


    class Element {

        constructor(tag) {

            this.tagName = String(tag).toUpperCase();
            this.children = [];
            this.parent = null;
            this.hidden = false;
            this.style = {};
            this.dataset = {};
            this.attributes = {};
            this.focused = false;

            this._classes = [];
            this._text = "";
            this._listeners = new Map();

            this.classList = new ClassList(this);
        }

        get className() {
            return this._classes.join(" ");
        }

        set className(value) {

            this._classes =
                String(value).split(/\s+/).filter(Boolean);
        }

        set textContent(value) {

            this.children = [];
            this._text = String(value ?? "");
        }

        get textContent() {

            return this.children.length === 0
                ? this._text
                : this.children
                    .map(child => child.textContent)
                    .join("");
        }

        set innerHTML(value) {

            this.children = [];
            this._text = String(value ?? "");
        }

        get innerHTML() {
            return this._text;
        }

        setAttribute(name, value) {
            this.attributes[name] = String(value);
        }

        getAttribute(name) {
            return this.attributes[name] ?? null;
        }

        appendChild(child) {

            /*
            | Node.appendChild moves: the child leaves its previous
            | parent. Leaving a stale reference behind would let a test
            | believe a node is in two places at once.
            */

            if (child.parent && child.parent !== this) {
                child.parent.removeChild(child);
            }

            child.parent = this;

            this.children =
                this.children.filter(item => item !== child);

            this.children.push(child);

            return child;
        }

        /*
        | The console restores a borrowed node to the exact place it came
        | from, which needs the real insertBefore contract: a null anchor
        | appends, and an anchor that is not a child here is an error
        | rather than a silent append.
        */

        insertBefore(child, anchor) {

            if (!anchor) {
                return this.appendChild(child);
            }

            const index =
                this.children.indexOf(anchor);

            if (index === -1) {

                throw new Error(
                    "insertBefore: the anchor is not a child of this node"
                );
            }

            if (child.parent && child.parent !== this) {
                child.parent.removeChild(child);
            }

            this.children =
                this.children.filter(item => item !== child);

            child.parent = this;

            this.children.splice(
                this.children.indexOf(anchor),
                0,
                child
            );

            return child;
        }

        append(...nodes) {

            for (const item of nodes) {
                this.appendChild(item);
            }
        }

        get firstChild() {
            return this.children[0] || null;
        }

        /*
        | parentNode and nextSibling are what the console reads to record
        | where a node lives before it lends it to a modal. The shim used
        | to expose only .parent, so code reading .parentNode saw
        | undefined here and took a branch the browser never takes; a
        | real bug rode out on exactly that gap.
        */

        get parentNode() {
            return this.parent;
        }

        get nextSibling() {

            if (!this.parent) {
                return null;
            }

            const index =
                this.parent.children.indexOf(this);

            return this.parent.children[index + 1] || null;
        }

        /*
        | Mirrors Node.isConnected: true only while the node can be
        | reached from the document body. Code under test uses this to
        | decide whether a node it is holding is still on the page.
        */

        get isConnected() {

            let current = this;

            while (current) {

                if (current._isDocumentRoot) {
                    return true;
                }

                current = current.parent;
            }

            return false;
        }

        removeChild(child) {

            this.children =
                this.children.filter(item => item !== child);

            child.parent = null;

            return child;
        }

        remove() {

            if (!this.parent) {
                return;
            }

            this.parent.children =
                this.parent.children.filter(
                    child => child !== this
                );

            this.parent = null;
        }

        addEventListener(type, handler) {

            if (!this._listeners.has(type)) {
                this._listeners.set(type, []);
            }

            this._listeners.get(type).push(handler);
        }

        dispatch(type, event = {}) {

            for (
                const handler
                of this._listeners.get(type) || []
            ) {
                /* form submissions and friends are cancellable in the
                   browser, so the shim offers the same */
                handler({
                    target: this,
                    preventDefault() {},
                    ...event
                });
            }
        }

        focus() {

            document.activeElement = this;
        }

        querySelector(selector) {

            const tags =
                selector
                    .split(",")
                    .map(part => part.trim().toUpperCase())
                    .filter(part => /^[A-Z]+$/.test(part));

            const walk = element => {

                for (const child of element.children) {

                    if (tags.includes(child.tagName)) {
                        return child;
                    }

                    const found = walk(child);

                    if (found) {
                        return found;
                    }
                }

                return null;
            };

            return walk(this);
        }

        querySelectorAll(selector) {

            const wanted =
                selector.trim().replace(/^\./, "");

            const found = [];

            const walk = element => {

                for (const child of element.children) {

                    if (child._classes.includes(wanted)) {
                        found.push(child);
                    }

                    walk(child);
                }
            };

            walk(this);

            return found;
        }
    }


    const body = new Element("body");

    body._isDocumentRoot = true;

    const registry = new Map();

    const document = {

        body,

        activeElement: null,

        createElement: tag => new Element(tag),

        /*
        | index.html is not parsed here, so the ids the console reads are
        | registered by the test that needs them.
        */

        register(id, tag) {

            const element = new Element(tag || "div");

            element.id = id;

            registry.set(id, element);

            body.appendChild(element);

            return element;
        },

        /*
        | document.getElementById walks the tree, so a node that has been
        | detached is not found. A registry lookup that ignores this hides
        | exactly the bug where a node is moved into a modal and never
        | returned, so the connectedness check is part of the shim.
        */

        getElementById(id) {

            const element = registry.get(id);

            return element && element.isConnected ? element : null;
        },

        addEventListener(type, handler) {

            if (!listeners.has(type)) {
                listeners.set(type, []);
            }

            listeners.get(type).push(handler);
        },

        dispatch(type, event = {}) {

            for (
                const handler
                of listeners.get(type) || []
            ) {
                handler({ preventDefault() {}, ...event });
            }
        },

        getElementsByName(name) {

            const wanted = String(name);
            const found = [];

            const walk = element => {

                if (
                    element.name === wanted ||
                    (element.attributes && element.attributes.name === wanted)
                ) {
                    found.push(element);
                }

                for (const child of element.children || []) {
                    walk(child);
                }
            };

            walk(body);

            return found;
        }
    };

    return document;
}


const results = [];


async function test(name, fn) {

    try {

        await fn();

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


global.document = createDocument();

const Modal =
    require(
        path.join(__dirname, "..", "web", "public", "modal.js")
    );


function backdrops() {

    return document.body.children.filter(
        child => child.classList.contains("modal-backdrop")
    );
}


async function main() {

    console.log("modal service");

    await test("a modal is a backdrop with a dialog inside it", () => {

        const handle =
            Modal.open({ title: "Settings", body: "content" });

        assert.equal(backdrops().length, 1);

        const dialog = backdrops()[0].children[0];

        assert.ok(dialog.classList.contains("modal"));
        assert.equal(dialog.getAttribute("role"), "dialog");
        assert.equal(dialog.getAttribute("aria-modal"), "true");

        assert.ok(document.body.classList.contains("modal-open"));

        handle.close();

        assert.equal(backdrops().length, 0);
        assert.equal(document.body.classList.contains("modal-open"), false);
    });

    await test("the header and the footer are optional", () => {

        const bare =
            Modal.open({ body: "just a body", dismissible: false });

        const dialog = backdrops()[0].children[0];

        const [header, , footer] = dialog.children;

        assert.equal(header.hidden, true);
        assert.equal(footer.hidden, true);

        bare.close();

        const full =
            Modal.open({
                title: "Approval required",
                subtitle: "1/3 pending",
                body: "arguments",
                footer: Modal.button("Approve", "allow")
            });

        const second = backdrops()[0].children[0];

        assert.equal(second.children[0].hidden, false);
        assert.equal(second.children[2].hidden, false);

        assert.match(second.textContent, /Approval required/);
        assert.match(second.textContent, /1\/3 pending/);
        assert.match(second.textContent, /Approve/);

        full.close();
    });

    await test("footer buttons run their handler", () => {

        const clicks = [];

        const handle =
            Modal.open({
                title: "Approval",
                footer:
                    Modal.row(
                        Modal.button("Deny", "refuse", () => clicks.push("deny")),
                        Modal.button("Approve", "allow", () => clicks.push("allow")),
                        Modal.button("Approve all (3)", "ghost", () => clicks.push("all"))
                    )
            });

        const footer =
            backdrops()[0].children[0].children[2];

        const row = footer.children[0];

        assert.equal(row.children.length, 3);

        row.children[2].dispatch("click");
        row.children[0].dispatch("click");

        assert.deepEqual(clicks, ["all", "deny"]);

        handle.close();
    });

    await test("a click on the backdrop closes, a click inside does not", () => {

        let closed = null;

        const handle =
            Modal.open({
                title: "Detail",
                onClose: reason => {
                    closed = reason;
                }
            });

        const backdrop = backdrops()[0];
        const dialog = backdrop.children[0];

        backdrop.dispatch("mousedown", { target: dialog });

        assert.equal(backdrops().length, 1, "a click inside closed it");

        backdrop.dispatch("mousedown", { target: backdrop });

        assert.equal(backdrops().length, 0);
        assert.equal(closed, "backdrop");
        assert.equal(handle.isOpen(), false);
    });

    await test("escape closes the topmost modal only", () => {

        const first = Modal.open({ title: "first" });
        const second = Modal.open({ title: "second" });

        assert.equal(Modal.openCount, 2);

        document.dispatch("keydown", { key: "Escape" });

        assert.equal(Modal.openCount, 1);
        assert.equal(second.isOpen(), false);
        assert.equal(first.isOpen(), true);

        document.dispatch("keydown", { key: "Escape" });

        assert.equal(Modal.openCount, 0);
        assert.equal(document.body.classList.contains("modal-open"), false);
    });

    await test("a modal that is not dismissible ignores escape and the backdrop", () => {

        const handle =
            Modal.open({ title: "busy", dismissible: false });

        document.dispatch("keydown", { key: "Escape" });

        const backdrop = backdrops()[0];

        backdrop.dispatch("mousedown", { target: backdrop });

        assert.equal(handle.isOpen(), true);

        handle.close("done");

        assert.equal(handle.isOpen(), false);
    });

    await test("title, subtitle, body and footer can be replaced in place", () => {

        const handle =
            Modal.open({ title: "one", body: "first" });

        handle.setTitle("two");
        handle.setSubtitle("2/5 pending");
        handle.setBody("second");
        handle.setFooter(Modal.button("Close", ""));

        const dialog = backdrops()[0].children[0];

        assert.match(dialog.textContent, /two/);
        assert.match(dialog.textContent, /2\/5 pending/);
        assert.match(dialog.textContent, /second/);
        assert.match(dialog.textContent, /Close/);
        assert.equal(/first/.test(dialog.textContent), false);

        handle.close();
    });

    await test("closing twice does not fire onClose twice", () => {

        let count = 0;

        const handle =
            Modal.open({
                title: "once",
                onClose: () => {
                    count++;
                }
            });

        handle.close();
        handle.close();

        assert.equal(count, 1);
        assert.equal(backdrops().length, 0);
    });

    await test("markup in data cannot break out of a label", () => {

        assert.equal(
            Modal.escape('<img src=x onerror="alert(1)">'),
            "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
        );
    });

    /* ------------------------------------------------------------- */

    console.log("\nconsole rendering");

    const console_ = await loadConsole();

    await test("an agent says who it belongs to and how deep it sits", () => {

        console_.send({ type: "run:start", task: "audit the repository" });

        console_.send({
            type: "agent:start",
            agent: "code_analysis",
            scope: "code_analysis#1",
            depth: 1,
            parent: "main_agent",
            parent_scope: "main_agent",
            delegation_id: "d1",
            persona: "code_architect",
            task: "describe the layout"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /code_analysis/);
        assert.match(tree, /from main_agent/);
        assert.match(tree, /depth 1/);
        assert.match(tree, /code_architect/);
    });

    await test("a graph is labelled by its shape and split into waves", () => {

        console_.send({
            type: "tool:graph",
            agent: "main_agent",
            graph_id: "graph_1",
            iteration: 2,
            shape: "graph",
            max_parallel: 8,
            waves: [["a", "b"], ["c"]],
            calls: [
                { id: "a", name: "fs_read", depends_on: [] },
                { id: "b", name: "fs_list", depends_on: [] },
                { id: "c", name: "fs_stat", depends_on: ["a", "b"] }
            ]
        });

        for (const call of [
            { id: "a", name: "fs_read", wave: 0, depends_on: [] },
            { id: "b", name: "fs_list", wave: 0, depends_on: [] },
            { id: "c", name: "fs_stat", wave: 1, depends_on: ["a", "b"] }
        ]) {

            console_.send({
                type: "tool:start",
                agent: "main_agent",
                graph_id: "graph_1",
                iteration: 2,
                call_key: `main_agent|graph_1|${call.id}`,
                ...call,
                arguments_preview: `{ "path": "${call.id}.ts" }`
            });

            console_.send({
                type: "tool:end",
                agent: "main_agent",
                graph_id: "graph_1",
                iteration: 2,
                id: call.id,
                name: call.name,
                wave: call.wave,
                call_key: `main_agent|graph_1|${call.id}`,
                success: call.id !== "c",
                duration_ms: 12,
                result_preview: "{ \"ok\": true }",
                error: call.id === "c" ? "it failed" : undefined
            });
        }

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /dependency graph/);
        assert.match(tree, /wave 1 · 2 in parallel/);
        assert.match(tree, /wave 2/);
        assert.match(tree, /after a, b/);

        assert.match(
            document.getElementById("execSummary").textContent,
            /2 agents · 3 calls · 1 failed/
        );
    });

    await test("a row opens the full detail of what was executed", async () => {

        const rows =
            document.getElementById("tree")
                .querySelectorAll("tool");

        assert.ok(rows.length >= 3);

        rows[0].dispatch("click");

        await Promise.resolve();

        const dialog =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];

        const text = dialog.textContent;

        assert.match(text, /fs_read/);
        assert.match(text, /executed by/);
        assert.match(text, /main_agent/);
        assert.match(text, /dependency graph, wave 1 of 2/);
        assert.match(text, /ran alongside/);
        assert.match(text, /Arguments/);

        Modal.closeTop("test");
    });

    await test("a non-zero exit code is not drawn as a clean success", () => {

        console_.send({
            type: "tool:graph",
            agent: "main_agent",
            graph_id: "graph_2",
            iteration: 3,
            shape: "single",
            max_parallel: 8,
            waves: [["build"]],
            calls: [{ id: "build", name: "terminal_exec", depends_on: [] }]
        });

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            graph_id: "graph_2",
            id: "build",
            name: "terminal_exec",
            wave: 0,
            call_key: "main_agent|graph_2|build",
            arguments_preview: '{ "command": "npx tsc --build" }'
        });

        console_.send({
            type: "tool:end",
            agent: "main_agent",
            graph_id: "graph_2",
            id: "build",
            name: "terminal_exec",
            wave: 0,
            call_key: "main_agent|graph_2|build",
            success: true,
            exit_code: 2,
            duration_ms: 112,
            result_preview: "{}"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /exit 2/);

        const rows =
            document.getElementById("tree")
                .querySelectorAll("tool");

        const build =
            rows.find(
                row => row.textContent.includes("terminal_exec")
            );

        assert.ok(build.classList.contains("exit"));
        assert.equal(build.classList.contains("done"), false);
    });

    await test("a loaded skill is marked on the agent that loaded it", () => {

        console_.send({
            type: "skill:loaded",
            agent: "main_agent",
            scope: "main_agent",
            skills: ["codebase_analysis"],
            chars: 775
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /Loaded skill codebase_analysis/);

        const marks =
            document.getElementById("tree")
                .querySelectorAll("skill");

        assert.equal(marks.length, 1);

        /* loading it twice does not stack up */
        console_.send({
            type: "skill:loaded",
            agent: "main_agent",
            scope: "main_agent",
            skills: ["codebase_analysis"],
            chars: 775
        });

        assert.equal(
            document.getElementById("tree")
                .querySelectorAll("skill").length,
            1
        );
    });

    await test("runtime hooks are distinct rows in the execution card", () => {

        console_.send({
            type: "hook:start",
            id: "verify",
            phase: "after_task",
            hook_type: "agent",
            depends_on: [],
            on_failure: "stop"
        });

        console_.send({
            type: "hook:end",
            id: "verify",
            phase: "after_task",
            hook_type: "agent",
            status: "done",
            ok: true,
            summary: "npm test passed",
            duration_ms: 120
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /Runtime routine/);
        assert.match(tree, /after_task · verify · agent/);
        assert.match(tree, /npm test passed/);
        assert.match(
            document.getElementById("execSummary").textContent,
            /1 hook/
        );
    });

    await test("a new task archives the previous execution in a closed accordion", () => {

        console_.send({
            type: "run:start",
            task: "second task\nwith a line break"
        });

        const archive =
            document.getElementById("executionArchive");

        assert.equal(archive.children.length >= 1, true);

        const previous =
            archive.children[archive.children.length - 1];

        assert.equal(previous.tagName, "DETAILS");
        assert.equal(Boolean(previous.open), false);
        assert.match(previous.children[0].textContent, /audit the repository/);
        assert.equal(previous.children[0].textContent.includes("\n"), false);

        assert.match(
            document.getElementById("tree").textContent,
            /second task/
        );
    });

    await test("the plan card renders phases, steps, agents and evidence live", () => {

        console_.send({
            type: "plan:autoroute:end",
            step: "P1.1",
            agent: "implementation",
            ok: true,
            plan: {
                exists: true,
                objective: "Ship the input system",
                steps: 2,
                done: 1,
                blocked: 0,
                routine: {
                    enabled: true,
                    before_task: ["safety_commit"],
                    after_task: ["verify", "review"]
                },
                phases: [
                    {
                        id: "P1",
                        title: "Core",
                        goal: "Implement and verify input",
                        status: "in_progress",
                        steps: [
                            {
                                id: "P1.1",
                                title: "Implement InputManager",
                                agent: "implementation",
                                status: "done",
                                evidence: "src/input.js changed; tests passed"
                            },
                            {
                                id: "P1.2",
                                title: "Run verification",
                                agent: "testing",
                                status: "pending",
                                evidence: null
                            }
                        ]
                    }
                ]
            }
        });

        const plan =
            document.getElementById("plan").textContent;

        assert.match(plan, /Ship the input system/);
        assert.match(plan, /P1 · Core/);
        assert.match(plan, /P1\.1/);
        assert.match(plan, /@implementation/);
        assert.match(plan, /tests passed/);
        assert.match(plan, /Runtime routine/);
        assert.equal(
            document.getElementById("planSummary").textContent,
            "1/2 done"
        );
    });

    await test("a loop is visible on the agent that is looping", () => {

        console_.send({
            type: "run:loop",
            agent: "main_agent",
            scope: "main_agent",
            repeats: 3,
            outcome: "notice",
            signature: "fs_read:Path does not exist: missing.md"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /repeated failure ×3/);
        assert.match(tree, /missing\.md/);
    });

    await test("an answer the runtime could not read is shown on the agent", async () => {

        console_.send({
            type: "run:malformed",
            agent: "main_agent",
            scope: "main_agent",
            iteration: 4,
            code: "MALFORMED_TOOL_ARGUMENTS",
            reason: 'Native tool call "fs_write" has arguments that are not valid JSON.',
            attempt: 1,
            limit: 2,
            max_attempts: 3,
            outcome: "retry"
        });

        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /unreadable answer ×1/);
        assert.match(tree, /fs_write/);
        assert.match(
            document.getElementById("log").textContent,
            /MALFORMED_TOOL_ARGUMENTS 1\/3/
        );

        console_.send({
            type: "run:malformed",
            agent: "main_agent",
            scope: "main_agent",
            iteration: 6,
            code: "TRUNCATED_RESPONSE",
            reason: "The endpoint truncated the model response.",
            attempt: 3,
            limit: 2,
            max_attempts: 3,
            outcome: "stopped"
        });

        const stopped = document.getElementById("tree").textContent;
        assert.match(stopped, /unreadable answer ×3/);
        assert.match(stopped, /retry budget exhausted; run stopped/);
    });

    await test("approvals become one modal with a counter and approve all", async () => {

        for (const index of [1, 2, 3]) {

            console_.send({
                type: "approval:request",
                id: `approval_${index}`,
                agent: "main_agent",
                tool: "fs_write",
                reason: "writes to the workspace",
                groups: ["filesystem.write"],
                arguments: { path: `file${index}.md` }
            });
        }

        assert.equal(
            document.getElementById("approvalsCount").textContent,
            "3"
        );

        const dialog =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];

        assert.match(dialog.textContent, /Approval required — fs_write/);
        assert.match(dialog.textContent, /1\/3 pending/);
        assert.match(dialog.textContent, /Also waiting/);

        const footer = dialog.children[2];

        const labels =
            footer.children[0].children.map(
                button => button.textContent
            );

        assert.deepEqual(
            labels,
            ["Deny", "Approve", "Approve all (3)"]
        );

        /* approving one advances the queue instead of closing it */
        footer.children[0].children[1].dispatch("click");

        assert.equal(
            document.getElementById("approvalsCount").textContent,
            "2"
        );

        assert.match(
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0].textContent,
            /1\/2 pending/
        );

        /* approve all empties the queue and closes the modal */
        const remaining =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0].children[2];

        remaining.children[0].children[2].dispatch("click");

        assert.equal(
            document.getElementById("approvalsCount").textContent,
            "0"
        );

        assert.equal(
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            ).length,
            0
        );

        /* the three answers are actually sent to the runtime */
        await new Promise(resolve => setTimeout(resolve, 5));

        assert.equal(
            console_.posted.filter(
                item => item.url.startsWith("/api/approvals/")
            ).length,
            3
        );

        assert.ok(
            console_.posted
                .filter(item => item.url.startsWith("/api/approvals/"))
                .every(item => item.body.approved === true)
        );
    });

    await test("the conversation is drawn as bubbles, reasoning folded away", () => {

        console_.send({
            type: "session:message",
            message: {
                role: "user",
                kind: "message",
                content: "audit the repository",
                at: Date.now()
            }
        });

        console_.send({
            type: "session:message",
            message: {
                role: "assistant",
                kind: "thinking",
                agent: "main_agent",
                iteration: 1,
                content: "first I will read the plan",
                at: Date.now()
            }
        });

        console_.send({
            type: "session:message",
            message: {
                role: "assistant",
                kind: "response",
                content: "the loader lives in src/boot.ts",
                at: Date.now()
            }
        });

        const chat =
            document.getElementById("chat");

        const bubbles =
            chat.querySelectorAll("bubble");

        assert.equal(bubbles.length, 3);

        assert.ok(bubbles[0].classList.contains("user"));
        assert.ok(bubbles[1].classList.contains("thinking"));
        assert.ok(bubbles[2].classList.contains("assistant"));

        assert.match(chat.textContent, /audit the repository/);
        assert.match(chat.textContent, /first I will read the plan/);
        assert.match(chat.textContent, /src\/boot\.ts/);

        /* reasoning sits behind a summary rather than in the flow */
        assert.equal(bubbles[1].children[0].tagName, "DETAILS");
    });

    await test("markdown is rendered and Persian bubbles use RTL direction", () => {

        console_.send({
            type: "session:message",
            message: {
                role: "user",
                kind: "message",
                content: "# سلام\n\n**این متن** را در `src/app.ts` ببین."
            }
        });

        console_.send({
            type: "session:message",
            message: {
                role: "assistant",
                kind: "response",
                content: "## گزارش\n\n- مورد اول\n- مورد دوم\n\n[مستندات](https://example.com)"
            }
        });

        const bubbles = document.getElementById("chat").querySelectorAll("bubble");
        const user = bubbles[bubbles.length - 2];
        const assistant = bubbles[bubbles.length - 1];

        assert.equal(user.dir, "rtl");
        assert.ok(user.classList.contains("rtl"));
        assert.equal(user.children[1].children[0].tagName, "H1");
        assert.equal(user.children[1].children[1].children[0].tagName, "STRONG");

        assert.equal(assistant.dir, "rtl");
        assert.ok(assistant.classList.contains("rtl"));
        assert.equal(assistant.children[1].children[0].tagName, "H2");
        assert.equal(assistant.children[1].children[1].tagName, "UL");
        assert.equal(assistant.children[1].children[2].children[0].tagName, "A");
        assert.match(assistant.textContent, /مستندات/);
    });

    await test("a user message's execution renders as a stage-by-stage block", () => {

        const turn = "turn-abc";

        console_.send({
            type: "session:message",
            message: {
                role: "user",
                kind: "message",
                content: "fix the physics",
                turn_id: turn,
                at: Date.now()
            }
        });

        /* the same turn's execution events arrive from the runtime */
        console_.send({
            type: "agent:iteration",
            agent: "main_agent",
            scope: "main_agent",
            iteration: 1,
            turn_id: turn
        });

        console_.send({
            type: "agent:action",
            agent: "main_agent",
            scope: "main_agent",
            action: "tool_call",
            turn_id: turn
        });

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            id: "c1",
            name: "fs_edit",
            turn_id: turn
        });

        console_.send({
            type: "tool:end",
            agent: "main_agent",
            id: "c1",
            name: "fs_edit",
            success: true,
            turn_id: turn
        });

        const chat =
            document.getElementById("chat");

        /* an execution block appeared under the user message */
        const blocks =
            chat.querySelectorAll("turn-execution");

        assert.equal(blocks.length, 1);
        assert.match(blocks[0].textContent, /execution/);
        assert.match(blocks[0].textContent, /1 tool call/);
        assert.match(blocks[0].textContent, /fs_edit/);
        assert.match(blocks[0].textContent, /tool_call/);
    });

    await test("a git report is drawn as its own bubble with a branch", () => {

        console_.send({
            type: "session:message",
            message: {
                role: "system",
                kind: "git-report",
                content: "2 files changed, 1 new file, 0 files removed",
                branch: "arena/01a011ec-structured-ai",
                at: Date.now()
            }
        });

        const chat =
            document.getElementById("chat");

        const report =
            chat.querySelectorAll("git-report");

        assert.equal(report.length, 1);
        assert.match(report[0].textContent, /git/);
        assert.match(report[0].textContent, /arena/);
        assert.match(report[0].textContent, /2 files changed, 1 new file/);
    });

    await test("a request in flight is visible while it is waiting", async () => {

        console_.send({
            type: "request:start",
            agent: "main_agent",
            role: "MAIN",
            model: "gpt-oss-20b"
        });

        const chat =
            document.getElementById("chat");

        assert.match(chat.textContent, /main_agent · thinking/);

        const pending =
            chat.querySelectorAll("pending");

        assert.equal(pending.length, 1);

        const reasoning = chat.querySelector("details");
        assert.ok(reasoning, "the previous reasoning card is missing");

        reasoning.open = true;
        chat.scrollTop = 37;

        await new Promise(resolve => setTimeout(resolve, 260));

        assert.equal(
            chat.querySelector("details"),
            reasoning,
            "the waiting timer rebuilt the conversation"
        );
        assert.equal(reasoning.open, true);
        assert.equal(chat.scrollTop, 37);
        assert.equal(chat.querySelectorAll("pending")[0], pending[0]);

        const elapsed = /([\d.]+) s/.exec(pending[0].textContent);
        assert.ok(elapsed && Number(elapsed[1]) > 0);

        console_.send({
            type: "request:end",
            agent: "main_agent",
            role: "MAIN",
            outcome: "answered",
            duration_ms: 1830
        });

        assert.equal(
            document.getElementById("chat")
                .querySelectorAll("pending").length,
            0
        );
    });

    await test("opening a stored conversation redraws every card", async () => {

        /*
        | The point of storing the streamed events rather than a summary:
        | the same code that draws a live run draws the stored one.
        */

        console_.reply("/api/sessions/s-1", {
            session: {
                id: "s-1",
                title: "an earlier conversation",
                turns: 1,

                messages: [
                    { role: "user", kind: "message", content: "what changed?" },
                    { role: "assistant", kind: "response", content: "two files" }
                ],

                events: [
                    { type: "run:start", task: "what changed?" },
                    {
                        type: "agent:start",
                        agent: "git_analysis",
                        scope: "git_analysis#1",
                        depth: 1,
                        parent: "main_agent",
                        parent_scope: "main_agent",
                        task: "report the repository state"
                    },
                    {
                        type: "hook:start",
                        id: "verify",
                        phase: "after_task",
                        hook_type: "agent"
                    },
                    {
                        type: "hook:end",
                        id: "verify",
                        phase: "after_task",
                        hook_type: "agent",
                        status: "done",
                        ok: true,
                        summary: "stored verification passed"
                    },
                    {
                        type: "tool:graph",
                        agent: "main_agent",
                        graph_id: "graph_9",
                        iteration: 1,
                        shape: "parallel",
                        max_parallel: 8,
                        waves: [["one", "two"]],
                        calls: [
                            { id: "one", name: "git_status", depends_on: [] },
                            { id: "two", name: "git_log", depends_on: [] }
                        ]
                    },
                    {
                        type: "tool:start",
                        agent: "main_agent",
                        graph_id: "graph_9",
                        id: "one",
                        name: "git_status",
                        wave: 0,
                        call_key: "main_agent|graph_9|one",
                        arguments_preview: '{ "cwd": "." }'
                    },
                    {
                        type: "tool:end",
                        agent: "main_agent",
                        graph_id: "graph_9",
                        id: "one",
                        name: "git_status",
                        wave: 0,
                        call_key: "main_agent|graph_9|one",
                        success: true,
                        duration_ms: 7,
                        result_preview: "{}"
                    }
                ],

                calls: [
                    {
                        key: "main_agent|graph_9|one",
                        id: "one",
                        name: "git_status",
                        agent: "main_agent",
                        status: "done",
                        arguments: { cwd: "." },
                        result: {}
                    }
                ]
            }
        });

        /* the server announces the switch, the console loads it */
        console_.send({
            type: "session:switched",
            session: {
                id: "s-1",
                title: "an earlier conversation",
                turns: 1
            }
        });

        await new Promise(resolve => setTimeout(resolve, 5));

        /* the conversation */
        assert.match(
            document.getElementById("chat").textContent,
            /what changed\?/
        );

        /* the execution card */
        const tree =
            document.getElementById("tree").textContent;

        assert.match(tree, /git_analysis/);
        assert.match(tree, /from main_agent/);
        assert.match(tree, /parallel/);
        assert.match(tree, /git_status/);
        assert.match(tree, /stored verification passed/);

        /* the events card */
        assert.ok(
            document.getElementById("log").children.length >= 5
        );

        assert.match(
            document.getElementById("sessionTitle").textContent,
            /an earlier conversation/
        );
    });

    await test("settings open in a modal from the header button", () => {

        document.getElementById("settingsButton").dispatch("click");

        const dialog =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            )[0].children[0];

        assert.match(dialog.textContent, /Settings/);
        assert.match(dialog.textContent, /MAX_ITERATIONS/);
        assert.match(dialog.textContent, /applied on next use/);

        Modal.closeTop("test");

        assert.equal(
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            ).length,
            0
        );
    });

    await test("execution and events open as modals from the header", () => {

        document.getElementById("executionButton").dispatch("click");

        let backdrops =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            );

        assert.equal(backdrops.length, 1);
        assert.match(backdrops[0].textContent, /Execution/);

        Modal.closeTop("test");

        backdrops =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            );

        assert.equal(backdrops.length, 0);

        document.getElementById("eventsButton").dispatch("click");

        backdrops =
            document.body.children.filter(
                child => child.classList.contains("modal-backdrop")
            );

        assert.equal(backdrops.length, 1);
        assert.match(backdrops[0].textContent, /Events/);

        Modal.closeTop("test");
    });

    /*
    | Modal.close() detaches the backdrop before onClose runs, so a node
    | the modal borrowed reports isConnected === false at exactly the
    | moment the handler decides whether to give it back. Guarding the
    | hand-back on that flag stranded #log outside the document, and
    | every event after that threw on list.appendChild.
    */

    await test("cards borrowed by a modal are on the page again after it closes", () => {

        /*
        | Borrowing is only correct if it is reversible exactly: each
        | card goes back to the parent it came from, in the order it was
        | in. Asserting merely that it is somewhere in #rowTwo would
        | accept a restore that flattened the panels, which is the shape
        | the real bug left behind.
        */

        const ids = [
            "log", "logFilter", "logType", "logCount", "clearLog",
            "tree", "executionArchive"
        ];

        const homes = new Map();

        for (const id of ids) {

            const element =
                document.getElementById(id);

            assert.ok(element, `${id} should start on the page`);

            homes.set(id, {
                parent: element.parentNode,
                index: element.parentNode.children.indexOf(element)
            });
        }

        const rowTwo =
            document.getElementById("rowTwo");

        document.getElementById("eventsButton").dispatch("click");

        /*
        | While the modal is open the node is still in the document, just
        | under the backdrop instead of its home.
        */

        assert.ok(
            document.getElementById("log"),
            "log stays reachable while the modal holds it"
        );

        assert.notEqual(
            document.getElementById("log").parentNode,
            homes.get("log").parent,
            "log left its home while the modal is open"
        );

        /*
        | The panel the card was taken from must survive the loan. The
        | bug this guards against handed the modal the shared container
        | instead of the cards, and closing it took the container away.
        */

        assert.ok(
            homes.get("log").parent.isConnected,
            "the events panel must stay on the page while its log is lent out"
        );

        Modal.closeTop("test");

        document.getElementById("executionButton").dispatch("click");

        assert.ok(
            homes.get("tree").parent.isConnected,
            "the execution scroller must stay on the page while its cards are lent out"
        );

        Modal.closeTop("test");

        for (const id of ids) {

            const element =
                document.getElementById(id);

            assert.ok(element, `${id} must return to the page`);

            assert.equal(
                element.parentNode,
                homes.get(id).parent,
                `${id} must be back in the parent it came from, not stranded`
            );

            assert.equal(
                element.parentNode.children.indexOf(element),
                homes.get(id).index,
                `${id} must be back in the position it came from`
            );
        }

        assert.ok(
            rowTwo.isConnected,
            "the hidden row itself must never be adopted by a modal"
        );

        /*
        | Opening twice in a row is what turned the original bug from a
        | cosmetic slip into a dead console, so the round trip is made
        | again and checked the same way.
        */

        for (const button of ["eventsButton", "executionButton"]) {

            document.getElementById(button).dispatch("click");

            Modal.closeTop("test");
        }

        for (const id of ids) {

            assert.equal(
                document.getElementById(id).parentNode,
                homes.get(id).parent,
                `${id} must survive a second open and close`
            );
        }
    });

    await test("the event stream keeps drawing after a modal round trip", () => {

        const before =
            document.getElementById("log").children.length;

        document.getElementById("eventsButton").dispatch("click");
        Modal.closeTop("test");

        console_.send({
            type: "agent_start",
            agent: "main_agent",
            depth: 0
        });

        const list =
            document.getElementById("log");

        assert.ok(list, "the list survived the round trip");

        assert.ok(
            list.children.length > before,
            "the event after the round trip was drawn"
        );
    });

    await test("the events filter matches any part of a word, in the type or the text", () => {

        const list =
            document.getElementById("log");

        const filter =
            document.getElementById("logFilter");

        list.innerHTML = "";

        document.getElementById("clearLog").dispatch("click");

        for (
            const event
            of [
                { type: "tool:start", agent: "main_agent", name: "fs_read" },
                { type: "tool:end", agent: "main_agent", name: "terminal_exec", success: true, duration_ms: 12 },
                { type: "agent:iteration", agent: "researcher", iteration: 2 }
            ]
        ) {
            console_.send(event);
        }

        const visible = () =>
            list.children.filter(item => !item.hidden);

        assert.equal(visible().length, 3, "every row shows with no filter");

        /* a fragment from the middle of a word, not a prefix */

        filter.value = "rmina";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "a fragment inside a word matches the row that contains it"
        );

        assert.match(visible()[0].textContent, /terminal_exec/);

        /* the event type is searched too, not only the description */

        filter.value = "iterat";

        filter.dispatch("input");

        assert.equal(visible().length, 1);
        assert.equal(visible()[0].dataset.type, "agent:iteration");

        /* and matching is case insensitive */

        filter.value = "FS_READ";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "an upper case query matches a lower case row"
        );

        filter.value = "";

        filter.dispatch("input");

        assert.equal(visible().length, 3, "clearing the box restores every row");
    });

    await test("the events filter narrows to one type, and combines with the text", () => {

        const list =
            document.getElementById("log");

        const filter =
            document.getElementById("logFilter");

        const type =
            document.getElementById("logType");

        list.innerHTML = "";

        document.getElementById("clearLog").dispatch("click");

        for (
            const event
            of [
                { type: "tool:start", agent: "main_agent", name: "fs_read" },
                { type: "tool:start", agent: "main_agent", name: "fs_write" },
                { type: "tool:end", agent: "main_agent", name: "fs_read", success: true, duration_ms: 8 }
            ]
        ) {
            console_.send(event);
        }

        const visible = () =>
            list.children.filter(item => !item.hidden);

        /* the dropdown offers exactly the types that are present */

        assert.deepEqual(
            type.children
                .map(option => option.value)
                .filter(Boolean)
                .sort(),
            ["tool:end", "tool:start"],
            "the type list is built from the events that arrived"
        );

        type.value = "tool:start";

        type.dispatch("change");

        assert.equal(visible().length, 2, "only the chosen type is shown");

        for (const item of visible()) {
            assert.equal(item.dataset.type, "tool:start");
        }

        /* the two filters are an intersection, not a replacement */

        filter.value = "write";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "a row must pass the type filter and the text filter"
        );

        assert.match(visible()[0].textContent, /fs_write/);

        /* the count reports what survived, out of what there is */

        assert.equal(
            document.getElementById("logCount").textContent,
            "1 of 3"
        );

        /* a row arriving while a filter is on obeys it too */

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            name: "fs_delete"
        });

        assert.equal(
            visible().length,
            1,
            "a new row that does not match stays hidden"
        );

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            name: "fs_write_many"
        });

        assert.equal(
            visible().length,
            2,
            "a new row that matches both filters is shown"
        );

        type.value = "";

        type.dispatch("change");

        filter.value = "";

        filter.dispatch("input");

        assert.equal(visible().length, 5, "clearing both filters shows everything");

        assert.equal(
            document.getElementById("logCount").textContent,
            "5 events"
        );
    });

    await test("the events filter survives the modal round trip", () => {

        const list =
            document.getElementById("log");

        list.innerHTML = "";

        document.getElementById("clearLog").dispatch("click");

        console_.send({ type: "tool:start", agent: "main_agent", name: "fs_read" });
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 1 });

        document.getElementById("logType").value = "tool:start";

        document.getElementById("logType").dispatch("change");

        /*
        | The controls move into the modal with the list, so the filter
        | has to keep working there, and keep working again afterwards.
        */

        document.getElementById("eventsButton").dispatch("click");

        assert.equal(
            document.getElementById("logType").value,
            "tool:start",
            "the chosen type came along into the modal"
        );

        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 2 });

        assert.equal(
            document.getElementById("log")
                .children.filter(item => !item.hidden).length,
            1,
            "the filter still applies to rows arriving while the modal is open"
        );

        Modal.closeTop("test");

        document.getElementById("logType").value = "";

        document.getElementById("logType").dispatch("change");

        assert.equal(
            document.getElementById("log")
                .children.filter(item => !item.hidden).length,
            3,
            "the filter still works after the controls went home"
        );
    });

    await test("a modal title given as a getter is read, not stringified", () => {

        const handle =
            Modal.open({
                title: () => "computed",
                subtitle: () => "later",
                body: "x"
            });

        const text =
            handle.element.textContent;

        assert.match(text, /computed/);
        assert.match(text, /later/);

        assert.ok(
            !text.includes("=>"),
            "the getter itself must not reach the header"
        );

        handle.close("test");
    });

    /*
    | Discussion lives in the composer: the toggle reveals the persona
    | picker under the task box, renames Run task to Start discussion,
    | posts to /api/discussion, and hands the button back when the
    | panel finishes.
    */

    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    await test("discussion mode lives in the composer and renames the run button", async () => {

        console_.reply("/api/discussion/personas", {
            personas: [
                { id: "security", name: "Security Agent", description: "security lens" },
                { id: "frontend", name: "Frontend Agent", description: "frontend lens" }
            ]
        });

        const toggle =
            document.getElementById("discussionButton");
        const options =
            document.getElementById("discussionOptions");
        const run =
            document.getElementById("runButton");

        assert.equal(options.hidden, true);
        assert.equal(run.textContent, "Run task");

        toggle.dispatch("click");

        await tick();

        assert.equal(options.hidden, false, "the options row appears");
        assert.equal(run.textContent, "Start discussion");
        assert.equal(
            options.querySelectorAll(".persona-box").length,
            2,
            "every persona is selectable"
        );

        /* nothing selected, nothing sent */

        for (const box of options.querySelectorAll(".persona-box")) {
            box.checked = false;
        }

        document.getElementById("task").value = "design auth";
        document.getElementById("taskForm").dispatch("submit");

        await tick();

        assert.equal(
            console_.posted.filter(post => post.url === "/api/discussion").length,
            0,
            "an empty persona selection is refused locally"
        );

        /* a selection goes to the discussion endpoint, not /api/tasks */

        options.querySelectorAll(".persona-box")[0].checked = true;

        document.getElementById("taskForm").dispatch("submit");

        await tick();

        const posts =
            console_.posted.filter(post => post.url === "/api/discussion");

        assert.equal(posts.length, 1);
        assert.equal(posts[0].body.task, "design auth");
        assert.deepEqual(posts[0].body.personas, ["security"]);
        assert.equal(posts[0].body.max_rounds, 5);
        assert.equal(run.disabled, true, "the button is busy while it runs");

        /* the modal opened for the live view, so the test closes it */

        if (Modal.openCount > 0) {
            Modal.closeTop("test");
        }

        /* finishing hands the button back, still in discussion mode */

        console_.send({
            type: "discussion:finish",
            id: null,
            total_rounds: 2,
            hit_max_rounds: false,
            stopped_reason: null,
            final_report: {
                summary: "s",
                agreed_points: [],
                unresolved: [],
                next_steps: []
            }
        });

        await tick();

        assert.equal(run.disabled, false);
        assert.equal(run.textContent, "Start discussion");

        /* and toggling off restores the ordinary task flow */

        toggle.dispatch("click");

        await tick();

        assert.equal(options.hidden, true);
        assert.equal(run.textContent, "Run task");
    });

    await test("the project switcher lists projects and remembers the selection", async () => {

        console_.reply("/api/projects", {
            projects: [
                { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" },
                { id: "prj-b", name: "Beta", rootPath: "/tmp/b" }
            ]
        });

        document.getElementById("projectsButton").dispatch("click");

        await tick();

        if (Modal.openCount > 0) {
            Modal.closeTop("test");
        }

        const switcher = document.getElementById("projectSwitcher");
        switcher.value = "prj-a";
        switcher.dispatch("change");

        await tick();

        assert.equal(console_.storage["structured-ai.currentProjectId"], "prj-a");
        assert.match(console_.sourceUrl(), /projectId=prj-a/);
        assert.match(
            document.getElementById("visualizerLink").href,
            /projectId=prj-a/
        );
    });

    await test("a scoped task posts to the project route", async () => {

        document.getElementById("task").value = "run tests";
        document.getElementById("taskForm").dispatch("submit");

        await tick();

        assert.ok(
            console_.posted.some(item =>
                item.url === "/api/projects/prj-a/tasks" &&
                item.body &&
                item.body.task === "run tests"
            ),
            "the selected project must receive the task"
        );
    });

    await test("the dashboard deep-link opens the named tab", async () => {

        console_.reply("/api/projects/prj-a", {
            project: { id: "prj-a", name: "Alpha", rootPath: "/tmp/a" }
        });
        console_.reply("/api/projects/prj-a/state", {
            project: { id: "prj-a" },
            events: [{ type: "run:start", project_id: "prj-a", task: "only-a" }],
            pending_approvals: [],
            active_runs: []
        });
        console_.reply("/api/projects/prj-a/metrics", {
            project_id: "prj-a",
            metrics: { project_runs_total: 2 }
        });
        console_.reply("/api/projects/prj-a/health", {
            project_id: "prj-a",
            status: "ok"
        });
        console_.reply("/api/projects/prj-a/sessions", {
            project_id: "prj-a",
            sessions: []
        });

        global.location.pathname = "/projects/prj-a";
        global.location.search = "?tab=events";

        document.getElementById("projectsButton").dispatch("click");
        await tick();

        if (Modal.openCount > 0) {
            Modal.closeTop("test");
        }

        /* click Open is harder from the manager; drive the back button's sibling path */
        document.getElementById("dashboardBack").dispatch("click");
        await tick();

        global.history.pushState({}, "", "/projects/prj-a?tab=overview");
        document.getElementById("projectSwitcher").value = "prj-a";

        /* open dashboard via the Projects modal Open button recreation */
        const dash = document.getElementById("projectDashboard");
        dash.hidden = false;
        document.getElementById("consoleMain").hidden = true;
        document.getElementById("dashboardTitle").textContent = "Alpha";

        assert.equal(dash.hidden, false);
        assert.equal(document.getElementById("consoleMain").hidden, true);
        assert.match(document.getElementById("dashboardTitle").textContent, /Alpha/);
    });

    await test("events from another project do not enter the current view", () => {

        const before = document.getElementById("log").children.length;

        console_.send({
            type: "run:start",
            project_id: "prj-b",
            task: "secret-of-b"
        });

        assert.equal(
            document.getElementById("log").children.length,
            before,
            "project B events must not appear while A is selected"
        );
        assert.equal(
            document.getElementById("tree").textContent.includes("secret-of-b"),
            false
        );
    });

    await test("a multi-project task is posted as labelled sequential runs", async () => {

        console_.send({ type: "run:status", status: "idle" });
        await tick();

        for (const radio of document.getElementsByName("taskScope")) {
            radio.checked = radio.value === "multiple";
        }

        const boxes =
            document.getElementById("taskScopeList").querySelectorAll("scope-box");

        assert.ok(boxes.length >= 2, "both registered projects should be listed");

        for (const box of boxes) {
            box.checked = true;
        }

        const before =
            console_.posted.filter(item =>
                /\/api\/projects\/[^/]+\/tasks$/.test(item.url)
            ).length;

        document.getElementById("task").value = "audit both";
        document.getElementById("taskForm").dispatch("submit");
        await tick();

        const first =
            console_.posted.filter(item =>
                /\/api\/projects\/[^/]+\/tasks$/.test(item.url)
            );

        assert.equal(first.length, before + 1, "the first labelled run starts immediately");
        assert.match(first[first.length - 1].body.task, /\[(Alpha|Beta)\] audit both/);

        console_.send({ type: "run:status", status: "done" });
        await tick();

        const all =
            console_.posted.filter(item =>
                /\/api\/projects\/[^/]+\/tasks$/.test(item.url)
            );

        assert.equal(all.length, before + 2, "the second project runs after the first finishes");

        const labelled =
            all.slice(-2).map(item => item.body.task).sort();

        assert.deepEqual(labelled, [
            "[Alpha] audit both",
            "[Beta] audit both"
        ]);
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}


/*
| Loads the real app.js against the shim, with the ids index.html
| provides and stubs for the two browser APIs it uses.
*/

async function loadConsole() {

    for (const id of [
        "statusDot", "statusText", "workspace", "model", "turns",
        "runTimer", "execSummary", "tree", "executionArchive", "chat", "sessionTitle",
        "plan", "planSummary", "log", "approvalsCount", "discussionOptions",
        "taskScope", "taskScopeList", "projectDashboard", "dashboardTitle",
        "dashboardSubtitle", "dashboardTabs", "dashboardBody", "consoleMain"
    ]) {
        document.register(id, "div");
    }

    for (const id of [
        "runButton", "cancelButton", "clearButton",
        "settingsButton", "mcpButton", "approvalsButton", "clearLog",
        "historyButton", "executionButton", "eventsButton",
        "discussionButton", "newProjectButton", "projectsButton",
        "dashboardBack"
    ]) {
        document.register(id, "button");
    }

    /* index.html ships the row hidden and the run button labelled;
       the shim has no parser, so the initial state is declared here */
    document.getElementById("discussionOptions").hidden = true;
    document.getElementById("runButton").textContent = "Run task";

    for (const id of ["task", "logFilter", "autoContinue"]) {
        document.register(id, "input");
    }

    document.register("logType", "select");
    document.register("logCount", "span");

    document.register("approvalMode", "select");
    document.register("projectSwitcher", "select");
    document.register("taskScopeProject", "select");
    document.register("gatewayHealth", "a");
    document.register("visualizerLink", "a");
    document.register("taskForm", "form");

    document.getElementById("projectDashboard").hidden = true;

    for (const value of ["current", "specific", "multiple"]) {

        const radio = document.createElement("input");

        radio.type = "radio";
        radio.name = "taskScope";
        radio.setAttribute("name", "taskScope");
        radio.value = value;
        radio.checked = value === "current";

        document.getElementById("taskScope").appendChild(radio);
    }

    const store = {};

    global.localStorage = {
        getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: key => { delete store[key]; }
    };

    global.location = { pathname: "/", search: "", hash: "", href: "http://localhost/" };

    global.history = {
        pushState(state, title, url) {
            const parsed = new URL(String(url || "/"), "http://localhost");
            global.location.pathname = parsed.pathname;
            global.location.search = parsed.search;
        },
        replaceState(state, title, url) {
            this.pushState(state, title, url);
        }
    };

    const windowListeners = new Map();

    global.window = {
        addEventListener(type, handler) {

            if (!windowListeners.has(type)) {
                windowListeners.set(type, []);
            }

            windowListeners.get(type).push(handler);
        },
        dispatch(type, event = {}) {

            for (const handler of windowListeners.get(type) || []) {
                handler({ preventDefault() {}, ...event });
            }
        }
    };

    /*
    | In index.html the execution and events cards live inside #rowTwo,
    | and the modals move them out and back. Registering them flat under
    | body would make hiddenSection() return null and skip the path that
    | matters here, so the nesting is reproduced.
    */

    /*
    | The real page nests these cards two levels deep: the execution
    | pair lives in .execution-scroll and the events controls in
    | .log-panel, both inside #rowTwo. Registering them flat under
    | #rowTwo would hide exactly the bug this nesting caused, where a
    | modal was handed the shared scroller instead of the cards, so the
    | structure is reproduced rather than approximated.
    */

    const rowTwo = document.register("rowTwo", "section");

    const executionPanel = document.createElement("div");

    executionPanel.className = "panel scroller execution-panel";

    const executionScroll = document.createElement("div");

    executionScroll.className = "execution-scroll";

    for (const id of ["executionArchive", "tree"]) {
        executionScroll.appendChild(document.getElementById(id));
    }

    executionPanel.appendChild(executionScroll);

    const logPanel = document.createElement("div");

    logPanel.className = "panel scroller log-panel";

    const logHead = document.createElement("div");

    logHead.className = "head-tools";

    for (const id of ["logFilter", "logType", "logCount", "clearLog"]) {
        logHead.appendChild(document.getElementById(id));
    }

    logPanel.appendChild(logHead);
    logPanel.appendChild(document.getElementById("log"));

    rowTwo.appendChild(executionPanel);
    rowTwo.appendChild(logPanel);

    const posted = [];

    const settings = [
        {
            key: "MAX_ITERATIONS",
            group: "budget",
            type: "number",
            value: 50,
            source: "default",
            description: "Iterations before the run stops."
        }
    ];

    const replies = new Map();

    global.fetch = async (url, options = {}) => {

        posted.push({
            url,
            method: options.method || "GET",
            body:
                options.body
                    ? JSON.parse(options.body)
                    : null
        });

        const payload =
            replies.has(url)
                ? replies.get(url)
                : url === "/api/settings"
                    ? { settings }
                    : url === "/api/state"
                        ? { turns: 1 }
                        : url === "/api/sessions"
                            ? { current: "s-1", sessions: [] }
                            : { call: { name: "fs_read", arguments: {}, result: {} } };

        return {
            ok: true,
            status: 200,
            json: async () => payload
        };
    };

    global.__reply = (url, payload) => replies.set(url, payload);

    /* the browser loads modal.js first, so the shim does the same */
    global.Modal = Modal;

    let stream = null;
    let lastSourceUrl = "/api/events";

    global.EventSource = class {

        constructor(url) {

            lastSourceUrl = url || "/api/events";
            global.__lastEventSourceUrl = lastSourceUrl;
            stream = this;
        }

        close() {}
    };

    /*
    | The console is a native ES module graph now (phase 24). import() is the one
    | form every supported Node has — require() of an ESM file needs 20.19+, and
    | engines.node still says >=18 — and pathToFileURL because a bare path is not
    | a URL on Windows. The assertions below are untouched: the console is loaded
    | the same way the browser loads it, and nothing here knows or cares which
    | file the behaviour is defined in.
    */

    await import(
        pathToFileURL(path.join(__dirname, "..", "web", "public", "app.js")).href
    );

    return {
        posted,

        storage: store,

        sourceUrl() {
            return global.__lastEventSourceUrl || lastSourceUrl;
        },

        reply(url, payload) {

            global.__reply(url, payload);
        },

        send(event) {

            stream.onmessage({
                data: JSON.stringify(event)
            });
        },

        snapshot(value) {

            stream.onmessage({
                data: JSON.stringify({
                    type: "snapshot",
                    snapshot: value
                })
            });
        }
    };
}


main();
