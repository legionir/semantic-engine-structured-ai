"use strict";

/*
|--------------------------------------------------------------------------
| Process ledger (roadmap P1-07: orphan cleanup)
|--------------------------------------------------------------------------
|
| A background process (process_start, a dev server, a watcher) is started
| in its own process group, so it outlives the runtime if the runtime is
| killed: after `kill -9` or an out-of-memory kill, nothing stops it any
| more and it keeps holding memory and ports on a small server.
|
| Every running background process is written to
| <data home>/processes.json and crossed out when it exits. On the next
| start, sweep() stops what is still alive from that list. A pid can be
| reused by an unrelated process, so on Linux a process is stopped only
| when its start time (/proc/<pid>/stat) still matches the one recorded;
| elsewhere the entry is reported and dropped, never killed blind.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const AtomicFile = require("../../persistence/AtomicFile");


function ledgerFile() {

    return path.join(
        require("../../projects/ProjectStore").resolveDataHome(),
        "processes.json"
    );
}


function read() {

    try {

        const data = JSON.parse(fs.readFileSync(ledgerFile(), "utf8"));

        return data && typeof data.processes === "object" && data.processes
            ? data.processes
            : {};

    } catch {
        return {};
    }
}


function write(processes) {

    try {

        const file = ledgerFile();

        if (Object.keys(processes).length === 0) {
            fs.rmSync(file, { force: true });
            return;
        }

        fs.mkdirSync(path.dirname(file), { recursive: true });
        AtomicFile.writeFile(file, `${JSON.stringify({ processes }, null, 2)}\n`, "utf8");

    } catch {
        /* a data home that cannot be written must not stop a process */
    }
}


/* field 22 of /proc/<pid>/stat: start time in clock ticks since boot */
function startTicks(pid) {

    if (process.platform !== "linux" || !Number.isInteger(pid)) {
        return null;
    }

    try {

        const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");

        /* the command name is in parentheses and may itself contain spaces */
        const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");

        return fields[19] || null;

    } catch {
        return null;
    }
}


function alive(pid) {

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}


/* this runtime's own entries carry its pid, so a sweep never stops them */
function record(session, options = {}) {

    if (!session || !Number.isInteger(session.pid)) {
        return;
    }

    const processes = read();

    processes[`${process.pid}:${session.id}`] = {
        owner_pid: process.pid,
        id: session.id,
        pid: session.pid,
        group: options.group === true,
        start: startTicks(session.pid),
        command: String(session.command || "").slice(0, 200),
        project_id: session.project_id || null,
        started_at: new Date(session.started_at || Date.now()).toISOString()
    };

    write(processes);
}


function forget(session) {

    if (!session) {
        return;
    }

    const processes = read();
    const key = `${process.pid}:${session.id}`;

    if (processes[key]) {
        delete processes[key];
        write(processes);
    }
}


/*
| Stops what a runtime that is no longer running left behind. Entries of
| a runtime that is still alive (another console on the same data home)
| are left alone.
*/
function sweep(options = {}) {

    const processes = read();
    const killImpl = options.killImpl || ((pid, signal) => process.kill(pid, signal));
    const stopped = [];
    const skipped = [];
    let changed = false;

    for (const [key, entry] of Object.entries(processes)) {

        if (entry.owner_pid === process.pid || (entry.owner_pid && alive(entry.owner_pid))) {
            continue;
        }

        delete processes[key];
        changed = true;

        if (!alive(entry.pid)) {
            continue;
        }

        const now = startTicks(entry.pid);

        if (!entry.start || !now || now !== entry.start) {

            skipped.push({ ...entry, reason: now ? "pid reused by another process" : "cannot verify the process" });
            continue;
        }

        try {

            killImpl(entry.group ? -entry.pid : entry.pid, "SIGKILL");
            stopped.push(entry);

        } catch (error) {

            skipped.push({ ...entry, reason: error.code || error.message });
        }
    }

    if (changed) {
        write(processes);
    }

    return { stopped, skipped };
}


module.exports = {
    ledgerFile,
    read,
    record,
    forget,
    sweep,
    startTicks
};
