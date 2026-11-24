"use strict";

/* Settings domain service — EXECUTION_PLAN Phase 23. */

class SettingsService {

    constructor({ runtime } = {}) {
        this.settings = runtime?.settings;
    }


    get(key) {
        return this.settings.get(key);
    }


    set(key, value) {
        return this.settings.set(key, value);
    }


    reset(key) {
        return this.settings.reset(key);
    }


    all() {
        return this.settings.all();
    }


    snapshot() {
        return this.settings.snapshot();
    }
}


module.exports = {
    SettingsService
};
