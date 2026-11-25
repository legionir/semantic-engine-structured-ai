"use strict";

const fs = require("fs");

const AtomicFile = require("./AtomicFile");


/*
|--------------------------------------------------------------------------
| JSON documents (EXECUTION_PLAN Phase 18)
|--------------------------------------------------------------------------
|
| Read with a caller-supplied fallback so a corrupt file never stops a
| run (sessions, memory, archive index). Writes are atomic.
|--------------------------------------------------------------------------
*/


function readJson(file, fallback) {

    if (!fs.existsSync(file)) {
        return fallback;
    }

    try {

        return JSON.parse(fs.readFileSync(file, "utf8"));

    } catch {

        return fallback;
    }
}


function writeJson(file, value) {

    AtomicFile.writeFile(
        file,
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8"
    );

    return value;
}


module.exports = {
    readJson,
    writeJson
};
