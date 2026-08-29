#!/usr/bin/env node

"use strict";

/*
| Legacy entry point — EXECUTION_PLAN Phase 26.
| The REPL implementation lives in agent/interactive/; keep this require
| path for existing callers and the CLI facade.
*/

module.exports = require("../agent/interactive");
