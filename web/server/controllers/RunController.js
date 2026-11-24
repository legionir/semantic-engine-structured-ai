"use strict";

const { BaseController } = require("./BaseController");


class RunController extends BaseController {

    constructor({ runManager, observability, forward } = {}) {
        super({ forward });
        this.runManager = runManager || null;
        this.observability = observability || null;
    }


    active(projectId) {
        const runs = this.runManager.activeRuns();
        return projectId
            ? runs.filter(run => run.projectId === projectId)
            : runs;
    }


    cancel(runId, reason) {
        return this.runManager.cancelRunById(runId, reason);
    }


    metrics(projectId) {
        return projectId
            ? this.observability.projectSnapshot(projectId)
            : this.observability.snapshot();
    }


    health(projectId) {
        return projectId
            ? this.observability.healthOf(projectId)
            : this.observability.health();
    }
}


module.exports = {
    RunController
};
