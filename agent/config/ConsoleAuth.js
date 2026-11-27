"use strict";

const crypto = require("crypto");

const settings = require("./index");


/*
|--------------------------------------------------------------------------
| Console token claims (EXECUTION_PLAN Phase 9 گام ۳)
|--------------------------------------------------------------------------
|
| The generated/configured AGENT_CONSOLE_TOKEN remains a master token
| with every project and every permission, so today's console is
| bit-identical. Extra scoped tokens are declared in AGENT_CONSOLE_TOKENS
| as JSON:
|
|   { "<token>": { "allowedProjects": ["prj-a"], "permissions": ["project:read"] } }
|
| Permissions: project:read, project:write.
|--------------------------------------------------------------------------
*/

const PERMISSIONS = Object.freeze([
    "project:read",
    "project:write"
]);


function tokenMatches(candidate, expected) {

    if (typeof candidate !== "string" || typeof expected !== "string") {
        return false;
    }

    if (candidate.length !== expected.length || expected.length === 0) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(candidate),
        Buffer.from(expected)
    );
}


function masterClaims() {

    return {
        master: true,
        allowedProjects: ["*"],
        permissions: [...PERMISSIONS]
    };
}


function scopedTokens() {

    const raw = settings.get("AGENT_CONSOLE_TOKENS");

    if (!raw || String(raw).trim() === "") {
        return {};
    }

    try {

        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};

    } catch {

        return {};
    }
}


function normalizeEntry(entry) {

    if (!entry || typeof entry !== "object") {
        return null;
    }

    const allowedProjects =
        Array.isArray(entry.allowedProjects)
            ? entry.allowedProjects.map(String)
            : Array.isArray(entry.allowed_projects)
                ? entry.allowed_projects.map(String)
                : [];

    const permissions =
        Array.isArray(entry.permissions)
            ? entry.permissions.filter(item => PERMISSIONS.includes(item))
            : ["project:read"];

    return {
        master: false,
        allowedProjects,
        permissions
    };
}


function resolve(supplied, masterToken) {

    if (typeof supplied !== "string" || supplied === "") {
        return null;
    }

    if (tokenMatches(supplied, masterToken)) {
        return masterClaims();
    }

    const extra = scopedTokens();

    for (const [key, entry] of Object.entries(extra)) {
        if (tokenMatches(supplied, key)) {
            return normalizeEntry(entry);
        }
    }

    return null;
}


function allowsAllProjects(claims) {

    return Boolean(
        claims &&
        (
            claims.master ||
            (claims.allowedProjects || []).includes("*")
        )
    );
}


function allowsProject(claims, projectId) {

    if (!claims || !projectId) {
        return false;
    }

    if (allowsAllProjects(claims)) {
        return true;
    }

    return (claims.allowedProjects || []).includes(projectId);
}


function hasPermission(claims, permission) {

    if (!claims) {
        return false;
    }

    if (claims.master) {
        return true;
    }

    return (claims.permissions || []).includes(permission);
}


function authorize(claims, { projectId, permission } = {}) {

    if (!claims) {

        return {
            ok: false,
            status: 401,
            error: "console authentication required"
        };
    }

    if (permission && !hasPermission(claims, permission)) {

        return {
            ok: false,
            status: 403,
            error: `missing permission: ${permission}`
        };
    }

    if (projectId && !allowsProject(claims, projectId)) {

        return {
            ok: false,
            status: 403,
            error: `token is not allowed to access project ${projectId}`
        };
    }

    return { ok: true };
}


/*
| P0-4: console-wide changes (settings, approval mode, MCP servers) are
| reserved for the master token. A scoped token, even one that lists
| every project, is never an admin.
*/
function isAdmin(claims) {
    return Boolean(claims && claims.master === true);
}


function authorizeAdmin(claims) {

    if (!claims) {

        return {
            ok: false,
            status: 401,
            error: "console authentication required"
        };
    }

    if (!isAdmin(claims)) {

        return {
            ok: false,
            status: 403,
            error: "this endpoint requires the console admin token"
        };
    }

    return { ok: true };
}


/*
| P0-4: legacy console endpoints (the default conversation store, the
| single console run, its calls) belong to no project, so a token has to
| be allowed on every project to use them.
*/
function authorizeUnscoped(claims, permission) {

    const allowed = authorize(claims, { permission });

    if (!allowed.ok) {
        return allowed;
    }

    if (!allowsAllProjects(claims)) {

        return {
            ok: false,
            status: 403,
            error: "this endpoint is not project-scoped; use the /api/projects/:projectId routes"
        };
    }

    return { ok: true };
}


function visibleProjects(claims, all) {

    if (allowsAllProjects(claims)) {
        return all;
    }

    const allowed = new Set(claims.allowedProjects || []);

    return all.filter(project => allowed.has(project.id));
}


/*
| Logs must never echo a bearer token or obviously-secret fields.
| "source content" here is the raw token/source blob, not tool output.
*/
const NON_SECRET_TOKEN_KEYS = /^(?:max_tokens|prompt_tokens|completion_tokens|input_tokens|output_tokens|total_tokens|cached_tokens|reasoning_tokens|token_count|tokenCount|tokens_used|tokensUsed)$/i;
const SECRET_KEY_PATTERN = /(?:^|[_-])(authorization|api[_-]?key|secret|password|passphrase|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|session[_-]?token|console[_-]?token|token)(?:$|[_-])/i;

function redact(value) {

    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === "string") {

        return value
            .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ****")
            .replace(
                /(authorization|api[_-]?key|password|secret|token|AGENT_CONSOLE_TOKEN)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^"'\s]+)/gi,
                "$1=****"
            );
    }

    if (Array.isArray(value)) {
        return value.map(redact);
    }

    if (typeof value === "object") {

        const output = {};

        for (const [key, item] of Object.entries(value)) {

            if (
                !NON_SECRET_TOKEN_KEYS.test(key) &&
                (SECRET_KEY_PATTERN.test(key) || /authorization|api[_-]?key|secret|password/i.test(key))
            ) {
                output[key] = "****";
            } else {
                output[key] = redact(item);
            }
        }

        return output;
    }

    return value;
}


module.exports = {
    PERMISSIONS,
    tokenMatches,
    resolve,
    allowsAllProjects,
    allowsProject,
    hasPermission,
    authorize,
    isAdmin,
    authorizeAdmin,
    authorizeUnscoped,
    visibleProjects,
    redact,
    masterClaims
};
