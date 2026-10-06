"use strict";

/* Task lifecycle service — EXECUTION_PLAN Phase 23. */

class TaskService {

    constructor({ runtime, state, startTask } = {}) {
        this.runtime = runtime;
        this.state = state;
        this.startTaskHandler = startTask;
    }


    busy() {

        return this.state.status === "running" ||
            Boolean(this.state.discussion && this.state.discussion.status === "running");
    }


    start(task, options = {}) {

        if (typeof this.startTaskHandler !== "function") {
            throw new Error("task service is not bound");
        }

        return this.startTaskHandler(task, options);
    }
}


module.exports = {
    TaskService
};
