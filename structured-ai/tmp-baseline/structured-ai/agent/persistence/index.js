"use strict";

/*
| Canonical persistence boundary — EXECUTION_PLAN Phase 30.
| JSON repositories, append-only stores, schema/version helpers and
| project-root resolution are exposed without the former lib facades.
*/

module.exports = {
    ...require("./AtomicFile"),
    ...require("./JsonRepository"),
    ...require("./SafeIdentifier"),
    ...require("./SchemaVersion"),
    ...require("./DataRoot"),
    ...require("./SessionRepository"),
    ...require("./JournalRepository"),
    ...require("./EventStoreRepository"),
    ...require("./MemoryRepository"),
    ...require("./ArchiveRepository")
};
