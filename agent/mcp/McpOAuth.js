"use strict";

/*
|--------------------------------------------------------------------------
| OAuth 2.1 for remote MCP servers (roadmap P4-08)
|--------------------------------------------------------------------------
|
| The MCP authorization specification, from the console:
|
|   1. discovery    the server's protected-resource metadata (RFC 9728:
|                   the WWW-Authenticate resource_metadata, else
|                   /.well-known/oauth-protected-resource), then its
|                   authorization server's metadata (RFC 8414, or OpenID
|                   discovery); a server without either gets the 2025-03-26
|                   defaults /authorize, /token, /register on its origin
|   2. registration dynamic client registration (RFC 7591) as a public
|                   client, unless the definition names a client_id
|   3. sign-in      authorization code with PKCE (S256) and state; the
|                   provider redirects to <console>/api/mcp/oauth/callback;
|                   the resource indicator (RFC 8707) names the server
|   4. tokens       kept in the secret store (encrypted, masked in every
|                   answer): the access token, the refresh token and a
|                   client secret if one was issued; the rest (client id,
|                   endpoints, expiry) in <data home>/mcp-oauth.json
|   5. refresh      an access token that expires within a minute, or that
|                   a 401 rejects, is refreshed without asking anyone; a
|                   refresh the provider refuses means signing in again
|
| providerFor(config) is what HttpTransport asks for a token.
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const settings = require("../config");
const { httpTransport } = require("../providers/HttpTransport");

const CLIENT_NAME = "structured-ai";
const oauthTimeoutMs = () => Math.max(1000, Math.min(Number(settings.get("MAX_REQUEST_MS")) || 15000, 15000));
const maxResponseBytes = () => 262144;
const expiryMarginMs = () => settings.get("MCP_OAUTH_REFRESH_MARGIN_MS");
const flowTtlMs = () => settings.get("MCP_OAUTH_FLOW_TTL_MS");

const flows = new Map();
const refreshing = new Map();


/* ------------------------------------------------------------- storage */

function metadataFile() {

    return path.join(require("../projects/ProjectStore").resolveDataHome(), "mcp-oauth.json");
}


function readMetadata() {

    try {
        const document = JSON.parse(fs.readFileSync(metadataFile(), "utf8"));
        return document && typeof document.servers === "object" && document.servers ? document.servers : {};
    } catch {
        return {};
    }
}


function writeMetadata(servers) {

    const file = metadataFile();

    fs.mkdirSync(path.dirname(file), { recursive: true });
    require("./McpConfigLoader").writePrivateFile(file, `${JSON.stringify({ servers }, null, 2)}\n`);
}


function metadataOf(server) {

    return readMetadata()[server] || null;
}


function saveMetadata(server, patch) {

    const all = readMetadata();

    all[server] = { ...(all[server] || {}), ...patch };

    writeMetadata(all);

    return all[server];
}


/* a secret-store name per server and kind: MCP_OAUTH_<SERVER>_<KIND> */
function secretName(server, kind) {

    let stem = String(server).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

    if (stem.length > 36) {
        stem = `${stem.slice(0, 27)}_${crypto.createHash("sha256").update(String(server)).digest("hex").slice(0, 8).toUpperCase()}`;
    }

    return `MCP_OAUTH_${stem || "SERVER"}_${kind}`;
}


function store() {

    return require("../secrets/SecretStore");
}


function readSecret(server, kind) {

    try {
        return store().resolve(secretName(server, kind));
    } catch {
        return null;
    }
}


function writeSecret(server, kind, value) {

    const name = secretName(server, kind);

    if (value) store().set(name, value);
    else if (store().has(name)) store().remove(name);
}


/* --------------------------------------------------------------- http */

function assertHttpUrl(rawUrl, label = "OAuth endpoint") {

    let parsed;

    try {
        parsed = new URL(String(rawUrl));
    } catch {
        throw Object.assign(new Error(`${label} is not a valid URL`), { status: 400 });
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw Object.assign(new Error(`${label} must use http or https`), { status: 400 });
    }

    return parsed.href;
}


function parseBoundedJson(text, label = "OAuth response") {

    const raw = String(text || "");

    if (Buffer.byteLength(raw, "utf8") > maxResponseBytes()) {
        throw Object.assign(new Error(`${label} exceeded maximum allowed size`), { status: 502 });
    }

    return JSON.parse(raw);
}


async function getJson(url) {

    let safeUrl;

    try {
        safeUrl = assertHttpUrl(url, "OAuth metadata endpoint");
    } catch {
        return null;
    }

    let response;

    try {
        response = await httpTransport.request({
            url: safeUrl,
            method: "GET",
            headers: { accept: "application/json", "mcp-protocol-version": "2025-06-18" },
            timeoutMs: oauthTimeoutMs()
        });
    } catch {
        return null;
    }

    if (response.status < 200 || response.status >= 300) return null;

    try {
        return parseBoundedJson(await response.text(), "OAuth metadata");
    } catch {
        return null;
    }
}


async function postForm(url, fields, { clientId, clientSecret, authMethod } = {}) {

    const safeUrl = assertHttpUrl(url, "token endpoint");
    const body = new URLSearchParams();
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };

    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
    }

    if (clientSecret && authMethod === "client_secret_basic") {
        headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
    } else {
        body.set("client_id", clientId);
        if (clientSecret) body.set("client_secret", clientSecret);
    }

    const response = await httpTransport.request({
        url: safeUrl,
        method: "POST",
        headers,
        body: body.toString(),
        timeoutMs: oauthTimeoutMs()
    });
    const text = await response.text();
    let payload = null;

    try {
        payload = parseBoundedJson(text, "token response");
    } catch {
        payload = null;
    }

    if (response.status < 200 || response.status >= 300 || !payload || !payload.access_token) {
        const reason = payload && (payload.error_description || payload.error) ? `${payload.error}${payload.error_description ? `: ${payload.error_description}` : ""}` : `HTTP ${response.status}`;
        throw Object.assign(new Error(`the token endpoint refused the request (${reason})`), { status: 502, oauthError: payload && payload.error });
    }

    return payload;
}


/* -------------------------------------------------------------- discovery */

function resourceMetadataFrom(wwwAuthenticate) {

    const match = /resource_metadata="([^"]+)"/i.exec(String(wwwAuthenticate || ""));

    return match ? match[1] : null;
}


/* the server URL without fragment, as the resource indicator (RFC 8707) */
function canonicalResource(serverUrl) {

    const url = new URL(serverUrl);

    url.hash = "";

    return url.toString().replace(/\/$/, "");
}


async function discover(serverUrl, { wwwAuthenticate = null, authorizationServer = null } = {}) {

    const server = new URL(serverUrl);
    const candidates = [];
    const hinted = resourceMetadataFrom(wwwAuthenticate);

    if (hinted) candidates.push(hinted);

    const pathPart = server.pathname.replace(/\/$/, "");

    if (pathPart) candidates.push(`${server.origin}/.well-known/oauth-protected-resource${pathPart}`);

    candidates.push(`${server.origin}/.well-known/oauth-protected-resource`);

    let resourceMetadata = null;

    for (const candidate of candidates) {
        resourceMetadata = await getJson(candidate);
        if (resourceMetadata && Array.isArray(resourceMetadata.authorization_servers)) break;
        resourceMetadata = null;
    }

    const issuer =
        authorizationServer ||
        (resourceMetadata && resourceMetadata.authorization_servers[0]) ||
        server.origin;

    const issuerUrl = new URL(issuer);
    const issuerPath = issuerUrl.pathname.replace(/\/$/, "");
    const asCandidates = [
        `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerPath}`,
        ...(issuerPath ? [`${issuerUrl.origin}/.well-known/oauth-authorization-server`] : []),
        `${issuerUrl.origin}/.well-known/openid-configuration${issuerPath}`,
        ...(issuerPath ? [`${issuerUrl.origin}${issuerPath}/.well-known/openid-configuration`] : [])
    ];

    let metadata = null;

    for (const candidate of asCandidates) {
        metadata = await getJson(candidate);
        if (metadata && metadata.authorization_endpoint && metadata.token_endpoint) break;
        metadata = null;
    }

    if (!metadata) {
        /* 2025-03-26: the defaults on the server's own origin */
        metadata = {
            issuer: issuerUrl.origin,
            authorization_endpoint: `${issuerUrl.origin}/authorize`,
            token_endpoint: `${issuerUrl.origin}/token`,
            registration_endpoint: `${issuerUrl.origin}/register`,
            fallback: true
        };
    }

    if (Array.isArray(metadata.code_challenge_methods_supported) && !metadata.code_challenge_methods_supported.includes("S256")) {
        throw Object.assign(new Error(`the authorization server ${metadata.issuer || issuer} does not support PKCE with S256, which OAuth 2.1 requires`), { status: 502 });
    }

    return {
        resource: (resourceMetadata && resourceMetadata.resource) || canonicalResource(serverUrl),
        scopes_supported: (resourceMetadata && resourceMetadata.scopes_supported) || metadata.scopes_supported || null,
        issuer: metadata.issuer || issuer,
        authorization_endpoint: assertHttpUrl(metadata.authorization_endpoint, "authorization_endpoint"),
        token_endpoint: assertHttpUrl(metadata.token_endpoint, "token_endpoint"),
        registration_endpoint: metadata.registration_endpoint ? assertHttpUrl(metadata.registration_endpoint, "registration_endpoint") : null,
        token_endpoint_auth_methods: metadata.token_endpoint_auth_methods_supported || null
    };
}


async function register(endpoints, redirectUri, scopes) {

    if (!endpoints.registration_endpoint) {
        throw Object.assign(
            new Error("the authorization server offers no dynamic client registration; add oauth.client_id (and client_secret) to the server's definition"),
            { status: 400 }
        );
    }

    let response;

    try {
        response = await httpTransport.request({
            url: assertHttpUrl(endpoints.registration_endpoint, "registration endpoint"),
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
                client_name: CLIENT_NAME,
                redirect_uris: [redirectUri],
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none",
                ...(scopes && scopes.length ? { scope: scopes.join(" ") } : {})
            }),
            timeoutMs: oauthTimeoutMs()
        });
    } catch (error) {
        throw Object.assign(new Error(`client registration failed: ${error.message}`), { status: 502 });
    }

    let payload = null;
    try {
        payload = parseBoundedJson(await response.text(), "registration response");
    } catch {
        payload = null;
    }

    if (response.status < 200 || response.status >= 300 || !payload || !payload.client_id) {
        throw Object.assign(
            new Error(`client registration was refused (${payload && (payload.error_description || payload.error) || `HTTP ${response.status}`})`),
            { status: 502 }
        );
    }

    return payload;
}


/* -------------------------------------------------------------- sign-in */

function base64url(buffer) {

    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


function pkce() {

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

    return { verifier, challenge };
}


function redirectUriFor(requestBase) {

    const configured = String(settings.get("MCP_OAUTH_REDIRECT_BASE") || "").trim().replace(/\/$/, "");
    const base = configured || String(requestBase || "").replace(/\/$/, "");

    if (!/^https?:\/\//.test(base)) {
        throw Object.assign(new Error("the console's address is unknown; set MCP_OAUTH_REDIRECT_BASE"), { status: 400 });
    }

    return `${base}/api/mcp/oauth/callback`;
}


function pruneFlows() {

    const now = Date.now();

    for (const [state, flow] of flows.entries()) {
        if (flow.expires_at < now) flows.delete(state);
    }
}


/*
| Starts a sign-in for a configured server: the authorization URL the
| console opens. config is the server's normalized definition.
*/
async function start(config, { requestBase, wwwAuthenticate = null } = {}) {

    if (!config || config.transport === "stdio" || !config.url) {
        throw Object.assign(new Error("OAuth sign-in is for remote (http, sse, websocket) servers"), { status: 400 });
    }

    pruneFlows();

    const options = config.oauth || {};
    const redirectUri = redirectUriFor(requestBase);
    const endpoints = await discover(config.url, { wwwAuthenticate, authorizationServer: options.authorization_server || null });
    const scopes = options.scopes || endpoints.scopes_supported || null;

    let saved = metadataOf(config.name) || {};
    let clientId = options.client_id || null;
    let clientSecret = options.client_secret || null;

    if (!clientId) {

        /* a registration is tied to its redirect URI and issuer */
        if (saved.client_id && saved.redirect_uri === redirectUri && saved.issuer === endpoints.issuer) {
            clientId = saved.client_id;
            clientSecret = readSecret(config.name, "CLIENT_SECRET");
        } else {
            const registered = await register(endpoints, redirectUri, scopes);
            clientId = registered.client_id;
            clientSecret = registered.client_secret || null;
            writeSecret(config.name, "CLIENT_SECRET", clientSecret);
            saved = saveMetadata(config.name, {
                client_id: clientId,
                redirect_uri: redirectUri,
                issuer: endpoints.issuer,
                registered_at: Date.now(),
                auth_method: registered.token_endpoint_auth_method || (clientSecret ? "client_secret_post" : "none")
            });
        }
    }

    saveMetadata(config.name, {
        issuer: endpoints.issuer,
        token_endpoint: endpoints.token_endpoint,
        authorization_endpoint: endpoints.authorization_endpoint,
        resource: endpoints.resource,
        ...(options.client_id ? { client_id: options.client_id, auth_method: options.client_secret ? "client_secret_post" : "none" } : {})
    });

    const { verifier, challenge } = pkce();
    const state = base64url(crypto.randomBytes(24));

    flows.set(state, {
        server: config.name,
        verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        auth_method: (metadataOf(config.name) || {}).auth_method || "none",
        token_endpoint: endpoints.token_endpoint,
        resource: endpoints.resource,
        expires_at: Date.now() + flowTtlMs()
    });

    const url = new URL(endpoints.authorization_endpoint);

    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("resource", endpoints.resource);

    if (scopes && scopes.length) url.searchParams.set("scope", scopes.join(" "));

    return { server: config.name, authorization_url: url.toString(), redirect_uri: redirectUri, state, expires_in: Math.round(flowTtlMs() / 1000) };
}


function storeTokens(server, payload) {

    writeSecret(server, "ACCESS", payload.access_token);

    if (payload.refresh_token) writeSecret(server, "REFRESH", payload.refresh_token);

    return saveMetadata(server, {
        expires_at: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : null,
        scope: payload.scope || null,
        token_type: payload.token_type || "Bearer",
        signed_in_at: Date.now(),
        refreshed_at: Date.now()
    });
}


/* the provider's redirect: the code for tokens, once, for a known state */
async function complete({ state, code, error, error_description: description } = {}) {

    pruneFlows();

    const flow = state ? flows.get(state) : null;

    if (!flow) {
        throw Object.assign(new Error("this sign-in is unknown or has expired; start it again from the console"), { status: 400 });
    }

    flows.delete(state);

    if (error) {
        throw Object.assign(new Error(`the provider refused the sign-in: ${error}${description ? ` (${description})` : ""}`), { status: 400, server: flow.server });
    }

    if (!code) {
        throw Object.assign(new Error("the provider sent no authorization code"), { status: 400, server: flow.server });
    }

    const payload = await postForm(flow.token_endpoint, {
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirect_uri,
        code_verifier: flow.verifier,
        resource: flow.resource
    }, { clientId: flow.client_id, clientSecret: flow.client_secret, authMethod: flow.auth_method });

    storeTokens(flow.server, payload);

    emitEvent("mcp:oauth", { server: flow.server, status: "signed_in" });

    return { server: flow.server, signed_in: true };
}


/* ------------------------------------------------------------- refresh */

async function refresh(server, config = {}) {

    if (refreshing.has(server)) return refreshing.get(server);

    const work = (async () => {

        const saved = metadataOf(server) || {};
        const refreshToken = readSecret(server, "REFRESH");
        const options = config.oauth || {};

        if (!refreshToken || !saved.token_endpoint) {
            throw Object.assign(new Error(`MCP server "${server}" needs a sign-in from the console (MCP panel → Sign in)`), { code: "MCP_OAUTH_REQUIRED" });
        }

        try {

            const payload = await postForm(saved.token_endpoint, {
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                resource: saved.resource
            }, {
                clientId: options.client_id || saved.client_id,
                clientSecret: options.client_secret || readSecret(server, "CLIENT_SECRET"),
                authMethod: saved.auth_method
            });

            storeTokens(server, payload);

            emitEvent("mcp:oauth", { server, status: "refreshed" });

            return payload.access_token;

        } catch (error) {

            if (error.oauthError === "invalid_grant") {
                writeSecret(server, "ACCESS", null);
                writeSecret(server, "REFRESH", null);
                saveMetadata(server, { expires_at: null, signed_in_at: null });
                emitEvent("mcp:oauth", { server, status: "expired" });
            }

            throw Object.assign(new Error(`MCP server "${server}": the token could not be refreshed (${error.message}); sign in again from the console`), { code: "MCP_OAUTH_REQUIRED" });
        }
    })();

    refreshing.set(server, work);

    try {
        return await work;
    } finally {
        refreshing.delete(server);
    }
}


function providerFor(config) {

    const server = config.name;

    return {

        async accessToken() {

            const token = readSecret(server, "ACCESS");
            const saved = metadataOf(server) || {};

            if (token && (!saved.expires_at || saved.expires_at - expiryMarginMs() > Date.now())) {
                return token;
            }

            if (readSecret(server, "REFRESH")) {
                return refresh(server, config);
            }

            if (token) return token;

            throw Object.assign(new Error(`MCP server "${server}" needs a sign-in from the console (MCP panel → Sign in)`), { code: "MCP_OAUTH_REQUIRED" });
        },

        async afterUnauthorized(wwwAuthenticate) {

            if (wwwAuthenticate) saveMetadata(server, { last_challenge: String(wwwAuthenticate).slice(0, 500) });

            return refresh(server, config);
        }
    };
}


function status(server) {

    const saved = metadataOf(server) || {};
    const access = Boolean(readSecret(server, "ACCESS"));
    const refreshable = Boolean(readSecret(server, "REFRESH"));

    return {
        server,
        signed_in: access || refreshable,
        /* the expiry of a token that is still held, nothing after a sign-out */
        expires_at: access ? saved.expires_at || null : null,
        expired: Boolean(access && saved.expires_at && saved.expires_at < Date.now()),
        refreshable,
        scope: saved.scope || null,
        issuer: saved.issuer || null,
        client_id: saved.client_id || null,
        signed_in_at: saved.signed_in_at || null,
        refreshed_at: saved.refreshed_at || null
    };
}


function signOut(server, { forgetClient = false } = {}) {

    writeSecret(server, "ACCESS", null);
    writeSecret(server, "REFRESH", null);

    const all = readMetadata();

    if (all[server]) {
        if (forgetClient) {
            writeSecret(server, "CLIENT_SECRET", null);
            delete all[server];
        } else {
            for (const key of ["expires_at", "scope", "signed_in_at", "refreshed_at", "token_type"]) delete all[server][key];
        }
        writeMetadata(all);
    }

    emitEvent("mcp:oauth", { server, status: "signed_out" });

    return status(server);
}


function emitEvent(type, payload) {

    try {
        require("../events").emit(type, payload);
    } catch {
        /* best-effort */
    }
}


function resetFlows() {

    flows.clear();
    refreshing.clear();
}


module.exports = {
    metadataFile,
    secretName,
    resourceMetadataFrom,
    canonicalResource,
    discover,
    register,
    pkce,
    redirectUriFor,
    start,
    complete,
    refresh,
    providerFor,
    status,
    signOut,
    resetFlows
};
