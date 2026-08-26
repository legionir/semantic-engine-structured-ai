"use strict";

/*
|--------------------------------------------------------------------------
| Conversation size (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Extracted from agent/lib/context.js. Settings are read at the moment
| of use, never captured at load.
|--------------------------------------------------------------------------
*/


function messageSize(message) {

    if (!message) {
        return 0;
    }

    let size = 0;

    if (typeof message.content === "string") {
        size += message.content.length;
    } else if (message.content) {
        size += JSON.stringify(message.content).length;
    }

    if (Array.isArray(message.tool_calls)) {
        size += JSON.stringify(message.tool_calls).length;
    }

    return size;
}


function conversationSize(messages) {

    return messages.reduce(
        (total, message) =>
            total + messageSize(message),
        0
    );
}


module.exports = {
    messageSize,
    conversationSize
};
