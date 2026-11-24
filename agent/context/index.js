"use strict";

/*
|--------------------------------------------------------------------------
| Context kit (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Facade over extracted context, memory and archive. bind() is called
| from agent.js once the live closures exist. This is a move, not a
| fork: there is no extra MODE flag (Phase 17 does not declare one).
|--------------------------------------------------------------------------
*/

const contextHost = require("./contextHost");
const ConversationSizer = require("./ConversationSizer");
const ExchangeDetector = require("./ExchangeDetector");
const ContextCompactor = require("./ContextCompactor");
const MemoryCoordinator = require("./MemoryCoordinator");
const ArchiveCoordinator = require("./ArchiveCoordinator");
const ContextManager = require("./ContextManager");


module.exports = {
    bind: contextHost.bind,
    host: contextHost.host,

    LEVELS: ContextCompactor.LEVELS,
    DIGEST_MARKER: ContextCompactor.DIGEST_MARKER,
    isDigest: ContextCompactor.isDigest,
    digestOldest: ContextCompactor.digestOldest,
    conversationSize: ConversationSizer.conversationSize,
    compactConversation: ContextCompactor.compactConversation,
    findExchanges: ExchangeDetector.findExchanges,
    levelForPosition: ContextCompactor.levelForPosition,

    maintainContext: ContextManager.maintainContext,
    foldIntoMemory: MemoryCoordinator.foldIntoMemory,
    refreshMemoryMessage: MemoryCoordinator.refreshMemoryMessage,
    archiveExchanges: ArchiveCoordinator.archiveExchanges,

    ConversationSizer,
    ExchangeDetector,
    ContextCompactor,
    MemoryCoordinator,
    ArchiveCoordinator,
    ContextManager
};
