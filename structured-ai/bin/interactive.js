"use strict";

/*
|--------------------------------------------------------------------------
| Interactive Session — Compatibility Wrapper (Phase 26)
|--------------------------------------------------------------------------
|
| Delegates to the modular agent/interactive subsystem. Maintained as a
| compatibility wrapper until Phase 30.
|--------------------------------------------------------------------------
*/

const { startSession } = require("../agent/interactive");

module.exports = {
    startSession
};
