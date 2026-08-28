#!/usr/bin/env node

"use strict";

/*
|--------------------------------------------------------------------------
| Command Line Interface — Thin Executable Wrapper (Phase 26)
|--------------------------------------------------------------------------
|
| Delegates to the modular agent/cli subsystem. Maintained as a compatibility
| wrapper until Phase 30.
|--------------------------------------------------------------------------
*/

const { main } = require("../agent/cli");

main().catch(error => {

    process.stderr.write(`agent: ${error.stack || error.message}\n`);
    process.exit(1);
});
