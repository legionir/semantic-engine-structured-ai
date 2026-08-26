"use strict";

const fs = require("fs");
const path = require("path");

const settings = require("../config");
const dataRoot = require("../persistence/DataRoot");
const { safeName } = require("./SafeIdentifier");
const SchemaVersion = require("./SchemaVersion");


/*
|--------------------------------------------------------------------------
| Journal repository (EXECUTION_PLAN Phase 18)
|--------------------------------------------------------------------------
|
| Canonical journal repository. Paths, JSONL shape and per-run buckets
| remain stable; append-only files skip a truncated last line on read.
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Per-Agent JSONL Journal
|--------------------------------------------------------------------------
|
| The event stream is transient and session events are UI-oriented. The
| journal is an append-only, machine-readable audit trail: one file per UTC
| day and agent, one complete JSON object per line. It records lifecycle,
| thinking returned by an endpoint, and completed tool calls with bounded
| arguments/results.
|--------------------------------------------------------------------------
*/

const VERSION = SchemaVersion.CURRENT.journal;

let pendingJournal = Promise.resolve();
let pendingJournalWrites = Promise.resolve();

const STATE = {
    attached: false,
    run_id: null,
    task: null,
    agents: new Map(),
    models: new Map(),
    pending_tools: new Map(),
    last_error: null
};

/*
| Phase 8 (گام ۱): attribution state is bucketed per run_id, so two
| concurrent modular runs never overwrite each other's task/agent/
| model maps. STATE stays the ambient (legacy) bucket and always
| mirrors the most recent run's bucket, which keeps the historical
| single-run semantics — and the exported _state view — bit-identical.
*/
const RUN_BUCKETS = new Map();


/* Phase 8: the journal lives under the active project's data root. */
function journalRoot(root) {
    return path.join(dataRoot.resolveRoot(root), "journal");
}


function newBucket(runId, task) {

    const agents = new Map();

    agents.set("main_agent", {
        agent: "main_agent",
        depth: 0,
        parent: null,
        parent_scope: null
    });

    return {
        run_id: runId,
        task: task || null,
        agents,
        models: new Map(),
        pending_tools: new Map(),
        root: null
    };
}


/* The bucket an event belongs to: its own run's if one was opened,
   otherwise the ambient legacy bucket (events without a run keep the
   historical behavior of writing through STATE). */
function bucketFor(event) {

    const runId = event && event.run_id;

    if (runId && RUN_BUCKETS.has(runId)) {
        return RUN_BUCKETS.get(runId);
    }

    return STATE;
}


/* Where a record lands: the bucket root pinned at run:start wins
   (every record of a run stays together), then the event envelope's
   registered project (modular), then ambient resolution. */
function rootFor(event, bucket) {

    if (bucket && bucket.root) {
        return bucket.root;
    }

    if (event && typeof event === "object") {

        const scoped = dataRoot.dataRootForProjectId(event.project_id);

        if (scoped) {
            return scoped;
        }

    }

    return dataRoot.currentRoot();
}


function clock(at) {

    const instant =
        new Date(at || Date.now());

    const iso = instant.toISOString();

    return {
        timestamp: iso,
        date: iso.slice(0, 10),
        time: iso.slice(11, 23),
        timezone: "UTC"
    };
}


function fileFor(agent, at, root) {

    const stamp = clock(at);

    return path.join(
        journalRoot(root),
        stamp.date,
        `${safeName(agent)}.jsonl`
    );
}


function bounded(value) {

    if (value === undefined) {
        return null;
    }

    const maximum =
        settings.get("JOURNAL_MAX_FIELD_CHARS");

    let encoded;

    try {
        encoded = JSON.stringify(value);
    } catch {
        encoded = JSON.stringify(String(value));
    }

    if (encoded.length <= maximum) {
        return value;
    }

    return {
        truncated: true,
        original_chars: encoded.length,
        preview: encoded.slice(0, maximum)
    };
}


function profileFor(scope, fallback, bucket) {

    const known = bucket.agents.get(scope);

    if (known?.agent) {
        return known.agent;
    }

    if (fallback) {
        return fallback;
    }

    return String(scope || "main_agent").split("#")[0];
}


function identity(event, bucket) {

    const scope =
        event.scope ||
        event.agent ||
        "main_agent";

    const known = bucket.agents.get(scope) || {};
    const agent = profileFor(scope, event.agent, bucket);
    const depth =
        event.depth ??
        known.depth ??
        (scope === "main_agent" ? 0 : null);

    return {
        role:
            depth && depth > 0
                ? "sub-agent"
                : (event.hook || known.hook)
                    ? "runtime-hook"
                    : "main-agent",
        agent,
        scope,
        depth,
        parent_agent:
            known.parent ||
            event.parent ||
            null,
        parent_scope:
            known.parent_scope ||
            event.parent_scope ||
            null,
        hook:
            event.hook ||
            known.hook ||
            null
    };
}


function append(agent, record, at, root) {

    if (settings.get("JOURNAL_ENABLED") !== true) {
        return Promise.resolve(null);
    }

    const file = fileFor(agent, at, root);
    const line = `${JSON.stringify(record)}\n`;
    pendingJournalWrites = pendingJournalWrites
        .then(async () => {
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.appendFile(file, line, "utf8");
            STATE.last_error = null;
            return file;
        })
        .catch(error => {
            STATE.last_error = error.message;
            return null;
        });

    return pendingJournalWrites;
}

function write(kind, event, fields = {}) {

    const bucket = bucketFor(event);
    const who = identity(event, bucket);
    const stamp = clock(event.at);

    const record = {
        schema_version: VERSION,
        ...stamp,
        kind,
        event_seq: event.seq ?? null,
        run_id: bucket.run_id,
        task: bucket.task,
        role: who.role,
        agent: who.agent,
        scope: who.scope,
        depth: who.depth,
        parent_agent: who.parent_agent,
        parent_scope: who.parent_scope,
        iteration: event.iteration ?? null,
        model:
            event.model ||
            bucket.models.get(who.scope)?.model ||
            bucket.models.get(who.agent)?.model ||
            null,
        endpoint_role:
            event.endpoint_role ||
            bucket.models.get(who.scope)?.role ||
            bucket.models.get(who.agent)?.role ||
            null,
        hook: who.hook,
        ...fields
    };

    append(who.agent, record, event.at, rootFor(event, bucket));

    return record;
}


function toolKey(event) {

    return [
        event.agent || event.scope || "main_agent",
        event.graph_id || "no_graph",
        event.id || "no_id"
    ].join("|");
}


function onEvent(event) {

    if (event.type === "run:start") {

        const runId = event.run_id || `run-event-${event.seq || Date.now()}`;

        const bucket = newBucket(runId, event.task);

        /* The run's data root is pinned once, at open: every record of
           this run lands together even when a single event's envelope
           lacks the project id (Phase 8 per-project separation). */
        bucket.root =
            dataRoot.dataRootForProjectId(event.project_id) ||
            dataRoot.currentRoot();

        RUN_BUCKETS.set(runId, bucket);

        /* Legacy mirror: STATE aliases the newest run's maps, so the
           exported _state view and single-run consumers are unchanged. */
        STATE.run_id = bucket.run_id;
        STATE.task = bucket.task;
        STATE.agents = bucket.agents;
        STATE.models = bucket.models;
        STATE.pending_tools = bucket.pending_tools;

        write("run_start", {
            ...event,
            agent: "main_agent",
            scope: "main_agent",
            depth: 0
        }, {
            thinking: null,
            tools: []
        });

        return;
    }

    if (event.type === "request:start") {

        bucketFor(event).models.set(event.agent || "main_agent", {
            model: event.model || null,
            role: event.role || null
        });

        return;
    }

    if (event.type === "agent:start") {

        const scope = event.scope || event.agent;

        bucketFor(event).agents.set(scope, {
            agent: event.agent,
            depth: event.depth,
            parent: event.parent,
            parent_scope: event.parent_scope,
            hook: event.hook || null
        });

        write("agent_start", event, {
            delegation_id: event.delegation_id || null,
            assigned_task: event.task || null,
            thinking: null,
            tools: []
        });

        return;
    }

    if (event.type === "agent:thinking") {

        write("thinking", event, {
            thinking: bounded(event.content || ""),
            thinking_chars: event.chars ?? String(event.content || "").length,
            tools: []
        });

        return;
    }

    if (event.type === "tool:start") {

        bucketFor(event).pending_tools.set(toolKey(event), {
            id: event.id,
            name: event.name,
            graph_id: event.graph_id || null,
            graph_shape: event.shape || null,
            wave: event.wave ?? null,
            depends_on: event.depends_on || [],
            arguments: event.arguments,
            started_event_seq: event.seq ?? null,
            started_at: event.at
        });

        return;
    }

    if (event.type === "tool:end") {

        const bucket = bucketFor(event);

        const key = toolKey(event);
        const started = bucket.pending_tools.get(key) || {};
        bucket.pending_tools.delete(key);

        write("tool", event, {
            thinking: null,
            tools: [
                {
                    id: event.id,
                    name: event.name,
                    graph_id: event.graph_id || started.graph_id || null,
                    graph_shape: started.graph_shape || null,
                    wave: event.wave ?? started.wave ?? null,
                    depends_on: started.depends_on || [],
                    started_event_seq: started.started_event_seq ?? null,
                    completed_event_seq: event.seq ?? null,
                    started_at:
                        started.started_at
                            ? new Date(started.started_at).toISOString()
                            : null,
                    completed_at: new Date(event.at || Date.now()).toISOString(),
                    arguments: bounded(
                        event.arguments !== undefined
                            ? event.arguments
                            : started.arguments
                    ),
                    success: event.success === true,
                    exit_code: event.exit_code ?? null,
                    warning: event.warning || null,
                    duration_ms: event.duration_ms ?? null,
                    result: bounded(event.result),
                    error: event.error || null
                }
            ]
        });

        return;
    }

    if (event.type === "agent:end") {

        write("agent_end", event, {
            success: event.success === true,
            error: event.error || null,
            thinking: null,
            tools: []
        });

        return;
    }

    if (["run:end", "run:error", "run:status"].includes(event.type)) {

        write(event.type.replace(":", "_"), {
            ...event,
            agent: "main_agent",
            scope: "main_agent",
            depth: 0
        }, {
            success:
                event.ok ??
                (
                    event.status
                        ? event.status === "done"
                        : false
                ),
            status: event.status || null,
            error: bounded(event.error || event.message || null),
            thinking: null,
            tools: []
        });

        /* The run is finished, so its bucket can be retired; STATE
           still mirrors it until the next run starts (the historical
           view of "the last run"), but a later event for a NEW run id
           can never inherit this run's task or agent map. */
        if (
            (event.type === "run:end" || event.type === "run:error") &&
            event.run_id
        ) {
            RUN_BUCKETS.delete(event.run_id);
        }
    }
}


function onEventQueued(event) {
    pendingJournal = pendingJournal
        .then(() => {
            onEvent(event);
            return pendingJournalWrites;
        })
        .catch(error => {
            STATE.last_error = error.message;
        });
    return pendingJournal;
}


function flush() {
    return Promise.all([pendingJournal, pendingJournalWrites]);
}


function attach(bus) {

    if (STATE.attached) {
        return false;
    }

    bus.on("event", onEventQueued);
    STATE.attached = true;

    return true;
}


function detach(bus) {

    if (!STATE.attached) {
        return false;
    }

    bus.off("event", onEventQueued);
    STATE.attached = false;

    return true;
}


module.exports = {
    VERSION,
    attach,
    detach,
    journalRoot,
    fileFor,
    onEvent,
    onEventQueued,
    flush,
    bounded,

    get lastError() {
        return STATE.last_error;
    },

    _state: STATE,
    _buckets: RUN_BUCKETS,
    _safeName: safeName
};
