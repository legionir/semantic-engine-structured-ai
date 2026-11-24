"use strict";

/* State serialization helpers — EXECUTION_PLAN Phase 23. */

function approval(request) {

    return {
        id: request.id,
        agent: request.agent,
        tool: request.tool,
        reason: request.reason,
        arguments: request.arguments,
        project_id: request.project_id || null
    };
}


function approvals(values) {
    return values.map(approval);
}


module.exports = {
    approval,
    approvals
};
