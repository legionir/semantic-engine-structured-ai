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
    "mcp:disconnected",
    "mcp:elicitation",
    "mcp:elicitation_resolved",
    "mcp:install",
    "mcp:problem",
    "mcp:progress",
    "mcp:reconnected",
    "mcp:removed",
    "mcp:result",
    "mcp:sampling",
    "mcp:unavailable",
    "plan:autoroute:end",
    "plan:autoroute:start",
    "policy:decision",
    "process:orphans",
    "project:clone",
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
    "run:cost",
    "run:cost_cap",
    "run:deadline",
    "run:delegation_hint",
    "run:end",
    "run:error",
    "run:goal",
    "run:loop",
    "run:malformed",
    "run:nudge",
    "run:queued",
    "run:snapshot",
    "run:start",
    "run:status",
    "run:wrapup",
    "secret:changed",
    "session:approval_mode",
    "session:cleared",
    "session:interrupted",
    "session:message",
    "session:switched",
    "settings:changed",
    "skill:loaded",
    "skill:read",
    "system:resources",
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
