"use strict";


/*
|--------------------------------------------------------------------------
| Schema versions (EXECUTION_PLAN Phase 18)
|--------------------------------------------------------------------------
|
| Labels, not tunable numbers. Current on-disk versions stay exactly
| what the historical files already write. migrate() is identity for
| known versions and still returns the document for an unknown or
| missing version — a corrupt or future file must not stop the runtime
| (except where the existing contract already throws, e.g. the project
| registry).
|--------------------------------------------------------------------------
*/

const CURRENT = {
    session: "1",
    journal: "1.0",
    eventstore: "1",
    memory: 1,
    archive: "1",
    discussion: "1"
};


function versionOf(document) {

    if (!document || typeof document !== "object") {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(document, "version")) {
        return document.version;
    }

    if (Object.prototype.hasOwnProperty.call(document, "schema_version")) {
        return document.schema_version;
    }

    return null;
}


function isCurrent(kind, version) {

    return version === CURRENT[kind];
}


function migrate(kind, document) {

    const version = versionOf(document);

    return {
        kind,
        document,
        version,
        current: isCurrent(kind, version),
        migrated: false
    };
}


module.exports = {
    CURRENT,
    versionOf,
    isCurrent,
    migrate
};
