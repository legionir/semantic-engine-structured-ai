"use strict";

/*
|--------------------------------------------------------------------------
| Archive repository (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Canonical archive repository. File format, index, segments, search and
| retrieval remain stable. Coordination of when to archive (fold/drop)
| lives in agent/context/ArchiveCoordinator.js.
|--------------------------------------------------------------------------
*/

const settings = require("../config");

const {
    appendBody,
    archiveDirectory,
    clip,
    currentSegment,
    emptyIndex,
    hashOf,
    indexPath,
    loadIndex,
    saveIndex
} = require("./archive/ArchiveStore");
const {
    IMPORTANCE,
    classify,
    describe,
    eventsFromExchanges,
    importanceOf
} = require("./archive/ArchiveClassifier");
const { compactSegments, maintain, rollUp } = require("./archive/ArchiveRollup");
const {
    getRecords,
    readBody,
    searchArchive,
    stats
} = require("./archive/ArchiveSearch");


/*
|--------------------------------------------------------------------------
| Event Archive
|--------------------------------------------------------------------------
|
| Working memory answers "what do I still need to know", and it answers
| it in a few thousand characters. That is the right size for a message
| that travels with every request, and the wrong size for a run that
| produced half a million tokens: the moment a fact leaves the lists in
| memory.json it is gone, and the only way to get it back is to redo the
| work that produced it.
|
| The archive is the layer underneath. Everything folded out of the
| transcript is written here first, one record per tool call, and stays
| on disk:
|
|   exchange -> event -> deduplicate -> append to a segment -> index
|                                          |
|                            retrieval <---+  by keyword, kind, agent
|
| Three properties make it survivable on a long run:
|
|   deduplicate   the same call with the same result is stored once and
|                 counted, so a loop cannot inflate the archive
|   roll up       once the index is full, old low value records are
|                 merged into one counted summary per agent and kind
|   compact       a segment whose records are all gone is rewritten or
|                 deleted, so disk follows the index
|
| Nothing here is loaded into the prompt. The agent retrieves from it
| deliberately, with archive_search and archive_get, which is what keeps
| a 500K token history affordable: the index carries titles, the bodies
| stay on disk until something asks for one.
|--------------------------------------------------------------------------
*/


/*
| Writes events to the archive. Identical work is counted rather than
| stored twice, which is the difference between an archive and a log:
| an agent that reads the same file in twelve iterations leaves one
| record with seen 12.
*/

function archiveEvents(events, options = {}) {

    if (settings.get("ARCHIVE_ENABLED") !== true) {

        return {
            enabled: false,
            added: 0,
            duplicates: 0
        };
    }

    const list =
        Array.isArray(events) ? events : [];

    if (list.length === 0) {

        return {
            enabled: true,
            added: 0,
            duplicates: 0
        };
    }

    const index =
        options.index || loadIndex(options.root);

    const byHash = new Map();

    for (const record of index.records) {
        byHash.set(record.hash, record);
    }

    const stamp = new Date().toISOString();

    let added = 0;
    let duplicates = 0;

    for (const event of list) {

        const body =
            clip(
                event.body || "",
                settings.get("ARCHIVE_BODY_CHARS")
            );

        const hash =
            hashOf([
                event.tool || "",
                event.title || "",
                body
            ]);

        const existing = byHash.get(hash);

        if (existing) {

            existing.seen = (existing.seen || 1) + 1;
            existing.last_seen = stamp;

            duplicates++;

            continue;
        }

        const segment = currentSegment(index);

        const record = {
            id: `e${index.next_id++}`,
            ts: stamp,
            last_seen: stamp,
            run: event.run || null,
            agent: event.agent || "main_agent",
            tool: event.tool || null,
            kind: event.kind || IMPORTANCE.inspection,
            title: clip(event.title || "", settings.get("ARCHIVE_TITLE_CHARS")),
            tags: Array.isArray(event.tags) ? event.tags : [],
            error: event.error || "",
            importance: importanceOf(event.kind),
            summary: clip(body, settings.get("ARCHIVE_SUMMARY_CHARS")),
            chars: body.length,
            seen: 1,
            hash,
            segment
        };

        appendBody(segment, record, body, options.root);

        index.records.push(record);

        byHash.set(hash, record);

        added++;
    }

    const maintained = maintain(index, options.root);

    saveIndex(index, options.root);

    return {
        enabled: true,
        added,
        duplicates,
        ...maintained,
        records: index.records.length
    };
}


module.exports = {
    IMPORTANCE,
    archiveDirectory,
    indexPath,
    emptyIndex,
    loadIndex,
    saveIndex,
    classify,
    describe,
    eventsFromExchanges,
    archiveEvents,
    searchArchive,
    getRecords,
    readBody,
    rollUp,
    compactSegments,
    maintain,
    stats
};
