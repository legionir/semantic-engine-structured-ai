"use strict";

/*
|--------------------------------------------------------------------------
| Event Archive (legacy wrapper) — EXECUTION_PLAN Phase 17
|--------------------------------------------------------------------------
|
| Implementation lives in agent/persistence/ArchiveRepository.js. This
| file keeps the historical require("./lib/archive") path bit-identical
| until Phase 30 removes the wrapper.
|--------------------------------------------------------------------------
*/

module.exports = require("../persistence/ArchiveRepository");
