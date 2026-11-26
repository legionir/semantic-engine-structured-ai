"use strict";

/*
|--------------------------------------------------------------------------
| Archive search and retrieval
|--------------------------------------------------------------------------
|
| Keyword search over the index, reading record bodies back from their
| segments, and the archive's statistics.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const settings = require("../../config");
const { archiveDirectory, loadIndex, segmentPath } = require("./ArchiveStore");


function tokenise(text) {

    return String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter(token => token.length > 1);
}


/*
| Retrieval is deliberately mechanical. The archive is not a vector
| store, and pretending it is would add a dependency and a background
| service; keyword overlap over titles, tags and summaries, biased by
| importance and recency, is enough to find the record an agent already
| knows exists.
*/

function searchArchive(query, options = {}) {

    const index =
        options.index || loadIndex(options.root);

    const terms = tokenise(query);

    const limit =
        Math.max(
            1,
            Number(options.limit) ||
            settings.get("ARCHIVE_SEARCH_LIMIT")
        );

    const minImportance =
        options.min_importance === undefined
            ? 0
            : Number(options.min_importance);

    const newest =
        index.records.reduce(
            (latest, record) =>
                Math.max(latest, Date.parse(record.ts) || 0),
            0
        );

    const oldest =
        index.records.reduce(
            (earliest, record) =>
                Math.min(
                    earliest,
                    Date.parse(record.ts) || Number.MAX_SAFE_INTEGER
                ),
            Number.MAX_SAFE_INTEGER
        );

    const span =
        Math.max(1, newest - oldest);

    const scored = [];

    for (const record of index.records) {

        if (options.kind && record.kind !== options.kind) {
            continue;
        }

        if (options.agent && record.agent !== options.agent) {
            continue;
        }

        if (options.tool && record.tool !== options.tool) {
            continue;
        }

        if (record.importance < minImportance) {
            continue;
        }

        const haystack =
            tokenise(
                [
                    record.title,
                    record.summary,
                    record.error,
                    record.kind,
                    record.agent,
                    (record.tags || []).join(" ")
                ].join(" ")
            );

        const set = new Set(haystack);

        const matched =
            terms.filter(
                term =>
                    set.has(term) ||
                    haystack.some(token => token.includes(term))
            ).length;

        if (terms.length > 0 && matched === 0) {
            continue;
        }

        const relevance =
            terms.length === 0
                ? 0
                : matched / terms.length;

        const recency =
            ((Date.parse(record.ts) || oldest) - oldest) / span;

        const score =
            relevance * settings.get("ARCHIVE_SCORE_MATCH") +
            record.importance * settings.get("ARCHIVE_SCORE_IMPORTANCE") +
            recency * settings.get("ARCHIVE_SCORE_RECENCY");

        scored.push({
            ...record,
            matched,
            score: Number(score.toFixed(4))
        });
    }

    scored.sort((left, right) => right.score - left.score);

    return {
        query: query || "",
        searched: index.records.length,
        matches: scored.length,
        results: scored.slice(0, limit)
    };
}


function readBody(record, root) {

    const file = segmentPath(record.segment, root);

    if (!fs.existsSync(file)) {
        return null;
    }

    for (
        const line
        of fs.readFileSync(file, "utf8").split("\n")
    ) {

        if (line.trim() === "") {
            continue;
        }

        try {

            const parsed = JSON.parse(line);

            if (parsed.id === record.id) {
                return parsed.body;
            }

        } catch {

            continue;
        }
    }

    return null;
}


/*
| A record that was rolled up is gone from the index but its body is
| still in the segment it was written to, until compaction reclaims the
| space. A roll up remembers the ids it merged, so opening one is worth
| trying rather than answering "unknown".
*/

function findOrphanBody(id, root) {

    const directory = archiveDirectory(root);

    if (!fs.existsSync(directory)) {
        return null;
    }

    for (
        const name
        of fs.readdirSync(directory)
            .filter(entry => entry.endsWith(".jsonl"))
    ) {

        for (
            const line
            of fs.readFileSync(segmentPath(name, root), "utf8").split("\n")
        ) {

            if (line.trim() === "" || !line.includes(`"${id}"`)) {
                continue;
            }

            try {

                const parsed = JSON.parse(line);

                if (parsed.id === id) {

                    return {
                        id,
                        segment: name,
                        body: parsed.body,
                        rolled_up: true
                    };
                }

            } catch {

                continue;
            }
        }
    }

    return null;
}


function getRecords(ids, options = {}) {

    const index =
        options.index || loadIndex(options.root);

    const wanted =
        (Array.isArray(ids) ? ids : [ids])
            .map(value => String(value));

    const found = [];
    const missing = [];

    for (const id of wanted) {

        const record =
            index.records.find(item => item.id === id);

        if (!record) {

            const orphan = findOrphanBody(id, options.root);

            if (orphan) {

                found.push({
                    ...orphan,

                    note:
                        "This record was merged into a roll up. Its body survives until the segment is compacted."
                });

                continue;
            }

            missing.push(id);

            continue;
        }

        found.push({
            ...record,
            body: readBody(record, options.root)
        });
    }

    return { records: found, missing };
}


function stats(options = {}) {

    const index =
        options.index || loadIndex(options.root);

    const byKind = {};

    let chars = 0;

    for (const record of index.records) {

        byKind[record.kind] =
            (byKind[record.kind] || 0) + 1;

        chars += record.chars || 0;
    }

    return {
        enabled:
            settings.get("ARCHIVE_ENABLED") === true,

        path:
            archiveDirectory(options.root),

        records:
            index.records.length,

        by_kind:
            byKind,

        archived_chars:
            chars,

        segments:
            new Set(
                index.records.map(record => record.segment)
            ).size,

        updated_at:
            index.updated_at
    };
}


module.exports = {
    getRecords,
    readBody,
    searchArchive,
    stats
};
