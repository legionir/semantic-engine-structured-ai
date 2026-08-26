"use strict";

const { BaseController } = require("./BaseController");


class SessionController extends BaseController {

    constructor({ sessionService, forward } = {}) {
        super({ forward });
        this.sessionService = sessionService || null;
    }


    list(root) {
        return this.sessionService.list(root);
    }


    open(id, root) {
        return this.sessionService.load(id, root);
    }


    remove(id, root) {
        return this.sessionService.delete(id, root);
    }
}


module.exports = {
    SessionController
};
