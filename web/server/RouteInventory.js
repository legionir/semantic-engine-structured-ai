"use strict";

/*
| Complete method × path inventory for the Web Console API — Phase 23.
| Dynamic parameters are written with `:name`; the paths are the public
| contract, not implementation details of a controller.
*/

const ROUTES = Object.freeze([
    ["GET", "/auth/status"],
    ["POST", "/auth/login"],
    ["GET", "/api/events"],
    ["GET", "/api/state"],
    ["GET", "/api/mcp"],
    ["POST", "/api/mcp"],
    ["DELETE", "/api/mcp/:name"],
    ["POST", "/api/mcp/:name/enabled"],
    ["GET", "/api/sessions"],
    ["POST", "/api/sessions"],
    ["GET", "/api/sessions/:id"],
    ["POST", "/api/sessions/:id"],
    ["DELETE", "/api/sessions/:id"],
    ["GET", "/api/calls"],
    ["GET", "/api/calls/:key"],
    ["POST", "/api/tasks"],
    ["GET", "/api/projects"],
    ["POST", "/api/projects"],
    ["GET", "/api/projects/:projectId"],
    ["PATCH", "/api/projects/:projectId"],
    ["DELETE", "/api/projects/:projectId"],
    ["GET", "/api/projects/:projectId/state"],
    ["GET", "/api/projects/:projectId/sessions"],
    ["GET", "/api/projects/:projectId/events"],
    ["POST", "/api/projects/:projectId/cancel"],
    ["POST", "/api/projects/:projectId/chat"],
    ["POST", "/api/projects/:projectId/tasks"],
    ["GET", "/api/projects/:projectId/metrics"],
    ["GET", "/api/projects/:projectId/health"],
    ["GET", "/api/projects/:projectId/discussions"],
    ["POST", "/api/projects/:projectId/discussions"],
    ["GET", "/api/projects/:projectId/discussions/:discussionId"],
    ["GET", "/api/discussion/personas"],
    ["POST", "/api/discussion"],
    ["POST", "/api/approvals/:id"],
    ["POST", "/api/cancel"],
    ["POST", "/api/clear"],
    ["POST", "/api/approval-mode"],
    ["GET", "/api/settings"],
    ["POST", "/api/settings"],
    ["GET", "/api/stats"],
    ["GET", "/api/metrics"],
    ["GET", "/api/health"],
    ["GET", "/"],
    ["GET", "/projects"],
    ["GET", "/projects/:projectId"]
].map(([method, path]) => Object.freeze({ method, path })));


function key(route) {
    return `${route.method} ${route.path}`;
}


function keys() {
    return ROUTES.map(key);
}


function assertUnique() {

    const values = keys();
    const unique = new Set(values);

    if (unique.size !== values.length) {
        throw new Error("Web route inventory contains duplicate entries.");
    }

    return true;
}


assertUnique();


module.exports = {
    ROUTES,
    key,
    keys,
    assertUnique
};
