"use strict";

const settings = require("../config");
const memoryRepository = require("../persistence/MemoryRepository");
const { conversationSize } = require("./ConversationSizer");
const { findExchanges } = require("./ExchangeDetector");
const { archiveExchanges } = require("./ArchiveCoordinator");
const { host } = require("./contextHost");


/*
|--------------------------------------------------------------------------
| Memory coordinator (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Domain logic and fold/refresh operations use MemoryRepository for IO.
| summariseTranscript / currentRun / events arrive through the bound host
| so this module never requires agent.js.
|--------------------------------------------------------------------------
*/

const { FIELDS, MEMORY_MARKER } = memoryRepository;


function isEmpty(memory) {

    return FIELDS.every(
        field => (memory[field] || []).length === 0
    );
}


function memorySize(memory) {

    return JSON.stringify(memory).length;
}


function mergeLists(previous, incoming, limit) {

    const seen = new Map();

    for (
        const value
        of [...(previous || []), ...(incoming || [])]
    ) {

        if (typeof value !== "string") {
            continue;
        }

        const text = value.trim();

        if (text === "") {
            continue;
        }

        const key =
            text
                .toLowerCase()
                .replace(/\s+/g, " ")
                .slice(0, 160);

        seen.set(key, text);
    }

    const merged = [...seen.values()];

    return merged.length > limit
        ? merged.slice(merged.length - limit)
        : merged;
}


function mergeMemory(previous, incoming) {

    const limit =
        settings.get("MEMORY_MAX_ITEMS");

    const memory = {
        version: 1,

        updated_at: previous.updated_at,

        chunks_absorbed:
            (previous.chunks_absorbed || 0) + 1
    };

    for (const field of FIELDS) {

        memory[field] =
            mergeLists(
                previous[field],
                incoming ? incoming[field] : [],
                limit
            );
    }

    return memory;
}


function parseMemoryReply(text) {

    if (typeof text !== "string") {
        return null;
    }

    const fenced =
        /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);

    const candidate =
        (fenced ? fenced[1] : text).trim();

    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start === -1 || end <= start) {
        return null;
    }

    try {

        const parsed =
            JSON.parse(candidate.slice(start, end + 1));

        return parsed && typeof parsed === "object"
            ? parsed
            : null;

    } catch {

        return null;
    }
}


function chunkText(text, size) {

    const lines = text.split("\n");

    const chunks = [];

    let current = "";

    for (const line of lines) {

        const piece =
            line.length > size
                ? `${line.slice(0, size)}…`
                : line;

        if (
            current.length + piece.length + 1 > size &&
            current !== ""
        ) {

            chunks.push(current);

            current = "";
        }

        current += `${piece}\n`;
    }

    if (current.trim() !== "") {
        chunks.push(current);
    }

    return chunks;
}


function instructions() {

    return [
        "You maintain the working memory of a software agent.",
        "You receive the current memory as JSON and a slice of the agent's history.",
        "Return the updated memory as a single JSON object with exactly these keys:",
        FIELDS.join(", "),
        "Each key holds an array of short strings.",
        "Carry forward everything from the current memory that is still true, add what the new slice establishes, and move a task from open_tasks to done when the slice shows it finished.",
        "Record decisions, requirements, constraints, file paths, commands that worked or failed, and anything the agent would otherwise have to rediscover.",
        "Do not include raw file contents. Do not write prose outside the JSON."
    ].join(" ");
}


function selectChunks(chunks, limit) {

    if (chunks.length <= limit) {

        return chunks.map(
            (chunk, index) => ({ index, chunk })
        );
    }

    if (limit === 1) {

        return [
            {
                index: chunks.length - 1,
                chunk: chunks[chunks.length - 1]
            }
        ];
    }

    const indexes = new Set();

    for (let slot = 0; slot < limit; slot++) {

        indexes.add(
            Math.round(
                slot * (chunks.length - 1) / (limit - 1)
            )
        );
    }

    return [...indexes]
        .sort((left, right) => left - right)
        .map(index => ({ index, chunk: chunks[index] }));
}


async function absorb(memory, material, summarise, options = {}) {

    const getSignal =
        typeof options.getSignal === "function"
            ? options.getSignal
            : null;

    const assertActive = () => {

        if (!getSignal) {
            return;
        }

        const signal = getSignal();

        if (signal?.aborted) {
            throw signal.reason instanceof Error
                ? signal.reason
                : new Error("Memory absorption was cancelled");
        }
    };

    assertActive();

    const chunkSize =
        settings.get("MEMORY_CHUNK_CHARS");

    const chunks =
        chunkText(material, chunkSize);

    const selected =
        selectChunks(
            chunks,
            settings.get("MEMORY_MAX_SUMMARY_CALLS")
        );

    const parallelism =
        settings.get("MEMORY_SUMMARY_PARALLELISM");

    const baseMemory =
        JSON.stringify(
            Object.fromEntries(
                FIELDS.map(field => [field, memory[field]])
            )
        );

    const failures = [];
    const parsedReplies = [];

    const runOne = async entry => {

        assertActive();

        const prompt =
            [
                "Current memory:",
                baseMemory,
                "",
                `New history slice ${entry.index + 1} of ${chunks.length}:`,
                entry.chunk
            ].join("\n");

        let reply;

        try {
            reply = await summarise(prompt, instructions());
        } catch (error) {

            /* A failed summary is harmless; a cancelled run is not permission
               to move on to the next batch. Re-check the live signal so an
               aborted fetch stops the entire fold immediately. */
            assertActive();

            return {
                index: entry.index,
                failure: error.message
            };
        }

        const parsed = parseMemoryReply(reply);

        return parsed
            ? { index: entry.index, parsed }
            : {
                index: entry.index,
                failure: "the summariser did not return JSON"
            };
    };

    for (
        let offset = 0;
        offset < selected.length;
        offset += parallelism
    ) {

        assertActive();

        const batch =
            await Promise.all(
                selected
                    .slice(offset, offset + parallelism)
                    .map(runOne)
            );

        assertActive();

        for (const result of batch) {

            if (result.failure) {
                failures.push(result.failure);
            } else {
                parsedReplies.push(result);
            }
        }
    }

    let current = memory;

    for (
        const result
        of parsedReplies.sort((left, right) => left.index - right.index)
    ) {
        current = mergeMemory(current, result.parsed);
    }

    return {
        memory: current,
        chunks: chunks.length,
        attempted: selected.length,
        skipped: Math.max(0, chunks.length - selected.length),
        absorbed: parsedReplies.length,
        failures
    };
}


async function condense(memory, summarise) {

    const limit =
        settings.get("MEMORY_MAX_CHARS");

    if (memorySize(memory) <= limit) {
        return { memory, condensed: false };
    }

    const prompt =
        [
            "Current memory:",
            JSON.stringify(
                Object.fromEntries(
                    FIELDS.map(field => [field, memory[field]])
                )
            ),
            "",
            "This memory is too large. Merge duplicates and near duplicates, drop what is obsolete or superseded, and keep every decision, requirement, constraint and open task that still matters."
        ].join("\n");

    let reply;

    try {

        reply = await summarise(prompt, instructions());

    } catch {

        return { memory, condensed: false };
    }

    const parsed =
        parseMemoryReply(reply);

    if (!parsed) {
        return { memory, condensed: false };
    }

    const rebuilt = {
        version: 1,

        updated_at: memory.updated_at,

        chunks_absorbed: memory.chunks_absorbed
    };

    for (const field of FIELDS) {

        rebuilt[field] =
            mergeLists(
                [],
                parsed[field],
                settings.get("MEMORY_MAX_ITEMS")
            );
    }

    return {
        memory: rebuilt,
        condensed: true
    };
}


function memoryMessage(memory) {

    return {
        role: "system",

        content:
            JSON.stringify({
                type: MEMORY_MARKER,

                note:
                    "Compressed knowledge from earlier in this run and from previous runs. Treat it as established, and re-run a tool when you need exact output again.",

                memory:
                    Object.fromEntries(
                        FIELDS.map(field => [field, memory[field]])
                    )
            })
    };
}


function isMemoryMessage(message) {

    return (
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes(`"${MEMORY_MARKER}"`)
    );
}


function refreshMemoryMessage(messages, memory) {

    const message =
        memoryMessage(memory);

    const existing =
        messages.findIndex(isMemoryMessage);

    if (existing !== -1) {

        messages[existing] = message;

        return;
    }

    const firstUser =
        messages.findIndex(
            item => item.role === "user"
        );

    messages.splice(
        firstUser === -1
            ? messages.length
            : firstUser + 1,
        0,
        message
    );
}


async function foldIntoMemory(messages, scope) {

    const runtime = host();

    const exchanges =
        findExchanges(messages);

    const keep =
        Math.max(
            1,
            settings.get("KEEP_RECENT_EXCHANGES")
        );

    const foldable =
        exchanges.slice(
            0,
            Math.max(0, exchanges.length - keep)
        );

    if (foldable.length === 0) {
        return null;
    }

    /*
    | The material leaves the transcript whether or not the summariser
    | succeeds, but it is only removed after a successful absorption.
    */

    const material =
        foldable.map(exchange => {

            const lines = [];

            for (
                let index = exchange.start;
                index <= exchange.end;
                index++
            ) {

                const message = messages[index];

                if (message.role === "assistant") {

                    lines.push(
                        `called: ${
                            (message.tool_calls || [])
                                .map(call => call.function.name)
                                .join(", ")
                        }`
                    );

                    continue;
                }

                lines.push(`result: ${message.content}`);
            }

            return lines.join("\n");
        }).join("\n");

    const before =
        conversationSize(messages);

    /*
    | The archive is written before the summariser is called, and it is
    | written whether or not the summariser answers. Working memory is a
    | lossy view of these exchanges; the archive is the copy that keeps
    | the exact error text and the exact path, retrievable later with
    | archive_search.
    */

    const archived =
        archiveExchanges(messages, foldable, scope);

    const absorbed =
        await absorb(
            memoryRepository.loadMemory(),
            material,
            runtime.summariseTranscript,
            {
                getSignal: () => {
                    runtime.assertRunActive("folding history into memory");
                    return runtime.currentRun().controller?.signal;
                }
            }
        );

    if (absorbed.absorbed === 0) {

        runtime.logLine(
            scope,
            `Could not fold history into memory (${
                absorbed.failures[0] || "no chunk absorbed"
            }); compressing mechanically instead.`
        );

        return null;
    }

    const condensed =
        await condense(
            absorbed.memory,
            runtime.summariseTranscript
        );

    memoryRepository.saveMemory(condensed.memory);

    /*
    | Drop the folded exchanges and refresh the memory message.
    */

    const first = foldable[0].start;

    const last =
        foldable[foldable.length - 1].end;

    messages.splice(first, last - first + 1);

    refreshMemoryMessage(messages, condensed.memory);

    const report = {
        folded_exchanges:
            foldable.length,

        chunks:
            absorbed.chunks,

        summary_calls:
            absorbed.attempted,

        skipped_chunks:
            absorbed.skipped,

        absorbed:
            absorbed.absorbed,

        condensed:
            condensed.condensed,

        archived:
            archived
                ? archived.added
                : 0,

        archive_duplicates:
            archived
                ? archived.duplicates
                : 0,

        before,

        after:
            conversationSize(messages)
    };

    runtime.logLine(
        scope,
        `Folded ${report.folded_exchanges} exchanges into memory with ${
            report.summary_calls
        } summariser call(s) across ${report.chunks} chunk(s)${
            report.skipped_chunks
                ? ` (${report.skipped_chunks} archive-only)`
                : ""
        }, ${
            Math.round(report.before / 1000)
        }k to ${
            Math.round(report.after / 1000)
        }k${
            report.condensed
                ? ", memory condensed"
                : ""
        }${
            report.archived
                ? `, ${report.archived} archived`
                : ""
        }`
    );

    runtime.events.emit("context:memory", {
        agent: scope || "main_agent",
        ...report
    });

    return report;
}


module.exports = {
    FIELDS,
    MEMORY_MARKER,
    memorySize,
    isEmpty,
    mergeMemory,
    mergeLists,
    parseMemoryReply,
    chunkText,
    selectChunks,
    absorb,
    condense,
    memoryMessage,
    isMemoryMessage,
    instructions,
    refreshMemoryMessage,
    foldIntoMemory
};
