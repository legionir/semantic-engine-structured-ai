"use strict";

/*
|--------------------------------------------------------------------------
| Memory tools — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
*/

const memoryStore = require("../../context/Memory");
const archive = require("../../persistence/ArchiveRepository");

const { toWorkspaceRelative } = require("../../context/WorkspaceBoundary");

const ToolContext = require("../ToolContext");


function memory_get(args = {}, context) {

    /* Phase 8: memory and the archive are per-project stores; the run
       context names the project, legacy mode keeps the workspace file. */
    const ctx = ToolContext.from(context);

    const memory =
        memoryStore.loadMemory(ctx);

    const fields =
        Array.isArray(args.fields) && args.fields.length > 0
            ? args.fields.filter(
                field => memoryStore.FIELDS.includes(field)
            )
            : memoryStore.FIELDS;

    const file =
        memoryStore.memoryPath(ctx);

    return {
        path:
            toWorkspaceRelative(file).startsWith("..")
                ? file
                : toWorkspaceRelative(file),

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
                : archive.stats({ root: ctx })
    };
}


module.exports = {
    memory_get
};
