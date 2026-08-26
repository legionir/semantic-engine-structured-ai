"use strict";

const { BaseController } = require("./BaseController");


class PlanController extends BaseController {

    constructor({ plan, forward } = {}) {
        super({ forward });
        this.plan = plan || null;
    }


    summary() {
        return this.plan.summary();
    }


    update(value) {
        return this.plan.update(value);
    }
}


module.exports = {
    PlanController
};
