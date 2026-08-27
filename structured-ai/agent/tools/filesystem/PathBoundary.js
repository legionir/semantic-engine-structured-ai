"use strict";

/*
|--------------------------------------------------------------------------
| Filesystem path boundary — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| Workspace root + symlink protection for every filesystem tool. The
| actual resolution lives on ToolContext (Phase 4); this module is the
| named boundary the group tools go through so the security rules stay
| in one place.
|--------------------------------------------------------------------------
*/

const settings = require("../../lib/storage");

const {
    ignoredDirectories
} = require("../../lib/workspace");

const ToolContext = require("../ToolContext");


function bound(context) {

    return ToolContext.from(context);

}


function looksBinary(buffer) {

    const probe =
        buffer.subarray(
            0,
            Math.min(
                buffer.length,
                settings.get("BINARY_PROBE_BYTES")
            )
        );

    return probe.includes(0);
}


function describeEntry(entry) {

    if (entry.isDirectory()) {
        return "directory";
    }

    if (entry.isSymbolicLink()) {
        return "symlink";
    }

    if (entry.isFile()) {
        return "file";
    }

    return "other";
}


async function statSafe(target) {

    try {

        return await require("fs").promises.stat(target);

    } catch {

        return null;
    }
}


module.exports = {
    bound,
    looksBinary,
    describeEntry,
    statSafe,
    ignoredDirectories
};
