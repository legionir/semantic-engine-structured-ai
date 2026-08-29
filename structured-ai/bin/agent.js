#!/usr/bin/env node

"use strict";

/*
| Legacy executable facade — EXECUTION_PLAN Phase 26.
| Parsing, command dispatch, output and lifecycle live in agent/cli/.
*/

const cli = require("../agent/cli");


if (require.main === module) {
    cli.main().catch(error => {
        process.stderr.write(`agent: ${error.stack || error.message}\n`);
        process.exit(cli.EXIT.FAILED);
    });
}


module.exports = cli;
