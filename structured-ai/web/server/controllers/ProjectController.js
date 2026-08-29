"use strict";

const { BaseController } = require("./BaseController");


class ProjectController extends BaseController {

    constructor({ registry, forward } = {}) {
        super({ forward });
        this.registry = registry || null;
    }


    list() {
        return this.registry.list();
    }


    get(id) {
        return this.registry.get(id);
    }


    register(value) {
        return this.registry.register(value);
    }


    update(id, value) {
        return this.registry.update(id, value);
    }


    remove(id) {
        return this.registry.remove(id);
    }
}


module.exports = {
    ProjectController
};
