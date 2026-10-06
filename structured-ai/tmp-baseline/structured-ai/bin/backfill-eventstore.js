#!/usr/bin/env node

"use strict";

/*
|--------------------------------------------------------------------------
| Event store backfill
|--------------------------------------------------------------------------
|
| One-time migration helper. Before the event store existed, a session's
| events were kept only in its file (and capped), and runs could not be
| attributed by run_id. This reads every stored session under
| <workspace>/.agent/sessions, reconstructs a run_id for each event from the
| run:start boundaries (by seq), and writes them into the event store with
| the correlation envelope, deduped on (run_id, seq).
|
| Usage:
|   node bin/backfill-eventstore.js [--workspace <dir>]
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

let workspace =
    process.env.WORKSPACE_ROOT ||
    process.cwd();

for (let i = 2; i < process.argv.length; i++) {

    if (process.argv[i] === "--workspace") {
        workspace = process.argv[++i];
    }
}

const sessionsDir =
    path.join(workspace, ".agent", "sessions");

const storeDir =
    path.join(workspace, ".agent", "eventstore");


function dayOf(at) {

    return new Date(at || Date.now()).toISOString().slice(0, 10);
}


function append(event) {

    fs.mkdirSync(storeDir, { recursive: true });

    const file = path.join(storeDir, `${dayOf(event.at)}.jsonl`);

    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}


function existingKeys() {

    const keys = new Set();

    if (!fs.existsSync(storeDir)) {
        return keys;
    }

    for (const name of fs.readdirSync(storeDir)) {

        if (!/\.jsonl$/.test(name)) {
            continue;
        }

        for (const line of fs.readFileSync(path.join(storeDir, name), "utf8").split("\n")) {

            if (line.trim() === "") {
                continue;
            }

            try {

                const e = JSON.parse(line);
                keys.add(`${e.run_id || ""}|${e.seq}`);

            } catch {

                /* skip corrupt */
            }
        }
    }

    return keys;
}


function reconstructRuns(events) {

    const runs = [];
    let current = null;

    for (const event of events) {

        if (event.type === "run:start") {
            current = { run_id: event.run_id || `run-${event.at}`, start: event.seq, end: Infinity };
            runs.push(current);
            continue;
        }

        if (current && (event.seq ?? 0) >= current.start) {
            current.end = Math.max(current.end, event.seq ?? 0);
        }
    }

    return runs;
}


function main() {

    if (!fs.existsSync(sessionsDir)) {

        console.error(`No sessions directory at ${sessionsDir}`);
        process.exit(1);
    }

    const keys = existingKeys();
    let added = 0;
    let skipped = 0;

    for (const name of fs.readdirSync(sessionsDir)) {

        if (!/^s-.*\.json$/.test(name)) {
            continue;
        }

        const file = path.join(sessionsDir, name);
        let session;

        try {

            session = JSON.parse(fs.readFileSync(file, "utf8"));

        } catch {

            console.error(`Skipping corrupt session ${name}`);
            continue;
        }

        const events = Array.isArray(session.events) ? session.events : [];

        if (events.length === 0) {
            continue;
        }

        /* sort by seq so run:start boundaries are meaningful */
        const sorted = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

        const runs = reconstructRuns(sorted);

        for (const event of sorted) {

            let run_id = event.run_id || null;

            if (!run_id) {

                const run =
                    runs.find(
                        r => (event.seq ?? 0) >= r.start && (event.seq ?? 0) <= r.end
                    );

                run_id = run ? run.run_id : null;
            }

            const enriched = {
                ...event,
                run_id,
                turn_id: event.turn_id || null,
                scope: event.scope || event.agent || null,
                iteration: event.iteration ?? null
            };

            const key = `${run_id || ""}|${event.seq}`;

            if (keys.has(key)) {
                skipped++;
                continue;
            }

            append(enriched);
            keys.add(key);
            added++;
        }
    }

    console.log(`Backfill complete: ${added} event(s) added, ${skipped} skipped (already present).`);
}


main();
