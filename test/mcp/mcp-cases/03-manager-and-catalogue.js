"use strict";

/*
| mcp.test.js: manager and catalogue, the runtime's own tools
|
| Runs inside mcp.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function managerAndCatalogueCases(ctx) {

    const {
        WORKSPACE,
        freshManager,
        settings,
        startHttpServer,
        test,
        tools,
        writeStdioServer
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nmanager and catalogue");

    await test("tools from several servers are namespaced instead of shadowing", async () => {

        const server =
            await startHttpServer({ name: "remote" });

        const manager = freshManager();

        await manager.add(
            "alpha",
            { url: `http://127.0.0.1:${server.port}/mcp` },
            { persist: false }
        );

        await manager.add(
            "beta",
            { command: writeStdioServer({ name: "beta-server" }), cwd: WORKSPACE },
            { persist: false }
        );

        const names =
            manager.catalogueEntries().map(entry => entry.name).sort();

        assert.deepEqual(
            names,
            [
                "mcp__alpha__add",
                "mcp__alpha__echo",
                "mcp__beta__add",
                "mcp__beta__echo"
            ]
        );

        /* each namespaced name reaches its own server, not the other one */

        assert.equal(
            (await manager.callTool("mcp__alpha__echo", { message: "a" })).via,
            "remote"
        );

        assert.equal(
            (await manager.callTool("mcp__beta__echo", { message: "b" })).via,
            "beta-server"
        );

        await manager.shutdown();

        await server.close();
    });

    await test("include and exclude decide what the model is allowed to see", async () => {

        const manager = freshManager();

        await manager.add(
            "narrow",
            {
                command: writeStdioServer({}),
                cwd: WORKSPACE,
                include: ["echo"]
            },
            { persist: false }
        );

        assert.deepEqual(
            manager.catalogueEntries().map(entry => entry.tool),
            ["echo"]
        );

        /* and a filtered tool cannot be reached around the catalogue */

        await assert.rejects(
            () => manager.call("narrow", "add", { a: 1, b: 1 }),
            /filtered out/
        );

        await manager.shutdown();
    });

    await test("a published schema becomes a tool declaration the endpoint accepts", async () => {

        const manager = freshManager();

        await manager.add(
            "declared",
            { command: writeStdioServer({}), cwd: WORKSPACE },
            { persist: false }
        );

        const declaration =
            manager.toolDeclarations().find(
                tool => tool.function.name === "mcp__declared__add"
            );

        assert.equal(declaration.type, "function");
        assert.match(declaration.function.description, /\[MCP declared\]/);
        assert.equal(declaration.function.parameters.type, "object");
        assert.deepEqual(
            declaration.function.parameters.required,
            ["a", "b"]
        );
        assert.ok(declaration.function.parameters.properties.a);

        await manager.shutdown();
    });

    await test("a server that will not connect is left out, and the rest still work", async () => {

        const manager = freshManager();

        await manager.add(
            "working",
            { command: writeStdioServer({}), cwd: WORKSPACE },
            { persist: false }
        );

        /*
        | Added straight into the table, the way a configuration file
        | does it: a definition that was never proved reachable.
        */

        const { McpClient: Client } = require("../../../agent/mcp/McpConnection");

        manager.clients.set(
            "broken",
            new Client({
                name: "broken",
                transport: "http",
                url: "http://127.0.0.1:1/mcp",
                enabled: true
            })
        );

        const discovered =
            await manager.discover({ force: true });

        assert.deepEqual(
            discovered.map(entry => entry.server),
            ["working", "working"]
        );

        const status = manager.status();

        assert.equal(
            status.servers.find(server => server.name === "broken").state,
            "failed"
        );

        await manager.shutdown();
    });

    await test("a server added at runtime is written down for the next run", async () => {

        const manager = freshManager();

        const command =
            writeStdioServer({ name: "persisted-server" });

        await manager.add(
            "saved",
            { command, cwd: WORKSPACE },
            { persist: true }
        );

        const file =
            path.join(WORKSPACE, ".agent", "mcp.json");

        const written =
            JSON.parse(fs.readFileSync(file, "utf8"));

        assert.equal(written.mcpServers.saved.command, command);
        assert.equal(written.mcpServers.saved.transport, "stdio");

        await manager.remove("saved", { persist: true });

        assert.equal(
            JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.saved,
            undefined
        );

        await manager.shutdown();
    });

    await test("removing a server withdraws its tools immediately", async () => {

        const manager = freshManager();

        await manager.add(
            "temporary",
            { command: writeStdioServer({}), cwd: WORKSPACE },
            { persist: false }
        );

        assert.equal(manager.catalogueEntries().length, 2);

        await manager.remove("temporary", { persist: false });

        assert.equal(manager.catalogueEntries().length, 0);
        assert.equal(manager.hasTool("mcp__temporary__echo"), false);

        await assert.rejects(
            () => manager.callTool("mcp__temporary__echo", {}),
            /no MCP server called "temporary"/
        );

        await manager.shutdown();
    });

    /* ---------------------------------------------------------------- */
    console.log("\nthe runtime's own tools");

    await test("mcp_servers reports what is configured and why one is not connected", async () => {

        const manager = tools.mcp._manager;

        await manager.add(
            "reported",
            { command: writeStdioServer({ name: "reported-server" }), cwd: WORKSPACE },
            { persist: false }
        );

        const report =
            await tools.executeTool("mcp_servers", {}, { agent: "test" });

        assert.equal(report.enabled, true);
        assert.deepEqual(
            report.supported_transports.sort(),
            ["http", "sse", "stdio", "websocket"]
        );

        const entry =
            report.servers.find(server => server.name === "reported");

        assert.equal(entry.state, "ready");
        assert.equal(entry.transport, "stdio");
        assert.equal(entry.tool_count, 2);
        assert.equal(entry.server_name, "reported-server");
    });

    await test("mcp_tools lists the catalogue with the parameters each tool wants", async () => {

        const listed =
            await tools.executeTool(
                "mcp_tools",
                { server: "reported" },
                { agent: "test" }
            );

        assert.equal(listed.total, 2);

        const add =
            listed.tools.find(tool => tool.tool === "add");

        assert.equal(add.name, "mcp__reported__add");
        assert.deepEqual(add.parameters.sort(), ["a", "b"]);
        assert.deepEqual(add.required.sort(), ["a", "b"]);
    });

    await test("mcp_call reaches a server both by name and by namespaced tool", async () => {

        const byPair =
            await tools.executeTool(
                "mcp_call",
                {
                    server: "reported",
                    tool: "echo",
                    arguments: { message: "through the gateway" }
                },
                { agent: "test" }
            );

        assert.equal(byPair.ok, true);
        assert.equal(byPair.result.echoed, "through the gateway");

        const byName =
            await tools.executeTool(
                "mcp_call",
                {
                    tool: "mcp__reported__add",
                    arguments: { a: 4, b: 4 }
                },
                { agent: "test" }
            );

        assert.equal(byName.ok, true);
        assert.equal(byName.result.sum, 8);
    });

    await test("a discovered tool is callable by its own name, like any other tool", async () => {

        assert.equal(tools.hasTool("mcp__reported__echo"), true);

        assert.ok(
            tools.callableToolNames().includes("mcp__reported__echo")
        );

        const result =
            await tools.executeTool(
                "mcp__reported__echo",
                { message: "called directly" },
                { agent: "test" }
            );

        assert.equal(result.ok, true);
        assert.equal(result.result.echoed, "called directly");

        /* and the runtime counted it, the same as a built-in tool */

        assert.ok(
            tools.telemetry
                .executedToolNames()
                .includes("mcp__reported__echo")
        );
    });

    await test("a failing MCP call is reported, never thrown into the run", async () => {

        const result =
            await tools.executeTool(
                "mcp_call",
                { server: "reported", tool: "does_not_exist", arguments: {} },
                { agent: "test" }
            );

        assert.equal(result.ok, false);
        assert.match(result.error, /unknown tool/);

        const missingServer =
            await tools.executeTool(
                "mcp_call",
                { server: "never_configured", tool: "echo" },
                { agent: "test" }
            );

        assert.equal(missingServer.ok, false);
        assert.match(missingServer.error, /no MCP server called/);
    });

    await test("turning MCP off withdraws every server and its tools", async () => {

        settings.set("MCP_ENABLED", false);

        const report =
            await tools.executeTool("mcp_servers", {}, { agent: "test" });

        assert.equal(report.enabled, false);

        const listed =
            await tools.executeTool("mcp_tools", {}, { agent: "test" });

        assert.equal(listed.ok, false);
        assert.match(listed.error, /disabled/);

        settings.reset("MCP_ENABLED");
    });
};
