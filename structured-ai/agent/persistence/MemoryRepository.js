"use strict";

const fs = require("fs");
const path = require("path");

const settings = require("../lib/storage");
const dataRoot = require("../lib/dataRoot");


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
        version: 1,
        updated_at: null,
        chunks_absorbed: 0
    };

    for (const field of FIELDS) {
        memory[field] = [];
    }

    return memory;
}


function loadMemory(root) {

    const file = memoryPath(root);

    if (!fs.existsSync(file)) {
        return emptyMemory();
    }

    try {

        const parsed =
            JSON.parse(fs.readFileSync(file, "utf8"));

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

        return memory;

    } catch {

        /* a corrupt memory must never stop a run */
        return emptyMemory();
    }
}


function saveMemory(memory, root) {

    const file = memoryPath(root);

    fs.mkdirSync(path.dirname(file), { recursive: true });

    memory.updated_at = new Date().toISOString();

    fs.writeFileSync(
        file,
        `${JSON.stringify(memory, null, 2)}\n`,
        "utf8"
    );

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
