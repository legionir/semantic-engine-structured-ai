"use strict";

/*
|--------------------------------------------------------------------------
| Log Store
|--------------------------------------------------------------------------
|
| One application log for the whole process: failed model requests,
| retries, run failures, tool and hook failures, MCP problems, server
| errors and crashes. Every entry is redacted before it is kept, held in
| a bounded ring for the console, and — once persistTo() is called by the
| serve command — appended to a rotating JSONL file so the history
| survives a restart. Tests that only load the runtime never write files.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const settings = require("../config");
const { redactSecrets, maskText } = require("../events/EventRedactor");

const LEVELS = Object.freeze(["debug", "info", "warn", "error"]);
const LEVEL_RANK = Object.freeze({ debug: 0, info: 1, warn: 2, error: 3 });
const FILE_NAME = "structured-ai.jsonl";


function setting(key, fallback) {
    try {
        const value = settings.get(key);
        return value === undefined || value === null ? fallback : value;
    } catch {
        return fallback;
    }
}


function clip(text, limit) {
    const value = String(text ?? "");
    return value.length > limit ? `${value.slice(0, limit)}… (${value.length - limit} more chars)` : value;
}


/* Details are kept as plain JSON: errors become {name, message, code},
   long strings are clipped, and the whole object is bounded. */
function fieldLimit() {
    return Math.max(500, Number(setting("LOG_MAX_FIELD_CHARS", 8000)) || 8000);
}


function fileLimitBytes() {
    return Math.max(1, Number(setting("LOG_FILE_MAX_MB", 10)) || 10) * 1024 * 1024;
}


function plainDetails(details) {

    const limit = fieldLimit();

    if (details === undefined || details === null) return undefined;

    let json;
    try {
        json = JSON.stringify(details, (key, value) => {
            if (value instanceof Error) {
                return { name: value.name, message: value.message, code: value.code, status: value.status };
            }
            if (typeof value === "string") return clip(value, limit);
            if (typeof value === "bigint") return String(value);
            return value;
        });
    } catch {
        return { note: "details could not be serialised" };
    }

    if (json === undefined) return undefined;
    if (json.length > limit * 2) {
        return { truncated: true, preview: clip(json, limit) };
    }
    return JSON.parse(json);
}


class LogStore extends EventEmitter {

    constructor(options = {}) {
        super();
        this.setMaxListeners(0);
        this.entries = [];
        this.nextId = 1;
        this.dir = null;
        this.pending = [];
        this.writing = null;
        this.loaded = true;
        this.attachedBuses = new WeakSet();
        this.clock = options.clock || (() => Date.now());
        this.capacityOverride = options.capacity || null;
        this.processHooks = null;
    }


    capacity() {
        return this.capacityOverride || Math.max(100, Number(setting("LOG_BUFFER_ENTRIES", 2000)) || 2000);
    }


    minimumLevel() {
        const level = setting("LOG_LEVEL", "info");
        return LEVEL_RANK[level] === undefined ? LEVEL_RANK.info : LEVEL_RANK[level];
    }


    /*
    | record("error", "ai", "AI request failed", {...}) -> entry or null
    | A level below LOG_LEVEL is dropped; an unknown level is "info".
    */
    record(level, source, message, details) {

        const safeLevel = LEVEL_RANK[level] === undefined ? "info" : level;

        if (LEVEL_RANK[safeLevel] < this.minimumLevel()) return null;

        const context = details && typeof details === "object" ? details : {};
        const entry = {
            id: this.nextId++,
            at: new Date(this.clock()).toISOString(),
            level: safeLevel,
            source: clip(String(source || "app").toLowerCase(), 40),
            message: maskText(clip(message, fieldLimit()))
        };

        for (const key of ["run_id", "project_id"]) {
            if (typeof context[key] === "string" && context[key]) entry[key] = context[key];
        }

        const plain = plainDetails(details);
        if (plain !== undefined) entry.details = redactSecrets(plain);

        this.push(entry);
        this.enqueue(entry);
        this.emit("entry", entry);

        return entry;
    }


    debug(source, message, details) { return this.record("debug", source, message, details); }
    info(source, message, details) { return this.record("info", source, message, details); }
    warn(source, message, details) { return this.record("warn", source, message, details); }
    error(source, message, details) { return this.record("error", source, message, details); }


    push(entry) {
        this.entries.push(entry);
        const overflow = this.entries.length - this.capacity();
        if (overflow > 0) this.entries.splice(0, overflow);
    }


    /*
    | list({ level, source, q, after, limit }) -> newest last.
    | `level` is a minimum level, `after` an entry id for incremental reads.
    */
    list(filter = {}) {

        this.preload();

        const minimum = LEVEL_RANK[filter.level] ?? 0;
        const source = filter.source ? String(filter.source).toLowerCase() : "";
        const query = filter.q ? String(filter.q).toLowerCase() : "";
        const after = Number(filter.after) || 0;
        const limit = Math.min(Math.max(Number(filter.limit) || this.capacity(), 1), this.capacity());

        const matches = this.entries.filter(entry =>
            entry.id > after &&
            LEVEL_RANK[entry.level] >= minimum &&
            (!source || entry.source === source) &&
            (!query || JSON.stringify(entry).toLowerCase().includes(query))
        );

        return matches.slice(-limit);
    }


    summary() {
        this.preload();
        const counts = { debug: 0, info: 0, warn: 0, error: 0 };
        const sources = new Set();
        for (const entry of this.entries) {
            counts[entry.level]++;
            sources.add(entry.source);
        }
        return {
            counts,
            sources: [...sources].sort(),
            total: this.entries.length,
            last_id: this.nextId - 1,
            capacity: this.capacity(),
            file: this.dir ? path.join(this.dir, FILE_NAME) : null
        };
    }


    /* The ring is emptied and the current file rotated away, so cleared
       entries do not come back on restart but stay in the .1 file. */
    async clear() {
        this.entries = [];
        await this.flush();
        if (this.file()) await this.rotate().catch(() => {});
        this.emit("cleared");
    }


    /* -------------------------------------------------------- file sink */

    persistTo(dir) {
        this.dir = path.resolve(dir);
        fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        this.loaded = false;
        this.preload();
        return this;
    }


    file() {
        return this.dir ? path.join(this.dir, FILE_NAME) : null;
    }


    /* The file's newest entries are read back once, so the console shows
       what happened before the restart. */
    preload() {

        if (this.loaded || !this.dir) return;
        this.loaded = true;

        const file = this.file();
        let text = "";

        try {
            const stat = fs.statSync(file);
            /* the file never grows past LOG_FILE_MAX_MB, so this bounds the read */
            const start = Math.max(0, stat.size - fileLimitBytes());
            const fd = fs.openSync(file, "r");
            try {
                const buffer = Buffer.alloc(stat.size - start);
                fs.readSync(fd, buffer, 0, buffer.length, start);
                text = buffer.toString("utf8");
            } finally {
                fs.closeSync(fd);
            }
        } catch {
            return;
        }

        const restored = [];
        for (const line of text.split("\n").slice(-this.capacity())) {
            try {
                const entry = JSON.parse(line);
                if (entry && LEVEL_RANK[entry.level] !== undefined && entry.message !== undefined) {
                    restored.push({ ...entry, restored: true });
                }
            } catch {
                /* a partial first line or a corrupt record is skipped */
            }
        }

        /* restored records come first; ids are reassigned once, at startup,
           before any console has read an id */
        let id = 1;
        this.entries = [...restored, ...this.entries].map(entry => ({ ...entry, id: id++ }));
        this.nextId = id;
        const overflow = this.entries.length - this.capacity();
        if (overflow > 0) this.entries.splice(0, overflow);
    }


    enqueue(entry) {
        if (!this.dir || !setting("LOG_FILE_ENABLED", true)) return;
        this.pending.push(`${JSON.stringify(entry)}\n`);
        if (!this.writing) this.writing = new Promise(resolve => setImmediate(resolve)).then(() => this.drain());
    }


    async drain() {
        try {
            while (this.pending.length > 0) {
                const chunk = this.pending.splice(0).join("");
                await this.rotateIfNeeded(Buffer.byteLength(chunk));
                await fs.promises.appendFile(this.file(), chunk, { mode: 0o600 });
            }
        } catch (error) {
            /* the file sink must never break the runtime; the ring still has it */
            this.pending = [];
            this.emit("sink-error", error);
        } finally {
            this.writing = null;
        }
    }


    async rotateIfNeeded(incoming) {
        const limit = fileLimitBytes();
        let size = 0;
        try {
            size = (await fs.promises.stat(this.file())).size;
        } catch {
            return;
        }
        if (size + incoming <= limit) return;
        await this.rotate();
    }


    async rotate() {
        await fs.promises.access(this.file());
        const keep = Math.max(1, Number(setting("LOG_FILE_KEEP", 3)) || 3);
        /* .keep and anything older (left by a larger LOG_FILE_KEEP) is dropped */
        for (const name of await fs.promises.readdir(this.dir).catch(() => [])) {
            const index = name.startsWith(`${FILE_NAME}.`) ? Number(name.slice(FILE_NAME.length + 1)) : NaN;
            if (Number.isInteger(index) && index >= keep) {
                await fs.promises.rm(path.join(this.dir, name), { force: true }).catch(() => {});
            }
        }
        for (let index = keep - 1; index >= 1; index--) {
            await fs.promises.rename(`${this.file()}.${index}`, `${this.file()}.${index + 1}`).catch(() => {});
        }
        await fs.promises.rename(this.file(), `${this.file()}.1`);
    }


    /* Resolves once everything recorded so far is on disk. */
    async flush() {
        while (this.writing) await this.writing;
    }


    /* The whole persisted file (or the ring as JSONL when there is none). */
    async exportText() {
        await this.flush();
        if (this.file()) {
            try {
                return await fs.promises.readFile(this.file(), "utf8");
            } catch {
                /* nothing written yet */
            }
        }
        return this.entries.map(entry => JSON.stringify(entry)).join("\n") + (this.entries.length ? "\n" : "");
    }


    /* ------------------------------------------------- runtime sources */

    attachToBus(bus) {
        if (!bus || typeof bus.on !== "function" || this.attachedBuses.has(bus)) return false;
        this.attachedBuses.add(bus);
        bus.on("event", event => {
            try {
                const mapped = require("./LogEventMap").entryForEvent(event);
                if (mapped) this.record(mapped.level, mapped.source, mapped.message, mapped.details);
            } catch {
                /* a log mapping must never break event delivery */
            }
        });
        return true;
    }


    /*
    | The monitor variants observe a crash without changing what Node does
    | about it, so the process still exits; the record is written
    | synchronously because nothing asynchronous runs after that.
    */
    installProcessHooks(target = process) {

        if (this.processHooks) return false;

        const crash = (error, origin) => {
            const entry = this.record("error", "process", `Uncaught ${origin === "unhandledRejection" ? "promise rejection" : "exception"}: ${error && error.message || String(error)}`, {
                origin,
                stack: error && error.stack ? clip(error.stack, 4000) : undefined
            });
            if (entry && this.file() && setting("LOG_FILE_ENABLED", true)) {
                try {
                    this.pending = [];
                    fs.appendFileSync(this.file(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
                } catch {
                    /* the process is going down regardless */
                }
            }
        };

        const warning = item => this.record("warn", "process", `${item.name || "Warning"}: ${item.message}`, { code: item.code });

        target.on("uncaughtExceptionMonitor", crash);
        target.on("warning", warning);
        this.processHooks = { target, crash, warning };

        return true;
    }


    removeProcessHooks() {
        if (!this.processHooks) return;
        const { target, crash, warning } = this.processHooks;
        target.removeListener("uncaughtExceptionMonitor", crash);
        target.removeListener("warning", warning);
        this.processHooks = null;
    }
}


const logs = new LogStore();


module.exports = {
    LEVELS,
    LEVEL_RANK,
    LogStore,
    logs,
    clip
};
