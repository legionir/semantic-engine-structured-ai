"use strict";

/*
|--------------------------------------------------------------------------
| Archive roll-up and compaction
|--------------------------------------------------------------------------
|
| Keeping the archive bounded: old low value records are merged into one
| counted summary per agent and kind, and segments follow the index.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const settings = require("../../config");
const AtomicFile = require("../AtomicFile");
const { IMPORTANCE, importanceOf } = require("./ArchiveClassifier");
const {
    appendBody,
    archiveDirectory,
    clip,
    currentSegment,
    hashOf,
    segmentPath
} = require("./ArchiveStore");


/*
| Once the index is full the cheap records are merged, not deleted: one
| rollup per agent and kind, carrying the count and a sample of titles.
| A run can then say "there were 340 reads under src/" without keeping
| 340 rows.
*/

/*
| A roll up used to be the list of what it merged, cut at the size of a
| single event's body. Measured on 390 merged reads: 50 titles kept, 340
| lost, the last one cut mid path. The count was right and the detail
| was gone.
|
| The body is now a digest first and a list second. The digest is
| bounded whatever the group size, so the answer to "what were those 390
| events" survives even when the individual lines do not.
*/

function summariseGroup(group) {

    const byTool = new Map();

    const byArea = new Map();

    let seen = 0;

    for (const record of group) {

        seen += record.seen || 1;

        const tool = record.tool || "unknown";

        byTool.set(tool, (byTool.get(tool) || 0) + 1);

        /*
        | The first two path segments of a title are a good enough
        | grouping for "where did this happen".
        */

        const path =
            /\s((?:[\w.@-]+\/){1,}[\w.@-]+)/.exec(record.title);

        const area =
            path
                ? path[1].split("/").slice(0, 2).join("/")
                : "-";

        byArea.set(area, (byArea.get(area) || 0) + 1);
    }

    const rank = map =>
        [...map.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([name, count]) => `${name} x${count}`);

    return {
        seen,
        tools: rank(byTool),
        areas: rank(byArea)
    };
}


function rollUpBody(group, kind, agent) {

    const digest =
        summariseGroup(group);

    const first = group[0];

    const last = group[group.length - 1];

    const header = [
        `${group.length} ${kind} events by ${agent}, merged into one record.`,
        `calls: ${digest.seen} (${group.length} distinct)`,
        `tools: ${digest.tools.join(", ")}`,
        `where: ${digest.areas.slice(0, 12).join(", ")}`,
        `from ${first.ts} to ${last.last_seen || last.ts}`,
        "",
        "records, newest last:"
    ];

    /*
    | Room is reserved for the closing notice, so the sentence that says
    | how much was left out is never itself cut off.
    */

    const limit =
        Math.max(
            200,
            settings.get("ARCHIVE_ROLLUP_BODY_CHARS") - 160
        );

    const lines = [];

    let used =
        header.join("\n").length;

    let dropped = 0;

    for (const record of group) {

        const line =
            `${record.ts} x${record.seen || 1} ${record.id} ${record.title}`;

        if (used + line.length + 1 > limit) {

            dropped++;

            continue;
        }

        used += line.length + 1;

        lines.push(line);
    }

    if (dropped > 0) {

        lines.push(
            `… ${dropped} more, counted above and summarised in the digest.`
        );
    }

    return [...header, ...lines].join("\n");
}


function rollUp(index, root) {

    const limit =
        settings.get("ARCHIVE_MAX_RECORDS");

    if (index.records.length <= limit) {

        return {
            merged: 0,
            dropped: 0
        };
    }

    const keepImportance =
        settings.get("ARCHIVE_KEEP_IMPORTANCE");

    const overflow =
        index.records.length - limit;

    const candidates =
        index.records
            .filter(
                record =>
                    record.kind !== IMPORTANCE.rollup &&
                    record.importance < keepImportance
            )
            .slice(0, overflow + settings.get("ARCHIVE_ROLLUP_BATCH"));

    if (candidates.length === 0) {

        /*
        | Everything left is worth keeping, so the oldest important
        | records lose only their place, never their content: they are
        | dropped from the index but their bodies stay in the segment
        | until compaction reclaims them.
        */

        const dropped =
            index.records.splice(0, overflow);

        return {
            merged: 0,
            dropped: dropped.length
        };
    }

    const groups = new Map();

    for (const record of candidates) {

        const key = `${record.agent}|${record.kind}`;

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(record);
    }

    const gone =
        new Set(candidates.map(record => record.id));

    index.records =
        index.records.filter(
            record => !gone.has(record.id)
        );

    const stamp = new Date().toISOString();

    let merged = 0;

    for (const [key, group] of groups) {

        const [agent, kind] = key.split("|");

        const titles =
            group
                .slice(0, settings.get("ARCHIVE_ROLLUP_SAMPLES"))
                .map(record => record.title);

        const body =
            rollUpBody(group, kind, agent);

        const segment = currentSegment(index);

        const record = {
            id: `e${index.next_id++}`,
            ts: group[0].ts,
            last_seen: stamp,
            run: group[group.length - 1].run,
            agent,
            tool: null,
            kind: IMPORTANCE.rollup,
            title:
                `${group.length} ${kind} events by ${agent}`,
            tags:
                [...new Set(group.flatMap(item => item.tags))]
                    .slice(0, settings.get("ARCHIVE_MAX_TAGS")),
            error: "",
            importance: importanceOf(IMPORTANCE.rollup),
            summary:
                clip(
                    titles.join(" | "),
                    settings.get("ARCHIVE_SUMMARY_CHARS")
                ),
            chars: body.length,
            seen: group.reduce(
                (total, item) => total + (item.seen || 1),
                0
            ),
            hash:
                hashOf([
                    "rollup",
                    key,
                    String(index.next_id),
                    stamp
                ]),
            segment,

            merged_from: group.length,

            /*
            | Ids are only remembered when the bodies are kept, because
            | an id whose body has been reclaimed is a promise the
            | archive cannot honour.
            */

            merged_ids:
                settings.get("ARCHIVE_KEEP_MERGED_BODIES") === true
                    ? group
                        .slice(0, settings.get("ARCHIVE_ROLLUP_IDS"))
                        .map(item => item.id)
                    : undefined
        };

        appendBody(
            segment,
            record,
            clip(
                body,
                settings.get("ARCHIVE_ROLLUP_BODY_CHARS")
            ),
            root
        );

        index.records.push(record);

        merged += group.length;
    }

    return {
        merged,
        dropped: 0
    };
}


/*
| Segments are append only, so a rolled up record leaves a hole behind
| it. A segment is rewritten once most of it is dead, and removed when
| all of it is.
*/

function compactSegments(index, root) {

    const directory = archiveDirectory(root);

    if (!fs.existsSync(directory)) {
        return { compacted: 0, removed: 0 };
    }

    const live = new Map();

    /*
    | A body a roll up still points at is not dead, wherever it lives.
    */

    const keep = new Set();

    for (const record of index.records) {

        if (!live.has(record.segment)) {
            live.set(record.segment, new Set());
        }

        live.get(record.segment).add(record.id);

        for (const id of record.merged_ids || []) {
            keep.add(id);
        }
    }

    const threshold =
        settings.get("ARCHIVE_COMPACT_AT");

    let compacted = 0;
    let removed = 0;

    for (
        const name
        of fs.readdirSync(directory)
            .filter(entry => entry.endsWith(".jsonl"))
    ) {

        const alive =
            live.get(name) || new Set();

        if (alive.size === 0 && keep.size === 0) {

            fs.unlinkSync(segmentPath(name, root));

            removed++;

            continue;
        }

        const lines =
            fs.readFileSync(segmentPath(name, root), "utf8")
                .split("\n")
                .filter(line => line.trim() !== "");

        const kept =
            lines.filter(line => {

                try {

                    const id = JSON.parse(line).id;

                    return alive.has(id) || keep.has(id);

                } catch {

                    return false;
                }
            });

        /*
        | SA-F-003 — a segment is dead when *its own* lines are all dead,
        | not when the global keep set happens to be empty. The removal
        | branch above only fires when no rollup exists anywhere, so with
        | any rollup present a fully-dead segment fell through here, kept
        | became empty, and was rewritten as a one-newline file that then
        | persisted forever. When nothing in this segment is live or
        | referenced, unlink it instead of leaving an empty shell.
        */

        if (kept.length === 0) {

            fs.unlinkSync(segmentPath(name, root));

            removed++;

            continue;
        }

        if (kept.length === lines.length) {
            continue;
        }

        if (kept.length / lines.length > threshold) {
            continue;
        }

        AtomicFile.writeFile(
            segmentPath(name, root),
            `${kept.join("\n")}\n`,
            "utf8"
        );

        compacted++;
    }

    return { compacted, removed };
}


function maintain(index, root) {

    const rolled = rollUp(index, root);

    const files = compactSegments(index, root);

    return {
        ...rolled,
        ...files
    };
}


module.exports = {
    compactSegments,
    maintain,
    rollUp
};
