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

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const settings = require("../config");
const dataRoot = require("../persistence/DataRoot");
const JsonRepository = require("./JsonRepository");
const AtomicFile = require("./AtomicFile");
const SchemaVersion = require("./SchemaVersion");


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

const INDEX_VERSION = SchemaVersion.CURRENT.archive;

/*
| A record is important because of what it did, not because of how it
| reads. The weights are ordered from "this changed the world" down to
| "this can be looked up again in a second".
*/

const IMPORTANCE = {
    failure: "failure",
    decision: "decision",
    mutation: "mutation",
    command: "command",
    inspection: "inspection",
    rollup: "rollup"
};

const MUTATING_TOOLS = [
    "fs_write",
    "fs_edit",
    "fs_mkdir",
    "fs_move",
    "fs_delete",
    "git_add",
    "git_commit",
    "git_checkout",
    "git_branch"
];

const DECISION_TOOLS = [
    "plan_set",
    "plan_update"
];

const COMMAND_TOOLS = [
    "terminal_exec",
    "process_start",
    "process_write",
    "process_terminate"
];


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


/*
| Importance is a class, not a hand tuned float, so the reason a record
| survived a roll up is readable in the file itself.
*/

function importanceOf(kind) {

    switch (kind) {

        case IMPORTANCE.failure:
            return settings.get("ARCHIVE_WEIGHT_FAILURE");

        case IMPORTANCE.decision:
            return settings.get("ARCHIVE_WEIGHT_DECISION");

        case IMPORTANCE.mutation:
            return settings.get("ARCHIVE_WEIGHT_MUTATION");

        case IMPORTANCE.command:
            return settings.get("ARCHIVE_WEIGHT_COMMAND");

        case IMPORTANCE.rollup:
            return settings.get("ARCHIVE_WEIGHT_ROLLUP");

        default:
            return settings.get("ARCHIVE_WEIGHT_INSPECTION");
    }
}


function classify(tool, failed) {

    if (failed) {
        return IMPORTANCE.failure;
    }

    if (DECISION_TOOLS.includes(tool)) {
        return IMPORTANCE.decision;
    }

    if (MUTATING_TOOLS.includes(tool)) {
        return IMPORTANCE.mutation;
    }

    if (COMMAND_TOOLS.includes(tool)) {
        return IMPORTANCE.command;
    }

    return IMPORTANCE.inspection;
}


/*
| A tool result arrives as a JSON string. The interesting parts of it
| for retrieval are the paths, the command, and the error, so those are
| lifted into the title and the tags instead of being buried in a body
| nobody will open.
*/

function describe(tool, argumentsText, resultText) {

    let args = {};

    try {

        args =
            JSON.parse(argumentsText || "{}") || {};

    } catch {

        args = {};
    }

    const paths =
        [
            args.path,
            args.file,
            args.destination,
            args.from,
            args.to,
            ...(Array.isArray(args.paths) ? args.paths : [])
        ].filter(
            value => typeof value === "string" && value !== ""
        );

    const subject =
        args.command ||
        args.query ||
        args.pattern ||
        args.url ||
        paths[0] ||
        "";

    let failed = false;
    let error = "";

    try {

        const parsed = JSON.parse(resultText);

        if (parsed && typeof parsed === "object") {

            failed =
                parsed.error === true ||
                typeof parsed.code === "string" &&
                typeof parsed.message === "string" &&
                parsed.retryable !== undefined;

            error =
                typeof parsed.message === "string"
                    ? parsed.message
                    : "";

            if (parsed.exit_code && parsed.exit_code !== 0) {
                failed = true;
            }
        }

    } catch {

        /* a non JSON result is still a result */
    }

    return {
        subject: clip(subject, settings.get("ARCHIVE_TITLE_CHARS")),
        paths,
        failed,
        error: clip(error, settings.get("ARCHIVE_TITLE_CHARS"))
    };
}


/*
| Turns the exchanges that are about to leave the transcript into
| archive events. This runs before the summariser, so the archive keeps
| its record even when the summariser is down.
*/

function eventsFromExchanges(messages, exchanges, meta = {}) {

    const events = [];

    for (const exchange of exchanges) {

        const assistant = messages[exchange.start];

        const calls =
            Array.isArray(assistant?.tool_calls)
                ? assistant.tool_calls
                : [];

        const results = new Map();

        for (
            let index = exchange.start + 1;
            index <= exchange.end;
            index++
        ) {

            const message = messages[index];

            if (message.role !== "tool") {
                continue;
            }

            results.set(
                message.tool_call_id,
                typeof message.content === "string"
                    ? message.content
                    : JSON.stringify(message.content)
            );
        }

        for (const call of calls) {

            const tool = call.function?.name || "unknown";

            const resultText =
                results.get(call.id) || "";

            const described =
                describe(
                    tool,
                    call.function?.arguments,
                    resultText
                );

            const kind =
                classify(tool, described.failed);

            events.push({
                agent: meta.agent || "main_agent",
                run: meta.run || null,
                tool,
                kind,

                title:
                    described.subject === ""
                        ? tool
                        : `${tool} ${described.subject}`,

                tags:
                    [
                        tool,
                        ...described.paths.map(
                            value => path.basename(value)
                        )
                    ].slice(
                        0,
                        settings.get("ARCHIVE_MAX_TAGS")
                    ),

                error: described.error,

                body:
                    clip(
                        resultText,
                        settings.get("ARCHIVE_BODY_CHARS")
                    )
            });
        }
    }

    return events;
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
