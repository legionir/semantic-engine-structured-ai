"use strict";

/*
|--------------------------------------------------------------------------
| Archive store
|--------------------------------------------------------------------------
|
| Where the archive lives on disk: the index file, the segment files and
| appending a record body to the current segment.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const settings = require("../../config");
const dataRoot = require("../DataRoot");
const JsonRepository = require("../JsonRepository");
const SchemaVersion = require("../SchemaVersion");


const INDEX_VERSION = SchemaVersion.CURRENT.archive;


/* Phase 8: the directory lives under the active project's data root. */
function archiveDirectory(root) {

    return path.join(dataRoot.resolveRoot(root), "archive");
}


function indexPath(root) {

    return path.join(archiveDirectory(root), "index.json");
}


function segmentPath(name, root) {

    return path.join(archiveDirectory(root), name);
}


function emptyIndex() {

    return {
        version: INDEX_VERSION,
        updated_at: null,
        next_id: 1,
        next_segment: 1,
        records: []
    };
}


function loadIndex(root) {

    const file = indexPath(root);

    const parsed = JsonRepository.readJson(file, null);

    if (!parsed) {
        return emptyIndex();
    }

    try {

        SchemaVersion.migrate("archive", parsed);

        const index = emptyIndex();

        index.records =
            Array.isArray(parsed.records)
                ? parsed.records.filter(
                    record => record && typeof record === "object"
                )
                : [];

        index.next_id =
            Number(parsed.next_id) ||
            index.records.length + 1;

        index.next_segment =
            Number(parsed.next_segment) || 1;

        index.updated_at =
            parsed.updated_at || null;

        return index;

    } catch {

        /* a corrupt index must never stop a run */
        return emptyIndex();
    }
}


function saveIndex(index, root) {

    index.updated_at = new Date().toISOString();

    JsonRepository.writeJson(indexPath(root), index);

    return index;
}


function hashOf(parts) {

    return crypto
        .createHash("sha1")
        .update(parts.join("\u0000"))
        .digest("hex")
        .slice(0, 16);
}


function clip(text, limit) {

    const value =
        typeof text === "string"
            ? text
            : JSON.stringify(text) || "";

    return value.length > limit
        ? `${value.slice(0, limit)}…`
        : value;
}


function currentSegment(index) {

    const name =
        `segment-${String(index.next_segment).padStart(4, "0")}.jsonl`;

    const perSegment =
        settings.get("ARCHIVE_SEGMENT_RECORDS");

    const inSegment =
        index.records.filter(
            record => record.segment === name
        ).length;

    if (inSegment >= perSegment) {

        index.next_segment++;

        return currentSegment(index);
    }

    return name;
}


function appendBody(segment, record, body, root) {

    fs.mkdirSync(archiveDirectory(root), { recursive: true });

    fs.appendFileSync(
        segmentPath(segment, root),
        `${JSON.stringify({ id: record.id, body })}\n`,
        "utf8"
    );
}


module.exports = {
    appendBody,
    archiveDirectory,
    clip,
    currentSegment,
    emptyIndex,
    hashOf,
    indexPath,
    loadIndex,
    saveIndex,
    segmentPath
};
