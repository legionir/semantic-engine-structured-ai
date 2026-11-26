"use strict";

/*
| The login gate in front of the console (web/public/auth-gate.js)
|
| Runs inside reactive.test.js. Every case gets a fresh page built from
| index.html and runs the real script with that page's document, fetch
| and window, so nothing leaks into the console the other groups boot.
| The script's one `import("/app/main.js")` is swapped for a spy: the
| test fails if that line ever changes rather than silently skipping.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const harness = require("../harness");

const SOURCE = fs.readFileSync(path.join(harness.PUBLIC_DIR, "auth-gate.js"), "utf8");
const IMPORT = "import(\"/app/main.js\")";
/* index.html's inline head script hides the page until the gate decides */
const PENDING = (/<script>([^<]*auth-pending[^<]*)<\/script>/.exec(
    fs.readFileSync(path.join(harness.PUBLIC_DIR, "index.html"), "utf8")
) || [])[1];


function page(replies) {

    const window = harness.createWindow();
    const document = window.document;
    assert.ok(PENDING, "index.html marks the page auth-pending before anything draws");
    new Function("document", PENDING)(document);
    document.body.innerHTML = harness.pageBody();

    const calls = [];
    const fetch = async (url, options = {}) => {
        calls.push({ url, options });
        const reply = replies[url];
        const value = typeof reply === "function" ? reply(options) : reply;
        if (value instanceof Error) throw value;
        const { status = 200, body = {} } = value || {};
        return { ok: status >= 200 && status < 300, status, json: async () => body };
    };

    const state = { imported: 0, reloaded: 0 };
    const fakeWindow = { location: { reload: () => { state.reloaded++; } } };
    const byId = id => document.getElementById(id);

    const run = () => {
        assert.equal(SOURCE.split(IMPORT).length, 2, "auth-gate.js imports the console exactly once");
        const body = SOURCE.replace(IMPORT, "__importConsole()");
        return new Function("document", "fetch", "window", "__importConsole", `return ${body.replace(/^"use strict";\s*/, "")}`)(
            document, fetch, fakeWindow, async () => { state.imported++; }
        );
    };

    const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

    const submit = async value => {
        byId("consolePassword").value = value;
        byId("consoleLoginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
        await settle();
    };

    const loginShown = () =>
        !byId("consoleLogin").hidden &&
        byId("consoleMain").hidden &&
        byId("projectBar").hidden &&
        byId("projectDashboard").hidden &&
        document.querySelector("header").hidden;

    return { window, document, calls, state, byId, run, settle, submit, loginShown };
}


module.exports = async function AuthGate({ test }) {

    await test("without a password the gate loads the console and never shows the login", async () => {

        const p = page({ "/auth/status": { body: { passwordRequired: false } } });
        assert.ok(p.document.documentElement.classList.contains("auth-pending"), "the page starts pending");

        await p.run();
        await p.settle();

        assert.equal(p.state.imported, 1);
        assert.equal(p.document.documentElement.classList.contains("auth-pending"), false);
        assert.equal(p.byId("consoleLogin").hidden, true);
        assert.deepEqual(p.calls[0].options, { cache: "no-store", credentials: "same-origin" });
    });

    await test("an authenticated session goes straight to the console", async () => {

        const p = page({ "/auth/status": { body: { passwordRequired: true, authenticated: true } } });
        await p.run();
        await p.settle();

        assert.equal(p.state.imported, 1);
        assert.equal(p.loginShown(), false);
    });

    await test("a required password shows only the login, and a wrong one says why and clears the field", async () => {

        const p = page({
            "/auth/status": { body: { passwordRequired: true, authenticated: false } },
            "/auth/login": { status: 401, body: { error: "wrong password" } }
        });
        await p.run();
        await p.settle();

        assert.equal(p.state.imported, 0, "the console is not loaded behind the login");
        assert.ok(p.loginShown());
        assert.equal(p.byId("consoleLoginError").hidden, true, "no error before a try");

        await p.submit("guess");

        const login = p.calls.find(call => call.url === "/auth/login");
        assert.equal(login.options.method, "POST");
        assert.equal(login.options.credentials, "same-origin");
        assert.deepEqual(JSON.parse(login.options.body), { password: "guess" });
        assert.equal(p.byId("consoleLoginError").textContent, "wrong password");
        assert.equal(p.byId("consoleLoginError").hidden, false);
        assert.equal(p.byId("consolePassword").value, "", "a refused password is not left in the field");
        assert.equal(p.byId("consoleLoginButton").disabled, false, "the button is usable again");
        assert.equal(p.state.reloaded, 0);
        assert.equal(p.state.imported, 0);
    });

    await test("a refusal without a reason and a network failure both still say something", async () => {

        const p = page({
            "/auth/status": { body: { passwordRequired: true, authenticated: false } },
            "/auth/login": { status: 500, body: {} }
        });
        await p.run();
        await p.settle();

        await p.submit("x");
        assert.equal(p.byId("consoleLoginError").textContent, "Sign-in failed.");

        const offline = page({
            "/auth/status": { body: { passwordRequired: true, authenticated: false } },
            "/auth/login": new Error("network down")
        });
        await offline.run();
        await offline.settle();
        await offline.submit("x");
        assert.equal(offline.byId("consoleLoginError").textContent, "network down");
    });

    await test("the right password reloads the page instead of loading the console in place", async () => {

        const p = page({
            "/auth/status": { body: { passwordRequired: true, authenticated: false } },
            "/auth/login": { status: 200, body: { ok: true } }
        });
        await p.run();
        await p.settle();
        await p.submit("correct horse");

        assert.equal(p.state.reloaded, 1);
        assert.equal(p.state.imported, 0);
        assert.equal(p.byId("consoleLoginError").hidden, true);
    });

    await test("when the status check fails the login says so instead of a blank page", async () => {

        const failing = page({ "/auth/status": { status: 503 } });
        await failing.run();
        await failing.settle();

        assert.equal(failing.state.imported, 0);
        assert.ok(failing.loginShown());
        assert.equal(failing.document.documentElement.classList.contains("auth-pending"), false);
        assert.equal(failing.byId("consoleLoginError").textContent, "Could not check console authentication.");

        const offline = page({ "/auth/status": new Error("") });
        await offline.run();
        await offline.settle();
        assert.equal(offline.byId("consoleLoginError").textContent, "Console startup failed. Refresh to try again.");
    });
};
