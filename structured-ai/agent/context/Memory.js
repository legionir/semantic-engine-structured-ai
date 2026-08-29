"use strict";

/*
|--------------------------------------------------------------------------
| Working Memory boundary — EXECUTION_PLAN Phase 17/30
|--------------------------------------------------------------------------
|
| IO lives in agent/persistence/MemoryRepository.js; domain logic lives
| in agent/context/MemoryCoordinator.js. This file keeps the historical
| This module combines memory persistence and memory-domain helpers.
|--------------------------------------------------------------------------
*/

const repository = require("../persistence/MemoryRepository");
const coordinator = require("../context/MemoryCoordinator");

module.exports = {
    FIELDS: repository.FIELDS,
    MEMORY_MARKER: repository.MEMORY_MARKER,
    emptyMemory: repository.emptyMemory,
    loadMemory: repository.loadMemory,
    saveMemory: repository.saveMemory,
    memoryPath: repository.memoryPath,
    memorySize: coordinator.memorySize,
    isEmpty: coordinator.isEmpty,
    mergeMemory: coordinator.mergeMemory,
    mergeLists: coordinator.mergeLists,
    parseMemoryReply: coordinator.parseMemoryReply,
    chunkText: coordinator.chunkText,
    selectChunks: coordinator.selectChunks,
    absorb: coordinator.absorb,
    condense: coordinator.condense,
    memoryMessage: coordinator.memoryMessage,
    isMemoryMessage: coordinator.isMemoryMessage,
    instructions: coordinator.instructions
};
