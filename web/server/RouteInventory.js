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
    ["POST", "/api/mcp/:name/reconnect"],
    ["GET", "/api/mcp/catalog"],
    ["POST", "/api/mcp/catalog/:id/activate"],
    ["POST", "/api/mcp/catalog/:name/deactivate"],
    ["GET", "/api/mcp/prerequisites"],
    ["GET", "/api/mcp/prerequisites/:id/install"],
    ["POST", "/api/mcp/prerequisites/:id/install"],
    ["GET", "/api/secrets"],
    ["PUT", "/api/secrets/:name"],
    ["DELETE", "/api/secrets/:name"],
    ["GET", "/api/sessions"],
    ["POST", "/api/sessions"],
    ["GET", "/api/sessions/:id"],
    ["POST", "/api/sessions/:id"],
    ["DELETE", "/api/sessions/:id"],
    ["GET", "/api/calls"],
    ["GET", "/api/calls/:key"],
    ["GET", "/api/models"],
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
    ["GET", "/api/conversations"],
    ["GET", "/api/projects/:projectId/queue"],
    ["POST", "/api/projects/:projectId/queue"],
    ["DELETE", "/api/projects/:projectId/queue"],
    ["PATCH", "/api/projects/:projectId/queue/:itemId"],
    ["DELETE", "/api/projects/:projectId/queue/:itemId"],
    ["POST", "/api/projects/:projectId/queue/resume"],
    ["POST", "/api/projects/:projectId/correction"],
    ["POST", "/api/projects/:projectId/clear"],
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
    ["GET", "/api/logs"],
    ["POST", "/api/logs"],
    ["DELETE", "/api/logs"],
    ["GET", "/api/interrupted"],
    ["POST", "/api/interrupted/:id/resume"],
    ["DELETE", "/api/interrupted/:id"],
    ["GET", "/api/project-clones"],
    ["POST", "/api/project-clones"],
    ["GET", "/api/project-clones/:id"],
    ["GET", "/api/system"],
    ["POST", "/api/system/processes/:id/stop"],
    ["GET", "/api/logs/stream"],
    ["GET", "/api/logs/download"],
    ["GET", "/api/terminal"],
    ["POST", "/api/terminal"],
    ["GET", "/api/terminal/:id/stream"],
    ["POST", "/api/terminal/:id/input"],
    ["POST", "/api/terminal/:id/resize"],
    ["DELETE", "/api/terminal/:id"],
    ["GET", "/api/files"],
    ["POST", "/api/files"],
    ["DELETE", "/api/files"],
    ["GET", "/api/files/content"],
    ["PUT", "/api/files/content"],
    ["POST", "/api/files/rename"],
    ["GET", "/api/files/download"],
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
