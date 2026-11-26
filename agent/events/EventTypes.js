"use strict";

/*
| Stable business event names — EXECUTION_PLAN Phase 27.
| The list is additive: consumers may ignore a new event, but an existing
| name must never be renamed or removed during the migration.
*/

const EVENT_TYPES = Object.freeze([
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
    "queue:changed",
    "registry:loaded",
    "report:mismatch",
    "request:end",
    "request:start",
    "response:repaired",
    "run:auto_continue",
    "run:auto_stopped",
    "run:continue",
    "run:correction",
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
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

function isKnownEventType(type) {
    return EVENT_TYPE_SET.has(type);
}

module.exports = {
    EVENT_TYPES,
    EVENT_TYPE_SET,
    isKnownEventType
};
