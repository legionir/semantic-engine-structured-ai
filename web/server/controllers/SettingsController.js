"use strict";

const { BaseController } = require("./BaseController");


class SettingsController extends BaseController {

    constructor({ settingsService, forward } = {}) {
        super({ forward });
        this.settingsService = settingsService || null;
    }


    list() {
        return this.settingsService.all();
    }


    set(key, value) {
        return this.settingsService.set(key, value);
    }
}


module.exports = {
    SettingsController
};
