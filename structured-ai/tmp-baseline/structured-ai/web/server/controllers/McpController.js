"use strict";

const { BaseController } = require("./BaseController");


class McpController extends BaseController {

    constructor({ manager, forward } = {}) {
        super({ forward });
        this.manager = manager || null;
    }


    status() {
        return this.manager.status();
    }


    catalogue() {
        return this.manager.catalogueEntries();
    }


    add(name, config, options) {
        return this.manager.add(name, config, options);
    }


    remove(name) {
        return this.manager.remove(name);
    }
}


module.exports = {
    McpController
};
