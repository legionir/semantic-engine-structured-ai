"use strict";

/*
|--------------------------------------------------------------------------
| Event Store (legacy wrapper) — EXECUTION_PLAN Phase 18
|--------------------------------------------------------------------------
|
| Implementation lives in agent/persistence/EventStoreRepository.js.
| This file keeps the historical require("./lib/eventstore") path until
| Phase 30.
|--------------------------------------------------------------------------
*/

module.exports = require("../persistence/EventStoreRepository");
