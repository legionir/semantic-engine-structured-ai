"use strict";

const path = require("path");

const dataRoot = require("../persistence/DataRoot");
const JsonRepository = require("./JsonRepository");
const SchemaVersion = require("./SchemaVersion");
const { sanitizeItemProvenance } = require("./MemoryProvenance");


/*
|--------------------------------------------------------------------------
| Memory repository (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| File format and path of working memory. Domain merge/absorb/condense
| live in agent/context/MemoryCoordinator.js. Phase 8: the file lives
| under the active project's data root (central for registered
| projects, the legacy .agent directory otherwise); the explicit
| parameter is how out-of-run callers (tools with a ToolContext) name
| their root directly.
|--------------------------------------------------------------------------
*/

const MEMORY_MARKER = "working_memory";

const FIELDS = [
    "goals",
    "decisions",
    "requirements",
    "constraints",
    "facts",
    "open_tasks",
    "done"
];


function memoryPath(root) {

    return path.join(dataRoot.resolveRoot(root), "memory.json");

}


function emptyMemory() {

    const memory = {
        version: SchemaVersion.CURRENT.memory,
        updated_at: null,
        chunks_absorbed: 0,
        provenance: [],
        item_provenance: []
    };

    for (const field of FIELDS) {
        memory[field] = [];
    }

    return memory;
}


function loadMemory(root) {

    const file = memoryPath(root);

    const parsed = JsonRepository.readJson(file, null);

    if (!parsed) {
        return emptyMemory();
    }

    try {

        SchemaVersion.migrate("memory", parsed);

        const memory = emptyMemory();

        for (const field of FIELDS) {

            memory[field] =
                Array.isArray(parsed[field])
                    ? parsed[field]
                    : [];
        }

        memory.updated_at = parsed.updated_at || null;

        memory.chunks_absorbed =
            Number(parsed.chunks_absorbed) || 0;

        memory.provenance = Array.isArray(parsed.provenance)
            ? parsed.provenance
                .filter(item => item && typeof item === "object")
                .slice(-100)
                .map(item => ({
                    run_id: typeof item.run_id === "string"
                        ? item.run_id.slice(0, 160)
                        : null,
                    source: typeof item.source === "string"
                        ? item.source.slice(0, 40)
                        : "transcript-fold",
                    exchange_count: Math.max(0, Number(item.exchange_count) || 0),
                    tools: Array.isArray(item.tools)
                        ? [...new Set(item.tools
                            .filter(tool => typeof tool === "string")
                            .map(tool => tool.slice(0, 100)))].slice(0, 50)
                        : [],
                    recorded_at: typeof item.recorded_at === "string"
                        ? item.recorded_at.slice(0, 40)
                        : null
                }))
            : [];

        memory.item_provenance =
            sanitizeItemProvenance(parsed.item_provenance, FIELDS);

        return memory;

    } catch {

        /* a corrupt memory must never stop a run */
        return emptyMemory();
    }
}


function saveMemory(memory, root) {

    const file = memoryPath(root);

    memory.updated_at = new Date().toISOString();

    JsonRepository.writeJson(file, memory);

    return memory;
}


module.exports = {
    FIELDS,
    MEMORY_MARKER,
    emptyMemory,
    loadMemory,
    saveMemory,
    memoryPath
};
