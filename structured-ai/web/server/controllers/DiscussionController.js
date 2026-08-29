"use strict";

const { BaseController } = require("./BaseController");


class DiscussionController extends BaseController {

    constructor({ discussion, forward } = {}) {
        super({ forward });
        this.discussion = discussion || null;
    }


    personas() {
        return this.discussion.listPersonas();
    }


    start(options) {
        return this.discussion.start(options);
    }
}


module.exports = {
    DiscussionController
};
