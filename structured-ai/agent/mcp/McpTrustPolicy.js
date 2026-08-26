"use strict";

/*
|--------------------------------------------------------------------------
| MCP trust / visibility policy — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| Trust (trusted / default / restricted) and Phase 9 project scope live
| here so the manager only asks "is this server visible / trusted".
|--------------------------------------------------------------------------
*/

const settings = require("../lib/storage");


/* Phase 9: without a projectId (legacy run) every server stays
   visible. A project-scoped server is visible only to the ids in
   its `projects` list; global is visible to every project. */
function serverVisibleTo(config, projectId) {

    if (!config) {
        return false;
    }

    if (!projectId) {
        return true;
    }

    if ((config.scope || "global") !== "project") {
        return true;
    }

    const list = config.projects || [];

    return list.includes(projectId);
}


function isUntrustedStdio(config) {

    if (!config) {
        return false;
    }

    const trustProjectConfig =
        settings.get("MCP_TRUST_PROJECT_CONFIG") === true;

    return (
        config.transport === "stdio" &&
        ["project", "workspace"].includes(config.source) &&
        !trustProjectConfig
    );
}


function isActive(config) {

    if (!config || config.enabled === false) {
        return false;
    }

    return !isUntrustedStdio(config);
}


module.exports = {
    serverVisibleTo,
    isUntrustedStdio,
    isActive
};
