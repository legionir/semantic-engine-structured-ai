"use strict";

const settings = require("../config");
const { conversationSize } = require("./ConversationSizer");
const { compactConversation } = require("./ContextCompactor");
const { foldIntoMemory } = require("./MemoryCoordinator");
const { archiveExchanges } = require("./ArchiveCoordinator");
const { host } = require("./contextHost");


/*
|--------------------------------------------------------------------------
| Context manager (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Maintenance step at the top of every iteration, moved from agent.js.
| Fold into memory first (archive written before any drop), then
| mechanical compression for whatever is still over the trigger.
|--------------------------------------------------------------------------
*/


async function maintainContext(messages, scope) {

    const runtime = host();

    const budget =
        settings.get("MAX_CONTEXT_CHARS");

    const threshold =
        budget * settings.get("CONTEXT_COMPACT_AT");

    const size =
        conversationSize(messages);

    if (size < threshold) {
        return null;
    }

    /*
    | First try a real summary of the oldest material, then fall back to
    | mechanical compression for whatever is still over budget.
    */

    if (
        settings.get("CONTEXT_SUMMARY") === true &&
        settings.get("MEMORY_ENABLED") === true
    ) {

        await foldIntoMemory(messages, scope);
    }

    const report =
        compactConversation(messages, {
            maxChars: threshold,

            onDrop: (current, exchange) =>
                archiveExchanges(current, [exchange], scope)
        });

    if (report.compacted) {

        runtime.logLine(
            scope,
            `Context ${
                Math.round(report.before / 1000)
            }k of ${
                Math.round(budget / 1000)
            }k, compacted to ${
                Math.round(report.after / 1000)
            }k (light ${report.light}, medium ${
                report.medium
            }, heavy ${report.heavy}, dropped ${
                report.dropped_exchanges
            })`
        );

        runtime.events.emit("context:compacted", {
            agent: scope || "main_agent",
            ...report
        });
    }

    return report;
}


module.exports = {
    maintainContext
};
