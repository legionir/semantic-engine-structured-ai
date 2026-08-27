"use strict";

/*
|--------------------------------------------------------------------------
| Web console session and approval projections (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The row shapes the console reads: what a pending approval looks like
| on a screen, and what a recorded tool call looks like in the list.
|
| Two pending-approval projections, not one, and that is the contract:
| the global snapshot answers `project_id: request.project_id || null`
| while a project's own state answers `project_id: item.project_id` —
| the first is a console watching everything, the second is a screen
| already inside one project. Folding them together would change a
| field one of them promises, so both are kept as they were.
|
| The call list is the *summary* only: the full arguments and result
| stay in the server's call map and are fetched per call, because a
| single tool result can be tens of thousands of characters.
|--------------------------------------------------------------------------
*/

function pendingApprovalsForSnapshot(pending) {

    return pending.map(
        request => ({
            id: request.id,
            agent: request.agent,
            tool: request.tool,
            reason: request.reason,
            arguments: request.arguments,
            project_id: request.project_id || null
        })
    );
}

function pendingApprovalsForProject(pending) {

    return pending.map(item => ({
            id: item.id,
            agent: item.agent,
            tool: item.tool,
            reason: item.reason,
            arguments: item.arguments,
            project_id: item.project_id
    }));
}

function callSummaries(list) {

    return list.map(call => ({
        key: call.key,
        agent: call.agent,
        id: call.id,
        name: call.name,
        graph_id: call.graph_id,
        shape: call.shape,
        wave: call.wave,
        iteration: call.iteration,
        depends_on: call.depends_on,
        status: call.status,
        duration_ms: call.duration_ms
    }));
}

module.exports = {
    pendingApprovalsForSnapshot,
    pendingApprovalsForProject,
    callSummaries
};
