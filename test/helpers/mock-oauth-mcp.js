"use strict";

/*
| A remote MCP server behind OAuth 2.1, with its own authorization server
| on the same port (roadmap P4-08 tests):
|
|   /.well-known/oauth-protected-resource/mcp   resource metadata
|   /.well-known/oauth-authorization-server     RFC 8414 metadata (S256)
|   /register                                   dynamic client registration
|   /authorize                                  redirects at once with a code
|   /token                                      code (+ PKCE check) and refresh
|   /mcp                                        JSON-RPC; 401 without a token
|
| state.expireAccess() makes the current access token stale, so the next
| call is refused and the client must refresh; state.revokeRefresh()
| makes the refresh fail too (invalid_grant).
*/

const crypto = require("crypto");
const http = require("http");


function startOAuthMcp() {

    const state = {
        clients: new Map(),
        codes: new Map(),
        access: new Set(),
        refresh: new Set(),
        log: [],
        expireAccess() { state.access.clear(); },
        revokeRefresh() { state.refresh.clear(); }
    };

    let base = null;

    const readBody = req => new Promise(resolve => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => resolve(body));
    });

    const json = (res, status, value, headers = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(value));
    };

    const issue = () => {
        const access = crypto.randomBytes(12).toString("hex");
        const refresh = crypto.randomBytes(12).toString("hex");
        state.access.add(access);
        state.refresh.add(refresh);
        return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600 };
    };

    const server = http.createServer(async (req, res) => {

        const url = new URL(req.url, base);
        state.log.push(`${req.method} ${url.pathname}`);

        if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
            return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["mcp"] });
        }

        if (url.pathname === "/.well-known/oauth-authorization-server") {
            return json(res, 200, {
                issuer: base,
                authorization_endpoint: `${base}/authorize`,
                token_endpoint: `${base}/token`,
                registration_endpoint: `${base}/register`,
                code_challenge_methods_supported: ["S256"],
                token_endpoint_auth_methods_supported: ["none"]
            });
        }

        if (url.pathname === "/register" && req.method === "POST") {
            const body = JSON.parse(await readBody(req));
            const clientId = `client-${state.clients.size + 1}`;
            state.clients.set(clientId, body);
            return json(res, 201, { client_id: clientId, redirect_uris: body.redirect_uris, token_endpoint_auth_method: "none" });
        }

        if (url.pathname === "/authorize") {
            const params = url.searchParams;
            const client = state.clients.get(params.get("client_id"));
            if (!client || !client.redirect_uris.includes(params.get("redirect_uri")) || params.get("code_challenge_method") !== "S256") {
                return json(res, 400, { error: "invalid_request" });
            }
            const code = crypto.randomBytes(8).toString("hex");
            state.codes.set(code, { challenge: params.get("code_challenge"), redirect: params.get("redirect_uri"), client: params.get("client_id"), resource: params.get("resource") });
            const target = new URL(params.get("redirect_uri"));
            target.searchParams.set("code", code);
            target.searchParams.set("state", params.get("state"));
            res.writeHead(302, { location: target.toString() });
            return res.end();
        }

        if (url.pathname === "/token" && req.method === "POST") {
            const form = new URLSearchParams(await readBody(req));
            if (form.get("grant_type") === "authorization_code") {
                const grant = state.codes.get(form.get("code"));
                state.codes.delete(form.get("code"));
                const challenge = crypto.createHash("sha256").update(form.get("code_verifier") || "").digest("base64url");
                if (!grant || grant.challenge !== challenge || grant.redirect !== form.get("redirect_uri") || grant.client !== form.get("client_id")) {
                    return json(res, 400, { error: "invalid_grant", error_description: "code, verifier or redirect mismatch" });
                }
                return json(res, 200, issue());
            }
            if (form.get("grant_type") === "refresh_token") {
                if (!state.refresh.has(form.get("refresh_token"))) return json(res, 400, { error: "invalid_grant" });
                state.refresh.delete(form.get("refresh_token"));
                return json(res, 200, issue());
            }
            return json(res, 400, { error: "unsupported_grant_type" });
        }

        if (url.pathname === "/mcp" && req.method === "POST") {

            const token = /^Bearer (.+)$/.exec(req.headers.authorization || "");

            if (!token || !state.access.has(token[1])) {
                return json(res, 401, { error: "invalid_token" }, {
                    "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`
                });
            }

            const message = JSON.parse(await readBody(req));

            if (message.id === undefined) {
                res.writeHead(202);
                return res.end();
            }

            const results = {
                initialize: { protocolVersion: (message.params || {}).protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "oauth-mock", version: "1" } },
                "tools/list": { tools: [{ name: "whoami", description: "who is signed in", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] },
                "tools/call": { content: [{ type: "text", text: "signed-in user" }] },
                ping: {}
            };

            if (!results[message.method]) {
                return json(res, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not found" } });
            }

            return json(res, 200, { jsonrpc: "2.0", id: message.id, result: results[message.method] });
        }

        if (url.pathname === "/mcp") {
            res.writeHead(405);
            return res.end();
        }

        json(res, 404, { error: "not found" });
    });

    return new Promise(resolve => {
        server.listen(0, "127.0.0.1", () => {
            base = `http://127.0.0.1:${server.address().port}`;
            resolve({ base, url: `${base}/mcp`, state, close: () => new Promise(done => server.close(() => done())) });
        });
    });
}


module.exports = { startOAuthMcp };
