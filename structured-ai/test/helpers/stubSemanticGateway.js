const http = require("http");


/*
|--------------------------------------------------------------------------|
| Stub Semantic Gateway (test-only)                                        |
|--------------------------------------------------------------------------|
|
| EXECUTION_PLAN, Phase 6 گام ۴: the engine-side Worker Supervisor /
| Gateway described in MULTI_PROJECT_GATEWAY_PLAN.md is not implemented
| yet (recorded decision, 2026-08-25). This stub serves the contract the
| agent runtime depends on — POST /mcp/:projectId speaking MCP over
| Streamable HTTP (initialize, tools/list, tools/call) — so pool
| development and isolation tests are not blocked on the real gateway.
|
| It is deliberately minimal:
|
|   - at least two project ids can be registered, each with its OWN
|     answers, so a routing bug shows up as cross-contaminated symbols;
|   - every tool result carries additive markers { projectId,
|     indexGeneration } in structuredContent, mirroring the gateway
|     plan's "پاسخ شامل projectId و indexGeneration" rule;
|   - unknown urls/methods fail with plain HTTP errors, never with a
|     made-up success;
|   - request counts are exposed per project per tool so cache tests
|     can tell a memoized call from a fresh request.
|
| Production never loads this file (it lives under test/).
|--------------------------------------------------------------------------
*/

function createStubSemanticGateway(projects) {

    const registry =

        new Map(
            Object.entries(projects || {}).map(
                ([projectId, spec]) => [
                    projectId,
                    {
                        tools: spec.tools || [],
                        handlers: spec.handlers || {},
                        generation:
                            spec.generation !== undefined
                                ? spec.generation
                                : 1,
                        counts: new Map()
                    }
                ]
            )
        );


    function answer(projectId, message) {

        const project = registry.get(projectId);

        if (message.method === "initialize") {

            return {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: {
                    name: "stub-semantic-gateway",
                    version: "0.1.0",
                    projectId
                }
            };

        }

        if (message.method === "tools/list") {

            return { tools: project.tools };

        }

        if (message.method === "tools/call") {

            const name =
                (message.params && message.params.name) || "";

            const params =
                (message.params && message.params.arguments) || {};

            project.counts.set(
                name,
                (project.counts.get(name) || 0) + 1
            );

            const handler = project.handlers[name];

            const payload =

                handler
                    ? handler(params, projectId)
                    : {
                          ok: false,
                          error:
                              `stub gateway has no handler for "${name}" ` +
                              `on project "${projectId}"`
                      };

            return {
                structuredContent: {
                    projectId,
                    indexGeneration: project.generation,
                    ...(payload && typeof payload === "object"
                        ? payload
                        : { value: payload })
                }
            };

        }

        const error = new Error(`stub gateway cannot serve "${message.method}"`);

        error.statusCode = 400;

        throw error;

    }


    const server =

        http.createServer((req, res) => {

            const parsed =

                new URL(req.url || "/", "http://stub-semantic-gateway");

            const match =

                /^\/mcp\/([^/]+)\/?$/.exec(parsed.pathname);

            if (req.method !== "POST" || !match) {

                res.writeHead(404, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: "not found" }));

                return;

            }

            const projectId = decodeURIComponent(match[1]);

            if (!registry.has(projectId)) {

                res.writeHead(404, { "content-type": "application/json" });
                res.end(
                    JSON.stringify({
                        error: `unknown project "${projectId}"`
                    })
                );

                return;

            }

            let body = "";

            req.on("data", chunk => (body += chunk));

            req.on("end", () => {

                let message;

                try {

                    message = JSON.parse(body || "{}");

                } catch {

                    res.writeHead(400, { "content-type": "application/json" });
                    res.end(JSON.stringify({ error: "body is not JSON" }));

                    return;

                }

                /* A notification has no id and gets no response body —
                   exactly what the transport's readJson path treats as a
                   quiet 202. */
                if (message.id === undefined || message.id === null) {

                    res.writeHead(202);
                    res.end();

                    return;

                }

                try {

                    const result = answer(projectId, message);

                    res.writeHead(200, { "content-type": "application/json" });
                    res.end(
                        JSON.stringify({
                            jsonrpc: "2.0",
                            id: message.id,
                            result
                        })
                    );

                } catch (error) {

                    res.writeHead(error.statusCode || 500, {
                        "content-type": "application/json"
                    });
                    res.end(JSON.stringify({ error: error.message }));

                }

            });

        });


    function listen() {

        return new Promise(resolve => {

            server.listen(0, "127.0.0.1", () => resolve(gateway));

        });

    }


    const gateway = {

        server,

        listen,

        close() {

            return new Promise(resolve => server.close(resolve));

        },

        port() {

            const address = server.address();

            return address ? address.port : null;

        },

        /* The endpoint a registry record would carry for this project —
           changing it later is a registry data edit, not a client code
           change (acceptance of گام ۴). */
        endpointFor(projectId) {

            return `http://127.0.0.1:${this.port()}/mcp/${encodeURIComponent(projectId)}`;

        },

        /* How often the worker actually saw this tool for this project;
           the difference between "cached" and "fresh" in pool tests. */
        callCount(projectId, toolName) {

            const project = registry.get(projectId);

            return project ? project.counts.get(toolName) || 0 : 0;

        },

        /* Simulate the worker reindexing: every subsequent answer from
           this project reports the new generation, which is what a pool
           client must react to by dropping cached results. */
        bumpIndexGeneration(projectId) {

            const project = registry.get(projectId);

            if (!project) {

                throw new Error(`unknown stub project "${projectId}"`);

            }

            project.generation += 1;

            return project.generation;

        }

    };


    return gateway;

}


module.exports = {
    createStubSemanticGateway
};
