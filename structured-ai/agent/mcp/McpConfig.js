"use strict";

/*
|--------------------------------------------------------------------------
| MCP configuration boundary — EXECUTION_PLAN Phase 20/30
|--------------------------------------------------------------------------
|
| This module composes loading, validation and trust into one canonical
| public configuration API.
|--------------------------------------------------------------------------
*/

const loader = require("./McpConfigLoader");
const validator = require("./McpConfigValidator");
const trust = require("./McpTrustPolicy");

module.exports = {
    SOURCES: validator.SOURCES,
    TRANSPORT_ALIASES: validator.TRANSPORT_ALIASES,
    load: loader.load,
    normalizeOne: validator.normalizeOne,
    persist: loader.persist,
    forget: loader.forget,
    serverVisibleTo: trust.serverVisibleTo,
    registryFile: loader.registryFile,
    projectFile: loader.projectFile,
    workspaceFile: loader.workspaceFile,
    expand: validator.expand
};
