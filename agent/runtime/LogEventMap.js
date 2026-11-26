"use strict";

/*
| Which runtime events become application log entries, and how. Only the
| events an operator would look for when something went wrong (plus the
| run boundaries that put them in context) are logged; the full stream
| stays in the event store. Model request failures are logged where they
| happen (AgentRequestExecutor, RetryController) because the event does
| not carry the status, endpoint and response body.
*/

function clip(text, limit = 300) {
    const value = String(text ?? "");
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
}


function context(event, extra = {}) {
    const details = {};
    for (const key of ["run_id", "project_id", "agent", "scope"]) {
        if (event[key] !== undefined && event[key] !== null) details[key] = event[key];
    }
    for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined && value !== null) details[key] = value;
    }
    return details;
}


const MAPPERS = {
    "run:start": event => ({
        level: "info",
        source: "run",
        message: `Run started${event.task ? `: ${clip(event.task, 160)}` : ""}`,
        details: context(event, { continued: event.continued || undefined })
    }),

    "run:end": event => ({
        level: event.ok === false ? "warn" : "info",
        source: "run",
        message: event.ok === false ? "Run finished without success" : "Run finished",
        details: context(event, { claim_mismatch: event.claim_mismatch })
    }),

    "run:error": event => ({
        level: event.cancelled ? "warn" : "error",
        source: "run",
        message: `${event.cancelled ? "Run cancelled" : "Run failed"}: ${clip(event.message, 500)}`,
        details: context(event, { code: event.code, cancelled: Boolean(event.cancelled) })
    }),

    "run:deadline": event => ({
        level: "warn",
        source: "run",
        message: `Run stopped at its deadline after ${event.elapsed_ms ?? "?"} ms`,
        details: context(event, { max_run_ms: event.max_run_ms })
    }),

    "run:loop": event => ({
        level: "warn",
        source: "run",
        message: `The same failure repeated ${event.repeats ?? "?"} times${event.outcome === "stopped" ? "; the agent was stopped" : ""}`,
        details: context(event, { signature: event.signature, limit: event.limit, outcome: event.outcome })
    }),

    "run:malformed": event => ({
        level: "warn",
        source: "ai",
        message: `Malformed model response${event.code ? ` (${event.code})` : ""}: ${clip(event.reason)}`,
        details: context(event, { attempt: event.attempt, max_attempts: event.max_attempts })
    }),

    "endpoint:degraded": event => ({
        level: "warn",
        source: "ai",
        message: `Endpoint rejected the response schema; continuing without ${event.dropped || "it"} for ${event.model}`,
        details: context(event, { role: event.role, model: event.model, endpoint: event.endpoint, reason: event.reason })
    }),

    "tool:end": event => (event.success === false || event.error
        ? {
            level: "warn",
            source: "tool",
            message: `Tool ${event.name || "?"} failed: ${clip(event.error || "unknown error", 500)}`,
            details: context(event, { tool: event.name, id: event.id, duration_ms: event.duration_ms })
        }
        : null),

    "hook:end": event => (event.ok === false && !event.skipped
        ? {
            level: "warn",
            source: "hook",
            message: `Hook ${event.id || "?"} failed${event.error ? `: ${clip(event.error, 500)}` : ""}`,
            details: context(event, { phase: event.phase, status: event.status, on_failure: event.on_failure })
        }
        : null),

    "mcp:problem": event => ({
        level: "warn",
        source: "mcp",
        message: `MCP problem: ${clip(event.message, 500)}`,
        details: context(event)
    }),

    "mcp:unavailable": event => ({
        level: "warn",
        source: "mcp",
        message: `MCP server ${event.server || "?"} is unavailable: ${clip(event.error, 500)}`,
        details: context(event, { server: event.server, transport: event.transport })
    }),

    /* P4-04: the last error of a server is in the global log */
    "mcp:disconnected": event => ({
        level: "warn",
        source: "mcp",
        message: `MCP server ${event.server || "?"} disconnected: ${clip(event.error, 500)}${
            event.retrying
                ? ` — reconnect attempt ${event.attempt} in ${Math.round((event.retry_in_ms || 0) / 100) / 10}s`
                : ""}`,
        details: context(event, {
            server: event.server,
            transport: event.transport,
            code: event.code,
            signal: event.signal,
            attempt: event.attempt,
            retrying: event.retrying
        })
    }),

    "mcp:reconnected": event => ({
        level: "info",
        source: "mcp",
        message: `MCP server ${event.server || "?"} reconnected after ${event.attempts || 1} attempt(s)`,
        details: context(event, { server: event.server, tools: event.tools, down_ms: event.down_ms })
    }),

    "mcp:install": event => (event.status === "running"
        ? {
            level: "info",
            source: "mcp",
            message: `Installing ${event.id}: ${clip(event.command, 300)}`,
            details: context(event, { id: event.id })
        }
        : {
            level: event.status === "succeeded" ? "info" : "error",
            source: "mcp",
            message: event.status === "succeeded"
                ? `Installed ${event.id}`
                : `Installing ${event.id} failed: ${clip(event.error, 500)}`,
            details: context(event, { id: event.id, exit_code: event.exit_code, duration_ms: event.duration_ms })
        }),

    /* names only: a value never reaches an event */
    "secret:changed": event => ({
        level: "info",
        source: "secrets",
        message: `Secret ${event.name || "?"} ${event.action || "changed"}`,
        details: context(event, { name: event.name, action: event.action })
    }),

    /* P1-07: once when a limit is crossed, once when it clears */
    "system:resources": event => ({
        level: event.level === "warning" ? "warn" : "info",
        source: "system",
        message: clip(event.message, 300) || `System ${event.kind || "resources"} ${event.level || ""}`.trim(),
        details: context(event, {
            kind: event.kind,
            path: event.path,
            memory_available_mb: event.memory_available_mb,
            cpu_percent: event.cpu_percent
        })
    }),

    "process:orphans": event => ({
        level: "warn",
        source: "system",
        message:
            `Stopped ${(event.stopped || []).length} background process(es) left by a previous run of the console` +
            ((event.skipped || []).length > 0 ? `; ${(event.skipped || []).length} could not be verified and were left alone` : ""),
        details: context(event, { stopped: event.stopped, skipped: event.skipped })
    }),

    /* P1-02: the URL is logged without credentials */
    "project:clone": event => (event.status === "running"
        ? {
            level: "info",
            source: "projects",
            message: `Cloning ${clip(event.url, 300)}${event.branch ? ` (${event.branch})` : ""} into ${clip(event.path, 300)}`,
            details: context(event, { job: event.job, shallow: event.shallow })
        }
        : {
            level: event.status === "succeeded" ? "info" : "error",
            source: "projects",
            message: event.status === "succeeded"
                ? `Cloned ${clip(event.url, 300)} as project ${event.project_id}`
                : `Cloning ${clip(event.url, 300)} failed: ${clip(event.error, 500)}`,
            details: context(event, { job: event.job, project_id: event.project_id, duration_ms: event.duration_ms })
        }),

    "run:queued": event => ({
        level: "info",
        source: "run",
        message: `Run for ${event.project_id || "the default project"} waits for a free slot (${event.active} active, limit ${event.limit})`,
        details: context(event, { reason: event.reason })
    }),

    /* P1-06 */
    "session:interrupted": event => ({
        level: "warn",
        source: "run",
        message: `${(event.sessions || []).length} conversation(s) were interrupted by a restart and can be continued`,
        details: context(event, { sessions: event.sessions })
    }),

    "discussion:error": event => ({
        level: "error",
        source: "discussion",
        message: `Discussion failed: ${clip(event.error, 500)}`,
        details: context(event, { id: event.id })
    }),

    "report:mismatch": event => ({
        level: "warn",
        source: "run",
        message: `The final report claims work the run did not perform${Array.isArray(event.problems) ? `: ${clip(event.problems.join("; "), 500)}` : ""}`,
        details: context(event)
    })
};


function entryForEvent(event) {
    if (!event || typeof event.type !== "string") return null;
    const mapper = MAPPERS[event.type];
    return mapper ? mapper(event) : null;
}


module.exports = {
    MAPPERS,
    entryForEvent
};
