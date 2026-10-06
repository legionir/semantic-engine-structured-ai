"use strict";

/*
|--------------------------------------------------------------------------
| Archive tools — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
*/

const archive = require("../../persistence/ArchiveRepository");

const ToolContext = require("../ToolContext");


function archive_search(args = {}, context) {

    const ctx = ToolContext.from(context);

    const found =
        archive.searchArchive(
            args.query || "",
            {
                limit: args.limit,
                kind: args.kind,
                agent: args.agent,
                tool: args.tool,
                min_importance: args.min_importance,
                root: ctx
            }
        );

    /*
    | Bodies are deliberately left on disk. A search that returned them
    | would be a second way to blow the context budget.
    */

    return {
        query: found.query,

        searched: found.searched,

        matches: found.matches,

        returned: found.results.length,

        results:
            found.results.map(record => ({
                id: record.id,
                ts: record.ts,
                agent: record.agent,
                tool: record.tool,
                kind: record.kind,
                title: record.title,
                summary: record.summary,
                error: record.error || undefined,
                importance: record.importance,
                seen: record.seen,
                chars: record.chars,
                score: record.score
            })),

        note:
            "Call archive_get with the ids you actually need to read a full record."
    };
}


function archive_get(args = {}, context) {

    const ids =
        Array.isArray(args.ids)
            ? args.ids
            : args.id
                ? [args.id]
                : [];

    if (ids.length === 0) {

        throw new Error(
            "archive_get needs ids: search first with archive_search."
        );
    }

    const ctx = ToolContext.from(context);

    const found =
        archive.getRecords(ids, { root: ctx });

    return {
        records:
            found.records.map(record => ({
                id: record.id,
                ts: record.ts,
                agent: record.agent,
                tool: record.tool,
                kind: record.kind,
                title: record.title,
                importance: record.importance,
                seen: record.seen,
                body: record.body
            })),

        missing:
            found.missing
    };
}


module.exports = {
    archive_search,
    archive_get
};
