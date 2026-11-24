"use strict";

const { BaseController } = require("./BaseController");


class ArchiveController extends BaseController {

    constructor({ archive, forward } = {}) {
        super({ forward });
        this.archive = archive || null;
    }


    search(query, options) {
        return this.archive.search(query, options);
    }


    get(id, options) {
        return this.archive.get(id, options);
    }
}


module.exports = {
    ArchiveController
};
