"use strict";

/*
|--------------------------------------------------------------------------
| Conversation Budget (legacy wrapper) — EXECUTION_PLAN Phase 17
|--------------------------------------------------------------------------
|
| Implementation lives in agent/context/. This file keeps the historical
| require("./lib/context") path bit-identical until Phase 30 removes
| the wrapper.
|--------------------------------------------------------------------------
*/

const contextKit = require("../context");

module.exports = {
    LEVELS: contextKit.LEVELS,
    DIGEST_MARKER: contextKit.DIGEST_MARKER,
    isDigest: contextKit.isDigest,
    digestOldest: contextKit.digestOldest,
    conversationSize: contextKit.conversationSize,
    compactConversation: contextKit.compactConversation,
    findExchanges: contextKit.findExchanges,
    levelForPosition: contextKit.levelForPosition
};
