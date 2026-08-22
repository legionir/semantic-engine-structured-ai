const fs = require("fs");
const path = require("path");

const settings = require("./storage");

const { WORKSPACE_ROOT } = require("./workspace");


/*
|--------------------------------------------------------------------------
| Event Store
|--------------------------------------------------------------------------
|
| The single source of truth for the runtime's event stream. Every event
| that is emitted on the bus is appended here once, with its correlation
| envelope (run_id, turn_id, scope, iteration). Everything else — the
| journal, the session events, the archive — is a projection of this one
| stream, so a run's full lifecycle can be reconstructed from a single
| place and the different log files no longer duplicate the same content.
|
| The store is append-only, one JSON object per line, one file per UTC day.
|--------------------------------------------------------------------------
*/

const STORE_VERSION = "1";
const pendingWrites = new Map();


function storeRoot() {

    return path.join(WORKSPACE_ROOT, ".agent", "eventstore");
}


function dayOf(at) {

    const date =
        at && !Number.isNaN(new Date(at).getTime())
            ? new Date(at)
            : new Date();

    return date.toISOString().slice(0, 10);
}


function fileFor(at) {

    return path.join(storeRoot(), `${dayOf(at)}.jsonl`);
}


function append(event) {

    if (!event || typeof event.type !== "string") {
        return null;
    }

    if (settings.get("EVENTSTORE_ENABLED") !== true) {
        return null;
    }

    try {

        fs.mkdirSync(storeRoot(), { recursive: true });

        fs.appendFileSync(
            fileFor(event.at),
            `${JSON.stringify(event)}\n`,
            "utf8"
        );

        return true;

    } catch (error) {

        /* An event store must never break the work it observes. */
        return false;
    }
}


async function appendQueued(event) {
    if (!event || typeof event.type !== "string") return false;
    if (settings.get("EVENTSTORE_ENABLED") !== true) return false;

    const file = fileFor(event.at);
    const previous = pendingWrites.get(file) || Promise.resolve();
    const next = previous
        .then(async () => {
            await fs.promises.mkdir(storeRoot(), { recursive: true });
            await fs.promises.appendFile(
                file,
                `${JSON.stringify(event)}\n`,
                "utf8"
            );
            return true;
        })
        .catch(() => false);

    pendingWrites.set(file, next);
    void next.finally(() => {
        if (pendingWrites.get(file) === next) pendingWrites.delete(file);
    });
    return next;
}


async function flush() {
    await Promise.all([...pendingWrites.values()]);
}


/*
| Re-read every stored event for a day and run it through a matcher, so a
| caller can filter by run_id, scope or seq without loading a whole file
| into memory.
*/

function readDay(at) {

    const file = fileFor(at);

    if (!fs.existsSync(file)) {
        return [];
    }

    const events = [];

    for (const line of fs.readFileSync(file, "utf8").split("\n")) {

        if (line.trim() === "") {
            continue;
        }

        try {

            events.push(JSON.parse(line));

        } catch {

            /* skip a corrupt line rather than killing the read */
        }
    }

    return events;
}


function query({
    run_id = null,
    turn_id = null,
    scope = null,
    seq_from = null,
    seq_to = null,
    types = null,
    date = null,
    date_from = null,
    date_to = null
} = {}) {

    const result = [];

    /* Resolve the set of day files to scan: an explicit date, a range, or
       every stored day. Without date filters, the whole store is scanned so
       the store can act as the historical source of truth, not just today. */
    let days;

    if (date !== null) {
        days = [dayOf(new Date(date))];
    } else if (date_from !== null || date_to !== null) {
        const start = dayOf(new Date(date_from || date_to));
        const end = dayOf(new Date(date_to || date_from));
        days = enumerateDays(start, end);
    } else {
        days = listDays();
    }

    const typeSet =
        Array.isArray(types)
            ? new Set(types)
            : null;

    for (const day of days) {

        for (const event of readDay(day)) {

            if (run_id !== null && event.run_id !== run_id) {
                continue;
            }

            if (turn_id !== null && event.turn_id !== turn_id) {
                continue;
            }

            if (scope !== null && event.scope !== scope) {
                continue;
            }

            if (seq_from !== null && (event.seq ?? 0) < seq_from) {
                continue;
            }

            if (seq_to !== null && (event.seq ?? 0) > seq_to) {
                continue;
            }

            if (typeSet && !typeSet.has(event.type)) {
                continue;
            }

            result.push(event);
        }
    }

    return result;
}


/*
| readDay expects a day key (YYYY-MM-DD); a plain timestamp/date also works
| because fileFor derives the day. To keep the query loop clear we read by
| explicit day keys.
*/

function readDay(day) {

    const file =
        typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
            ? path.join(storeRoot(), `${day}.jsonl`)
            : fileFor(day);

    if (!fs.existsSync(file)) return [];

    const events = [];
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let carry = "";

    try {
        for (;;) {
            const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytes === 0) break;

            carry += buffer.subarray(0, bytes).toString("utf8");
            const lines = carry.split("\n");
            carry = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    events.push(JSON.parse(line));
                } catch {
                    /* skip a corrupt line rather than killing the read */
                }
            }
        }

        if (carry.trim()) {
            try {
                events.push(JSON.parse(carry));
            } catch {
                /* skip a truncated/corrupt final line */
            }
        }
    } finally {
        fs.closeSync(fd);
    }

    return events;
}

function enumerateDays(start, end) {

    const days = [];

    const cursor = new Date(`${start}T00:00:00Z`);
    const stop = new Date(`${end}T00:00:00Z`);

    if (stop < cursor) {
        return [];
    }

    while (cursor <= stop) {

        days.push(cursor.toISOString().slice(0, 10));

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return days;
}


function listDays() {

    if (!fs.existsSync(storeRoot())) {
        return [];
    }

    return fs.readdirSync(storeRoot())
        .filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
        .map(name => name.replace(/\.jsonl$/, ""))
        .sort();
}


function attach(bus) {

    if (bus === undefined || bus === null) {
        return false;
    }

    bus.on("event", appendQueued);

    return true;
}


function detach(bus) {

    if (bus === undefined || bus === null) {
        return false;
    }

    bus.off("event", appendQueued);

    return true;
}


module.exports = {
    STORE_VERSION,
    storeRoot,
    dayOf,
    fileFor,
    append,
    appendQueued,
    flush,
    readDay,
    query,
    listDays,
    attach,
    detach
};
