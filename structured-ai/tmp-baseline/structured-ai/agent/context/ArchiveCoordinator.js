"use strict";

const archive = require("../persistence/ArchiveRepository");
const { host } = require("./contextHost");


/*
|--------------------------------------------------------------------------
| Archive coordinator (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| One place that turns exchanges into archive records, used both when
| history is folded into memory and when compaction drops an exchange
| outright. Dropping is the only step that destroys material, so it must
| never happen without a copy landing here first.
|
| Persistence lives in ArchiveRepository; this module only decides when
| to write. The WeakSet is keyed on the assistant message object, so
| nothing is added to what gets serialised into a request.
|--------------------------------------------------------------------------
*/

const ARCHIVED_EXCHANGES = new WeakSet();


function archiveExchanges(messages, exchanges, scope) {

    /*
    | An exchange is archived once, at the moment it is complete, so the
    | stored body is the full tool result rather than whatever survived
    | compression. The set is keyed on the assistant message object, so
    | nothing is added to what gets serialised into a request.
    */

    const fresh =
        exchanges.filter(
            exchange =>
                !ARCHIVED_EXCHANGES.has(messages[exchange.start])
        );

    if (fresh.length === 0) {
        return null;
    }

    const runtime = host();

    try {

        const report = archive.archiveEvents(
            archive.eventsFromExchanges(
                messages,
                fresh,
                {
                    agent: scope || "main_agent",
                    run: runtime.currentRun().id
                }
            )
        );

        for (const exchange of fresh) {

            ARCHIVED_EXCHANGES.add(messages[exchange.start]);
        }

        return report;

    } catch (error) {

        runtime.logLine(
            scope,
            `Could not archive exchanges: ${error.message}`
        );

        return null;
    }
}


module.exports = {
    archiveExchanges
};
