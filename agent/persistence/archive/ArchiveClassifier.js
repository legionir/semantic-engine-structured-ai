"use strict";

/*
|--------------------------------------------------------------------------
| Archive classifier
|--------------------------------------------------------------------------
|
| What a record is worth and what it says: importance weights, the kind
| of a tool call, its title and summary, and turning transcript exchanges
| into archive events.
|--------------------------------------------------------------------------
*/

const path = require("path");
const settings = require("../../config");
const { clip } = require("./ArchiveStore");


/*
| A record is important because of what it did, not because of how it
| reads. The weights are ordered from "this changed the world" down to
| "this can be looked up again in a second".
*/

const IMPORTANCE = {
    failure: "failure",
    decision: "decision",
    mutation: "mutation",
    command: "command",
    inspection: "inspection",
    rollup: "rollup"
};


const MUTATING_TOOLS = [
    "fs_write",
    "fs_edit",
    "fs_mkdir",
    "fs_move",
    "fs_delete",
    "git_add",
    "git_commit",
    "git_checkout",
    "git_branch",
    "git_push",
    "git_worktree"
];


const DECISION_TOOLS = [
    "plan_set",
    "plan_update"
];


const COMMAND_TOOLS = [
    "terminal_exec",
    "process_start",
    "process_write",
    "process_terminate"
];


/*
| Importance is a class, not a hand tuned float, so the reason a record
| survived a roll up is readable in the file itself.
*/

function importanceOf(kind) {

    switch (kind) {

        case IMPORTANCE.failure:
            return settings.get("ARCHIVE_WEIGHT_FAILURE");

        case IMPORTANCE.decision:
            return settings.get("ARCHIVE_WEIGHT_DECISION");

        case IMPORTANCE.mutation:
            return settings.get("ARCHIVE_WEIGHT_MUTATION");

        case IMPORTANCE.command:
            return settings.get("ARCHIVE_WEIGHT_COMMAND");

        case IMPORTANCE.rollup:
            return settings.get("ARCHIVE_WEIGHT_ROLLUP");

        default:
            return settings.get("ARCHIVE_WEIGHT_INSPECTION");
    }
}


function classify(tool, failed) {

    if (failed) {
        return IMPORTANCE.failure;
    }

    if (DECISION_TOOLS.includes(tool)) {
        return IMPORTANCE.decision;
    }

    if (MUTATING_TOOLS.includes(tool)) {
        return IMPORTANCE.mutation;
    }

    if (COMMAND_TOOLS.includes(tool)) {
        return IMPORTANCE.command;
    }

    return IMPORTANCE.inspection;
}


/*
| A tool result arrives as a JSON string. The interesting parts of it
| for retrieval are the paths, the command, and the error, so those are
| lifted into the title and the tags instead of being buried in a body
| nobody will open.
*/

function describe(tool, argumentsText, resultText) {

    let args = {};

    try {

        args =
            JSON.parse(argumentsText || "{}") || {};

    } catch {

        args = {};
    }

    const paths =
        [
            args.path,
            args.file,
            args.destination,
            args.from,
            args.to,
            ...(Array.isArray(args.paths) ? args.paths : [])
        ].filter(
            value => typeof value === "string" && value !== ""
        );

    const subject =
        args.command ||
        args.query ||
        args.pattern ||
        args.url ||
        paths[0] ||
        "";

    let failed = false;
    let error = "";

    try {

        const parsed = JSON.parse(resultText);

        if (parsed && typeof parsed === "object") {

            failed =
                parsed.error === true ||
                typeof parsed.code === "string" &&
                typeof parsed.message === "string" &&
                parsed.retryable !== undefined;

            error =
                typeof parsed.message === "string"
                    ? parsed.message
                    : "";

            if (parsed.exit_code && parsed.exit_code !== 0) {
                failed = true;
            }
        }

    } catch {

        /* a non JSON result is still a result */
    }

    return {
        subject: clip(subject, settings.get("ARCHIVE_TITLE_CHARS")),
        paths,
        failed,
        error: clip(error, settings.get("ARCHIVE_TITLE_CHARS"))
    };
}


/*
| Turns the exchanges that are about to leave the transcript into
| archive events. This runs before the summariser, so the archive keeps
| its record even when the summariser is down.
*/

function eventsFromExchanges(messages, exchanges, meta = {}) {

    const events = [];

    for (const exchange of exchanges) {

        const assistant = messages[exchange.start];

        const calls =
            Array.isArray(assistant?.tool_calls)
                ? assistant.tool_calls
                : [];

        const results = new Map();

        for (
            let index = exchange.start + 1;
            index <= exchange.end;
            index++
        ) {

            const message = messages[index];

            if (message.role !== "tool") {
                continue;
            }

            results.set(
                message.tool_call_id,
                typeof message.content === "string"
                    ? message.content
                    : JSON.stringify(message.content)
            );
        }

        for (const call of calls) {

            const tool = call.function?.name || "unknown";

            const resultText =
                results.get(call.id) || "";

            const described =
                describe(
                    tool,
                    call.function?.arguments,
                    resultText
                );

            const kind =
                classify(tool, described.failed);

            events.push({
                agent: meta.agent || "main_agent",
                run: meta.run || null,
                tool,
                kind,

                title:
                    described.subject === ""
                        ? tool
                        : `${tool} ${described.subject}`,

                tags:
                    [
                        tool,
                        ...described.paths.map(
                            value => path.basename(value)
                        )
                    ].slice(
                        0,
                        settings.get("ARCHIVE_MAX_TAGS")
                    ),

                error: described.error,

                body:
                    clip(
                        resultText,
                        settings.get("ARCHIVE_BODY_CHARS")
                    )
            });
        }
    }

    return events;
}


module.exports = {
    IMPORTANCE,
    classify,
    describe,
    eventsFromExchanges,
    importanceOf
};
