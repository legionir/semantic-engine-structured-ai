"use strict";

const { BaseController } = require("./BaseController");


class StateController extends BaseController {

    snapshot(claims) {
        return this.forward({ context: { claims } });
    }
}


module.exports = {
    StateController
};
