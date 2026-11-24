"use strict";

const fs = require("fs");
const path = require("path");


/*
|--------------------------------------------------------------------------
| Atomic file writes (EXECUTION_PLAN Phase 18)
|--------------------------------------------------------------------------
|
| Whole-file replaces go through a sibling temp file and rename, so a
| crash mid-write cannot leave a truncated JSON document on the real
| path. The original file stays readable until rename succeeds. Temp
| files live next to the target so rename stays on one filesystem.
|
| Append-only JSONL (journal, eventstore, archive segments) is not
| rewritten this way: a truncated last line is skipped on read, which
| is the historical contract.
|--------------------------------------------------------------------------
*/


function writeFile(filePath, content, encoding) {

    const encodingName = encoding || "utf8";

    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const tempPath =
        `${filePath}.tmp-${process.pid}-${Date.now()}-${
            Math.random().toString(36).slice(2, 8)
        }`;

    try {

        fs.writeFileSync(tempPath, content, encodingName);

        fs.renameSync(tempPath, filePath);

    } catch (error) {

        try {

            fs.unlinkSync(tempPath);

        } catch {

            /* the temp file may never have been created */
        }

        throw error;
    }

}


module.exports = {
    writeFile
};
