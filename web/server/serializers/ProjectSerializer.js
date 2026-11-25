"use strict";

/* Project response serializers — EXECUTION_PLAN Phase 23. */

function project(record) {
    return { project: record };
}


function deleted(projectId) {
    return { deleted: projectId };
}


module.exports = {
    project,
    deleted
};
