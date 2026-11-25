"use strict";

/*
| mcp.test.js: policy
|
| Runs inside mcp.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function policyCases(ctx) {

    const {
        WORKSPACE,
        cleanups,
        settings,
        test,
        tools,
        writeStdioServer
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\npolicy");

    await test("a restricted server needs approval, a default one does not", async () => {

        const { PolicyEngine } = require("../../../agent/policy");

        const engine =
            new PolicyEngine({
                policy: require("../../../agent/registry/policy.json"),
                toolGroups: require("../../../agent/registry/tool_groups.json")
            });

        const manager = tools.mcp._manager;

        await manager.add(
            "guarded",
            {
                command: writeStdioServer({}),
                cwd: WORKSPACE,
                trust: "restricted"
            },
            { persist: false }
        );

        assert.equal(
            engine.evaluate("mcp__guarded__echo", {}, "main_agent").decision,
            "require_approval"
        );

        assert.equal(
            engine.evaluate("mcp__reported__echo", {}, "main_agent").decision,
            "allow"
        );

        /* inspection is free whatever the servers are */

        assert.equal(
            engine.evaluate("mcp_servers", {}, "main_agent").decision,
            "allow"
        );

        /* and connecting a new server always asks */

        assert.equal(
            engine.evaluate("mcp_add", {}, "main_agent").decision,
            "require_approval"
        );

        await manager.remove("guarded", { persist: false });
    });

    await test("MCP_APPROVAL can tighten every call, and never loosens a denial", async () => {

        const { PolicyEngine } = require("../../../agent/policy");

        const engine =
            new PolicyEngine({
                policy: require("../../../agent/registry/policy.json"),
                toolGroups: require("../../../agent/registry/tool_groups.json")
            });

        settings.set("MCP_APPROVAL", "always");

        assert.equal(
            engine.evaluate("mcp_call", {}, "main_agent").decision,
            "require_approval"
        );

        assert.equal(
            engine.evaluate("mcp__reported__echo", {}, "main_agent").decision,
            "require_approval"
        );

        /* a built-in tool is unaffected by an MCP setting */

        assert.equal(
            engine.evaluate("fs_read", {}, "main_agent").decision,
            "allow"
        );

        settings.set("MCP_APPROVAL", "never");

        assert.equal(
            engine.evaluate("mcp_call", {}, "main_agent").decision,
            "allow"
        );

        settings.reset("MCP_APPROVAL");
    });

    /* ---------------------------------------------------------------- */

    for (const cleanup of cleanups.reverse()) {

        try {

            await cleanup();

        } catch {
            /* a server that is already down needs no help */
        }
    }

    await tools.mcp._shutdown();
};
