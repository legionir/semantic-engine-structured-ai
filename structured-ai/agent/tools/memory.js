const memoryStore = require("../lib/memory");
const archive = require("../lib/archive");

const { toWorkspaceRelative } = require("../lib/workspace");


/*
|--------------------------------------------------------------------------
| Memory and Archive Access
|--------------------------------------------------------------------------
|
| Working memory travels with every request, so it has to stay small,
| and staying small means it eventually forgets the exact error message
| from iteration nine. The archive keeps that message, but loading the
| archive into the prompt would defeat the point of compressing at all.
|
| These tools are the bridge. The agent decides when it needs the past:
|
|   memory_get       what the run already established, and how much is
|                    behind it in the archive
|   archive_search   find records by keyword, kind, agent or tool
|   archive_get      open the full body of a record it chose
|
| Retrieval is therefore selective and paid for once, instead of being
| carried in every request forever.
|--------------------------------------------------------------------------
*/

function memory_get(args = {}) {

    const memory =
        memoryStore.loadMemory();

    const fields =
        Array.isArray(args.fields) && args.fields.length > 0
            ? args.fields.filter(
                field => memoryStore.FIELDS.includes(field)
            )
            : memoryStore.FIELDS;

    return {
        path:
            toWorkspaceRelative(memoryStore.memoryPath()),

        updated_at:
            memory.updated_at,

        chunks_absorbed:
            memory.chunks_absorbed,

        size_chars:
            memoryStore.memorySize(memory),

        memory:
            Object.fromEntries(
                fields.map(field => [field, memory[field]])
            ),

        archive:
            args.include_archive === false
                ? undefined
                : archive.stats()
    };
}


function archive_search(args = {}) {

    const found =
        archive.searchArchive(
            args.query || "",
            {
                limit: args.limit,
                kind: args.kind,
                agent: args.agent,
                tool: args.tool,
                min_importance: args.min_importance
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


function archive_get(args = {}) {

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

    const found =
        archive.getRecords(ids);

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
    memory_get,
    archive_search,
    archive_get
};
