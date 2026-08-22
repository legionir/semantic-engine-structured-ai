const settings = require("./storage");


/*
|--------------------------------------------------------------------------
| Conversation Budget
|--------------------------------------------------------------------------
|
| Each iteration appends an action and its results, so a long run grows
| the request until the model rejects it. Cutting the oldest messages
| away loses the project knowledge the agent already paid for, and
| cutting everything equally destroys what it just read.
|
| Compression is therefore graduated by age. With the transcript ordered
| newest first:
|
|   newest slice   untouched   the files it just read stay readable
|   light slice    trimmed     enough to recall what a call returned
|   medium slice   summarised  the shape of the result, not the body
|   oldest slice   one line    that the call happened, and whether it worked
|
| Only tool results are compressed, and every message stays in place, so
| an assistant message carrying tool_calls is always still answered by a
| tool message for each of its ids.
|--------------------------------------------------------------------------
*/

const LEVELS = {
    NONE: "none",
    LIGHT: "light",
    MEDIUM: "medium",
    HEAVY: "heavy"
};

/*
| How aggressive each level is, ordered from gentlest to hardest.
*/

const ORDER = [
    LEVELS.LIGHT,
    LEVELS.MEDIUM,
    LEVELS.HEAVY
];


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


/*
| The level an exchange belongs to, decided by how far it sits from the
| newest end of the transcript.
*/

function levelForPosition(indexFromNewest, total, options) {

    const keepRecent =
        Math.max(
            1,
            options.keepRecentExchanges ??
            settings.get("KEEP_RECENT_EXCHANGES")
        );

    if (indexFromNewest < keepRecent) {
        return LEVELS.NONE;
    }

    const share =
        total <= 1
            ? 1
            : indexFromNewest / total;

    const lightShare =
        options.lightFraction ??
        settings.get("CONTEXT_LIGHT_FRACTION");

    const mediumShare =
        options.mediumFraction ??
        settings.get("CONTEXT_MEDIUM_FRACTION");

    if (share < lightShare) {
        return LEVELS.LIGHT;
    }

    if (share < mediumShare) {
        return LEVELS.MEDIUM;
    }

    return LEVELS.HEAVY;
}


function parseResult(message) {

    try {

        return JSON.parse(message.content);

    } catch {

        return null;
    }
}


function describeResult(result, original) {

    if (!result) {

        return {
            compressed: true,
            original_chars: original.length
        };
    }

    return {
        id: result.id,
        name: result.name,
        success: result.success,
        error:
            result.error
                ? result.error.message
                : undefined,
        compressed: true,
        original_chars: original.length
    };
}


/*
| Applies one level to one tool message. Returns true when the message
| actually became smaller, so the caller knows progress was made.
*/

function compressToolMessage(message, level) {

    if (
        message.role !== "tool" ||
        level === LEVELS.NONE
    ) {
        return false;
    }

    const current =
        message.compression || LEVELS.NONE;

    if (ORDER.indexOf(level) <= ORDER.indexOf(current)) {

        /* already at this level or harder */
        return false;
    }

    const original =
        message.original_content || message.content;

    const parsed =
        parseResult(message);

    const before =
        message.content.length;

    if (level === LEVELS.LIGHT) {

        const limit =
            settings.get("CONTEXT_LIGHT_CHARS");

        if (before <= limit) {

            message.compression = LEVELS.LIGHT;

            return false;
        }

        message.content =
            `${original.slice(0, limit)}\n... [older result trimmed to ${
                limit
            } of ${original.length} characters]`;

    } else if (level === LEVELS.MEDIUM) {

        const limit =
            settings.get("CONTEXT_MEDIUM_CHARS");

        const summary =
            describeResult(parsed, original);

        message.content =
            JSON.stringify({
                ...summary,

                excerpt:
                    original.slice(0, limit),

                note:
                    "Older result, summarised. Re-run the tool if the detail matters."
            });

    } else {

        message.content =
            JSON.stringify({
                ...describeResult(parsed, original),

                note:
                    "Result from an early iteration, removed to stay within the context budget."
            });
    }

    message.compression = level;
    message.elided = level === LEVELS.HEAVY;

    return message.content.length < before;
}


function compactConversation(
    messages,
    options = {}
) {

    const budget =
        options.maxChars ??
        settings.get("MAX_CONTEXT_CHARS");

    const before =
        conversationSize(messages);

    const report = {
        compacted: false,
        before,
        after: before,
        light: 0,
        medium: 0,
        heavy: 0,
        elided_results: 0,
        dropped_exchanges: 0
    };

    if (before <= budget) {
        return report;
    }

    report.compacted = true;

    /*
    | Pass one, gentlest first: every exchange is compressed to the
    | level its age allows, and the loop stops as soon as the budget is
    | met, so recent detail survives whenever possible.
    */

    for (const level of ORDER) {

        const exchanges =
            findExchanges(messages);

        const total = exchanges.length;

        /*
        | Oldest first inside a level, so when the budget is met early
        | the compression that did happen landed on the oldest material.
        */

        for (
            let position = 0;
            position < total;
            position++
        ) {

            if (conversationSize(messages) <= budget) {
                break;
            }

            const indexFromNewest =
                total - 1 - position;

            const allowed =
                levelForPosition(
                    indexFromNewest,
                    total,
                    options
                );

            if (ORDER.indexOf(allowed) < ORDER.indexOf(level)) {

                /* this exchange is too recent for this level */
                continue;
            }

            const exchange =
                exchanges[position];

            for (
                let index = exchange.start;
                index <= exchange.end;
                index++
            ) {

                if (
                    compressToolMessage(
                        messages[index],
                        level
                    )
                ) {

                    report[level]++;

                    if (level === LEVELS.HEAVY) {
                        report.elided_results++;
                    }
                }
            }
        }

        if (conversationSize(messages) <= budget) {
            break;
        }
    }

    /*
    | Pass two: when even hard compression is not enough, whole old
    | exchanges leave, and the model is told how many.
    */

    while (conversationSize(messages) > budget) {

        const remaining =
            findExchanges(messages);

        const keepRecent =
            Math.max(
                1,
                options.keepRecentExchanges ??
                settings.get("KEEP_RECENT_EXCHANGES")
            );

        if (remaining.length <= keepRecent) {
            break;
        }

        const oldest = remaining[0];

        /*
        | Dropping an exchange is the only compaction step that destroys
        | material outright, so the caller gets a chance to keep a copy
        | of it somewhere that is not the conversation.
        */

        if (typeof options.onDrop === "function") {

            try {

                options.onDrop(messages, oldest);

            } catch {

                /* archiving must never block staying inside the budget */
            }
        }

        messages.splice(
            oldest.start,
            oldest.end - oldest.start + 1
        );

        report.dropped_exchanges++;
    }

    if (report.dropped_exchanges > 0) {

        const firstUser =
            messages.findIndex(
                message => message.role === "user"
            );

        messages.splice(
            firstUser === -1
                ? messages.length
                : firstUser + 1,
            0,
            {
                role: "system",

                content:
                    JSON.stringify({
                        type:
                            "context_compaction",

                        dropped_exchanges:
                            report.dropped_exchanges,

                        note:
                            "The earliest tool exchanges were removed to stay within the context budget. Re-run a tool if you need that detail again."
                    })
            }
        );
    }

    report.after =
        conversationSize(messages);

    return report;
}


/*
|--------------------------------------------------------------------------
| Digest
|--------------------------------------------------------------------------
|
| Mechanical compression keeps the shape of an old exchange but loses its
| meaning: "fs_read ok, 12000 characters" does not tell the next
| iteration what was in the file. When a summariser is available the
| oldest exchanges are therefore replaced by one digest message written
| by the model itself, which is what makes a long run able to keep the
| knowledge it paid for while dropping the bytes.
|
| The mechanical path stays as the fallback, because a digest costs a
| request and can fail.
|--------------------------------------------------------------------------
*/

const DIGEST_MARKER = "context_digest";


function isDigest(message) {

    return (
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes(DIGEST_MARKER)
    );
}


function transcriptFor(messages, exchanges) {

    const lines = [];

    for (const exchange of exchanges) {

        for (
            let index = exchange.start;
            index <= exchange.end;
            index++
        ) {

            const message = messages[index];

            if (message.role === "assistant") {

                const names =
                    (message.tool_calls || []).map(
                        call => call.function.name
                    );

                lines.push(`called: ${names.join(", ")}`);

                continue;
            }

            lines.push(
                `result: ${message.content.slice(0, 1200)}`
            );
        }
    }

    return lines.join("\n");
}


/*
| Replaces the oldest exchanges with a single digest message. The caller
| supplies summarise(text) so this module stays free of transport
| concerns and can be tested without a model.
*/

async function digestOldest(
    messages,
    {
        summarise,
        exchangesToDigest,
        keepRecentExchanges
    }
) {

    const exchanges =
        findExchanges(messages);

    const keep =
        Math.max(
            1,
            keepRecentExchanges ??
            settings.get("KEEP_RECENT_EXCHANGES")
        );

    const available =
        Math.max(0, exchanges.length - keep);

    const count =
        Math.min(
            available,
            exchangesToDigest ?? available
        );

    if (count < 2) {
        return null;
    }

    const target =
        exchanges.slice(0, count);

    const transcript =
        transcriptFor(messages, target);

    let digest;

    try {

        digest =
            await summarise(transcript);

    } catch (error) {

        return {
            failed: true,
            reason: error.message
        };
    }

    if (
        typeof digest !== "string" ||
        digest.trim() === ""
    ) {

        return {
            failed: true,
            reason: "the summariser returned nothing"
        };
    }

    const before =
        conversationSize(messages);

    const first = target[0].start;

    const last =
        target[target.length - 1].end;

    messages.splice(
        first,
        last - first + 1,
        {
            role: "system",

            content:
                JSON.stringify({
                    type: DIGEST_MARKER,

                    covers_exchanges: count,

                    digest:
                        digest.slice(
                            0,
                            settings.get("CONTEXT_SUMMARY_CHARS")
                        ),

                    note:
                        "These earlier tool exchanges were replaced by this digest. Re-run a tool if you need the exact output again."
                })
        }
    );

    return {
        failed: false,
        digested_exchanges: count,
        before,
        after: conversationSize(messages)
    };
}


module.exports = {
    LEVELS,
    DIGEST_MARKER,
    isDigest,
    digestOldest,
    conversationSize,
    compactConversation,
    findExchanges,
    levelForPosition
};
