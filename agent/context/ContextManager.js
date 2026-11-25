"use strict";

const settings = require("../config");
const { conversationSize } = require("./ConversationSizer");
const { estimateRequestTokens } = require("../providers/TokenCounter");
const { compactConversation } = require("./ContextCompactor");
const { foldIntoMemory } = require("./MemoryCoordinator");
const { archiveExchanges } = require("./ArchiveCoordinator");
const { host } = require("./contextHost");


/*
|--------------------------------------------------------------------------
| Context manager (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Maintenance step at the top of every iteration. The legacy character
| ceiling remains supported; when CONTEXT_WINDOW_TOKENS is configured,
| a provider-independent estimator also enforces the active model's
| configured context window, with safety headroom. Active tool and
| response-format schemas are included in request estimates.
|--------------------------------------------------------------------------
*/


function endpointRoleForScope(scope) {

    const depth = /#(\d+)$/.exec(String(scope || ""));

    if (!depth) {
        return "MAIN";
    }

    const level = Number(depth[1]);
    return level >= 3 ? "L3" : `L${Math.max(1, level)}`;
}


function contextWindowTokensForScope(scope) {

    const role = endpointRoleForScope(scope);
    return settings.get(`ENDPOINT_${role}_CONTEXT_TOKENS`) ||
        settings.get("CONTEXT_WINDOW_TOKENS");
}


async function maintainContext(messages, scope, tools = [], agentDefinition) {

    const runtime = host();

    const charBudget =
        settings.get("MAX_CONTEXT_CHARS");

    const compactAt =
        settings.get("CONTEXT_COMPACT_AT");

    const charThreshold =
        charBudget * compactAt;

    const contextRole = endpointRoleForScope(scope);

    const contextWindowTokens =
        contextWindowTokensForScope(scope);

    const tokenThreshold = contextWindowTokens > 0
        ? contextWindowTokens * Math.min(
            settings.get("CONTEXT_WINDOW_SAFETY_FRACTION"),
            compactAt
        )
        : 0;

    const requestFor = current =>
        typeof runtime.buildAgentRequest === "function"
            ? runtime.buildAgentRequest({
                messages: current,
                agentDefinition,
                tools,
                role: contextRole
            })
            : { messages: current, tools };

    const estimateCurrentRequestTokens = current =>
        estimateRequestTokens(requestFor(current));

    const measure = current => {
        const charRatio = conversationSize(current) / charThreshold;
        if (contextWindowTokens <= 0) {
            return charRatio;
        }
        const tokenRatio = estimateCurrentRequestTokens(current) / tokenThreshold;
        return Math.max(charRatio, tokenRatio);
    };

    if (measure(messages) < 1) {
        return null;
    }

    /*
    | First try a real summary of the oldest material, then fall back to
    | mechanical compression for whatever is still over either budget.
    */

    if (
        settings.get("CONTEXT_SUMMARY") === true &&
        settings.get("MEMORY_ENABLED") === true
    ) {

        await foldIntoMemory(messages, scope);
    }

    const charsBefore = conversationSize(messages);
    const tokensBefore = estimateCurrentRequestTokens(messages);

    const report =
        compactConversation(messages, {
            maxSize: 1,
            measure,
            unit: "normalized-budget-ratio",

            onDrop: (current, exchange) =>
                archiveExchanges(current, [exchange], scope)
        });

    report.characters_before = charsBefore;
    report.tokens_before_estimated = tokensBefore;
    report.characters_after = conversationSize(messages);
    report.tokens_after_estimated = estimateCurrentRequestTokens(messages);
    report.context_window_role = contextRole;
    report.context_window_tokens = contextWindowTokens || null;
    report.token_budget = tokenThreshold || null;

    if (report.compacted) {

        const summary = contextWindowTokens > 0
            ? `Context ${Math.round(report.characters_before / 1000)}k chars / ${report.tokens_before_estimated} estimated tokens of ${contextWindowTokens} model tokens, compacted to ${Math.round(report.characters_after / 1000)}k chars / ${report.tokens_after_estimated} estimated tokens`
            : `Context ${
                Math.round(report.characters_before / 1000)
            }k of ${
                Math.round(charBudget / 1000)
            }k, compacted to ${
                Math.round(report.characters_after / 1000)
            }k`;

        runtime.logLine(
            scope,
            `${summary} (light ${report.light}, medium ${
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
