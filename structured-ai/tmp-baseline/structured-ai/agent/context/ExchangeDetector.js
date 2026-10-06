"use strict";

/*
|--------------------------------------------------------------------------
| Exchange detector (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| An exchange is one assistant message carrying tool_calls plus the
| following tool results. Compaction and archive never split a pair.
|--------------------------------------------------------------------------
*/


function findExchanges(messages) {

    const exchanges = [];

    for (
        let index = 0;
        index < messages.length;
        index++
    ) {

        const message = messages[index];

        if (
            message.role !== "assistant" ||
            !Array.isArray(message.tool_calls) ||
            message.tool_calls.length === 0
        ) {
            continue;
        }

        let end = index;

        while (
            end + 1 < messages.length &&
            messages[end + 1].role === "tool"
        ) {
            end++;
        }

        exchanges.push({ start: index, end });

        index = end;
    }

    return exchanges;
}


module.exports = {
    findExchanges
};
