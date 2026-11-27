"use strict";

/*
|--------------------------------------------------------------------------
| Plan Mode gate (roadmap P3-03)
|--------------------------------------------------------------------------
|
| While a run is in plan mode the agent may read, search, inspect git and
| write its plan (plan_set / plan_update), but nothing that changes the
| project: every such call is refused with a policy error before the
| policy rules or an approval are even consulted, so "approve all" cannot
| let one through. The operator approving the plan starts the next run
| without plan mode, which then executes the same plan.
|
|   always refused   file writes, patches, checkpoint undo, git mutations,
|                    process start/write/terminate, MCP server changes
|   read-only only   terminal_exec (a command CommandRisk rates low),
|                    git_branch / git_worktree (action list),
|                    MCP calls (a tool annotated readOnlyHint)
|--------------------------------------------------------------------------
*/

const CommandRisk = require("./CommandRisk");

const ALWAYS_BLOCKED = new Set([
    "fs_write",
    "fs_edit",
    "apply_patch",
    "checkpoint_undo",
    "fs_mkdir",
    "fs_move",
    "fs_delete",
    "process_start",
    "process_write",
    "process_terminate",
    "git_add",
    "git_commit",
    "git_checkout",
    "git_push",
    "mcp_add",
    "mcp_remove",
    "mcp_build",
    "discussion_start"
]);

const REASON =
    "plan mode: the plan has not been approved yet, so nothing in the project may change. Finish the plan (plan_set) and give it as the final answer; the operator approves or revises it.";


function readOnlyCommand(args) {

    const command = args && typeof args.command === "string" ? args.command : "";

    if (command.trim() === "") {
        return false;
    }

    try {
        return CommandRisk.classify(command).risk === CommandRisk.RISK.LOW;
    } catch {
        return false;
    }
}


function readOnlyMcp(toolName, args, catalogueEntry) {

    const entry = typeof catalogueEntry === "function" ? catalogueEntry(toolName, args) : null;

    return entry?.annotations?.readOnlyHint === true;
}


/*
| null when the call may run in plan mode, otherwise the reason it may not.
| catalogueEntry(toolName, args) -> MCP catalogue entry (annotations).
*/
function planModeRefusal(toolName, args = {}, { catalogueEntry } = {}) {

    if (ALWAYS_BLOCKED.has(toolName)) {
        return REASON;
    }

    if (toolName === "terminal_exec") {
        return readOnlyCommand(args)
            ? null
            : `${REASON} Only read-only commands run in plan mode; this one changes something or could not be rated.`;
    }

    if (toolName === "git_branch" || toolName === "git_worktree") {
        return args && args.action === "list" ? null : REASON;
    }

    if (toolName === "mcp_call" || toolName.startsWith("mcp__")) {
        return readOnlyMcp(toolName, args, catalogueEntry)
            ? null
            : `${REASON} MCP tools run in plan mode only when the server marks them readOnlyHint.`;
    }

    return null;
}


function isPlanModeRun(run) {

    return Boolean(run && run.planMode === true);
}


module.exports = {
    ALWAYS_BLOCKED,
    planModeRefusal,
    isPlanModeRun
};
