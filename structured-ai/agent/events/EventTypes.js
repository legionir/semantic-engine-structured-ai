"use strict";

/*
|--------------------------------------------------------------------------
| Event Types & Contracts — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Declarative catalogue of all 64 runtime event types, envelope specifications,
| category classifications, and contractual definitions (including turn_id).
|--------------------------------------------------------------------------
*/

const KNOWN_EVENT_TYPES = [
    "agent:action",
    "agent:end",
    "agent:iteration",
    "agent:response",
    "agent:start",
    "agent:thinking",
    "approval:request",
    "approval:resolved",
    "context:compacted",
    "context:memory",
    "delegation:end",
    "delegation:graph",
    "delegation:start",
    "discussion:error",
    "discussion:finish",
    "discussion:message",
    "discussion:observer",
    "discussion:round",
    "discussion:start",
    "endpoint:degraded",
    "git:report",
    "hook:end",
    "hook:phase:end",
    "hook:phase:start",
    "hook:start",
    "mcp:added",
    "mcp:call",
    "mcp:connected",
    "mcp:problem",
    "mcp:removed",
    "mcp:result",
    "mcp:unavailable",
    "plan:autoroute:end",
    "plan:autoroute:start",
    "policy:decision",
    "registry:loaded",
    "report:mismatch",
    "request:end",
    "request:start",
    "response:repaired",
    "run:auto_continue",
    "run:auto_stopped",
    "run:continue",
    "run:deadline",
    "run:delegation_hint",
    "run:end",
    "run:error",
    "run:loop",
    "run:malformed",
    "run:nudge",
    "run:start",
    "run:status",
    "run:wrapup",
    "session:approval_mode",
    "session:cleared",
    "session:message",
    "session:switched",
    "settings:changed",
    "skill:loaded",
    "skill:read",
    "tool:arguments_ignored",
    "tool:end",
    "tool:graph",
    "tool:start"
];

const KNOWN_EVENT_TYPES_SET = new Set(KNOWN_EVENT_TYPES);

const EVENT_CATEGORIES = {
    RUN: "run",
    AGENT: "agent",
    TOOL: "tool",
    MCP: "mcp",
    POLICY: "policy",
    APPROVAL: "approval",
    HOOK: "hook",
    DELEGATION: "delegation",
    DISCUSSION: "discussion",
    SESSION: "session",
    CONTEXT: "context",
    SETTINGS: "settings",
    SKILL: "skill",
    GIT: "git",
    REQUEST: "request",
    PLAN: "plan",
    SYSTEM: "system"
};

const TELEMETRY_EVENT_TYPES = new Set([
    "request:start",
    "request:end",
    "agent:thinking",
    "endpoint:degraded",
    "agent:iteration"
]);

const ENVELOPE_REQUIRED_FIELDS = [
    "seq",
    "type",
    "at",
    "run_id",
    "turn_id",
    "scope",
    "iteration"
];

const ENVELOPE_CONTEXT_FIELDS = [
    "run_id",
    "turn_id",
    "scope",
    "iteration"
];

const ENVELOPE_ADDITIVE_FIELDS = [
    "project_id"
];

const KEY_PAYLOADS = {
    "run:start": ["run_id", "turn_id", "task"],
    "agent:iteration": ["iteration"],
    "tool:start": ["id", "name"],
    "tool:end": ["id", "name", "success"],
    "run:end": ["success"]
};

/*
|--------------------------------------------------------------------------
| Turn ID Official Contract Definition (Phases 9 & 27)
|--------------------------------------------------------------------------
*/
const TURN_ID_DEFINITION = {
    concept: "turn_id",
    description:
        "Represents each discrete conversational turn / interaction within a session. Each user task or chat message initiates a turn.",
    format:
        "<run_id>_t<N> with an incrementing counter per session, or caller-supplied by the web server to align chat messages with events.",
    hierarchy:
        "project_id ⊃ run_id ⊃ turn_id ⊃ iteration",
    casing:
        "snake_case in event envelopes and journal; camelCase in web API responses."
};


function isKnownType(type) {

    return KNOWN_EVENT_TYPES_SET.has(type);
}


function isTelemetryEvent(type) {

    return TELEMETRY_EVENT_TYPES.has(type);
}


function isBusinessEvent(type) {

    return !TELEMETRY_EVENT_TYPES.has(type);
}


function categoryOf(type) {

    if (typeof type !== "string") {
        return EVENT_CATEGORIES.SYSTEM;
    }

    const prefix = type.split(":")[0];

    return EVENT_CATEGORIES[prefix.toUpperCase()] || EVENT_CATEGORIES.SYSTEM;
}


module.exports = {
    KNOWN_EVENT_TYPES,
    KNOWN_EVENT_TYPES_SET,
    EVENT_CATEGORIES,
    TELEMETRY_EVENT_TYPES,
    ENVELOPE_REQUIRED_FIELDS,
    ENVELOPE_CONTEXT_FIELDS,
    ENVELOPE_ADDITIVE_FIELDS,
    KEY_PAYLOADS,
    TURN_ID_DEFINITION,
    isKnownType,
    isTelemetryEvent,
    isBusinessEvent,
    categoryOf
};
