"use strict";

/*
|--------------------------------------------------------------------------
| MCP config (legacy wrapper) — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| Implementation lives in McpConfigLoader.js and McpConfigValidator.js.
| This file keeps the historical require("./mcp/config") path until
| Phase 30.
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
