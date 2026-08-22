const fs = require("fs");
const path = require("path");

const settings = require("./storage");

const { WORKSPACE_ROOT } = require("./workspace");


/*
|--------------------------------------------------------------------------
| Working Memory
|--------------------------------------------------------------------------
|
| Summarising the whole history in one call assumes the summariser can
| hold the whole history, which is exactly the assumption that fails
| once a run is long. Memory is therefore built incrementally, and it is
| structured rather than prose:
|
|   Memory(t-1) + one chunk of new material -> small model -> Memory(t)
|
| The summariser never sees more than one chunk plus the current memory,
| so a 1B model with an 8K window can compress a 500K token run.
|
| The transcript then has three layers, and only the middle one is ever
| rewritten:
|
|   system and permanent instructions   untouched
|   working memory                      rewritten in place
|   recent exchanges                    untouched
|
| Free prose loses the things an agent actually needs later, so memory
| is a small object of lists: goals, decisions, requirements,
| constraints, facts, open tasks and done work. Lists deduplicate and
| are capped, which is what stops memory itself from growing without
| bound.
|--------------------------------------------------------------------------
*/

const MEMORY_MARKER = "working_memory";

const FIELDS = [
    "goals",
    "decisions",
    "requirements",
    "constraints",
    "facts",
    "open_tasks",
    "done"
];


function memoryPath() {

    return path.join(WORKSPACE_ROOT, ".agent", "memory.json");
}


function emptyMemory() {

    const memory = {
        version: 1,
        updated_at: null,
        chunks_absorbed: 0
    };

    for (const field of FIELDS) {
        memory[field] = [];
    }

    return memory;
}


function loadMemory() {

    const file = memoryPath();

    if (!fs.existsSync(file)) {
        return emptyMemory();
    }

    try {

        const parsed =
            JSON.parse(fs.readFileSync(file, "utf8"));

        const memory = emptyMemory();

        for (const field of FIELDS) {

            memory[field] =
                Array.isArray(parsed[field])
                    ? parsed[field]
                    : [];
        }

        memory.updated_at = parsed.updated_at || null;

        memory.chunks_absorbed =
            Number(parsed.chunks_absorbed) || 0;

        return memory;

    } catch {

        /* a corrupt memory must never stop a run */
        return emptyMemory();
    }
}


function saveMemory(memory) {

    const file = memoryPath();

    fs.mkdirSync(path.dirname(file), { recursive: true });

    memory.updated_at = new Date().toISOString();

    fs.writeFileSync(
        file,
        `${JSON.stringify(memory, null, 2)}\n`,
        "utf8"
    );

    return memory;
}


function isEmpty(memory) {

    return FIELDS.every(
        field => (memory[field] || []).length === 0
    );
}


function memorySize(memory) {

    return JSON.stringify(memory).length;
}


/*
| Merging is deliberately boring: normalise, drop duplicates, keep the
| newest entries, cap the list. A model that repeats itself cannot
| inflate memory, and a model that forgets cannot erase it either,
| because previous entries survive unless the list overflows.
*/

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


/*
| Splits material at message boundaries so a chunk is always whole
| lines, never a sentence cut in half.
*/

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


/*
| Absorbs new material one chunk at a time. The summariser sees the
| memory plus a single chunk, never the whole history.
*/

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


/*
| A large fold used to issue one stateful request per chunk, sequentially. A
| 120K history therefore caused twenty back-to-back model calls and could
| spend minutes summarising instead of working. The exact exchanges are already
| in the archive, so one fold samples a bounded number of chunks across the
| whole range and summarises them concurrently. Each reply is merged in source
| order into the same deterministic memory lists.
*/

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

/*
| Memory can outgrow its own budget after many absorptions, so it is
| folded back into itself with the same small model.
*/

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


module.exports = {
    FIELDS,
    MEMORY_MARKER,
    emptyMemory,
    loadMemory,
    saveMemory,
    memoryPath,
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
    instructions
};
