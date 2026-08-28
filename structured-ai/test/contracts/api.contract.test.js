"use strict";

/*
|--------------------------------------------------------------------------
| Web API Contract Tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| Validates and locks the HTTP Web API surface (77 endpoints) against the
| baseline snapshot.
|--------------------------------------------------------------------------
*/

const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

module.exports = require(path.join(ROOT, "test", "web", "routes.contract.test.js"));
