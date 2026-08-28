"use strict";

/*
|--------------------------------------------------------------------------
| CLI Help Command — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Handles --help and --version options for the structured-ai CLI.
|--------------------------------------------------------------------------
*/

const { USAGE, PACKAGE, EXIT } = require("./ArgParser");

class HelpCommand {

    static execute(options, out = process.stdout) {

        if (options.help) {

            out.write(`${USAGE}\n`);

            return EXIT.SUCCESS;
        }

        if (options.version) {

            out.write(`${PACKAGE.version}\n`);

            return EXIT.SUCCESS;
        }

        return null;
    }
}

module.exports = {
    HelpCommand,
    USAGE,
    PACKAGE
};
