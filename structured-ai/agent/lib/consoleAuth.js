"use strict";

const crypto = require("crypto");

const settings = require("./storage");


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
| Permissions: project:read, project:write, semantic:query, semantic:index.
|--------------------------------------------------------------------------
*/

const PERMISSIONS = Object.freeze([
    "project:read",
    "project:write",
    "semantic:query",
    "semantic:index"
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

    if (Object.prototype.hasOwnProperty.call(extra, supplied)) {
        return normalizeEntry(extra[supplied]);
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
function redact(value) {

    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === "string") {

        return value
            .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ****")
            .replace(
                /(authorization|api[_-]?key|token|AGENT_CONSOLE_TOKEN)\s*[:=]\s*["']?[^"' \n]+/gi,
                "$1=****"
            );
    }

    if (Array.isArray(value)) {
        return value.map(redact);
    }

    if (typeof value === "object") {

        const output = {};

        for (const [key, item] of Object.entries(value)) {

            if (/token|authorization|api[_-]?key|secret/i.test(key)) {
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
    visibleProjects,
    redact,
    masterClaims
};
