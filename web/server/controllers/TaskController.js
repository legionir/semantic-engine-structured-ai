"use strict";

const { BaseController } = require("./BaseController");


class TaskController extends BaseController {

    constructor({ taskService, forward } = {}) {
        super({ forward });
        this.taskService = taskService || null;
    }


    busy() {
        return this.taskService?.busy() || false;
    }


    start(task, options = {}) {
        return this.taskService.start(task, options);
    }
}


module.exports = {
    TaskController
};
