"use strict";

/*
|--------------------------------------------------------------------------
| Legacy policy facade — EXECUTION_PLAN Phase 21
|--------------------------------------------------------------------------
|
| Policy matching, approval lifecycle and policy errors now live in
| agent/policy/. This file remains as the compatibility path used by the
| existing runtime, CLI and tests until the final wrapper-removal phase.
|--------------------------------------------------------------------------
*/

module.exports = require("../policy");
