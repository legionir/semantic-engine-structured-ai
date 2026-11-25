"use strict";

/* Shared controller adapter — EXECUTION_PLAN Phase 23. */

class BaseController {

    constructor({ forward } = {}) {
        this.forwardHandler = forward || null;
    }


    forward(request) {

        if (typeof this.forwardHandler !== "function") {
            throw new Error("web controller is not bound");
        }

        return this.forwardHandler(request.req, request.res, request.context, request.url);
    }
}


module.exports = {
    BaseController
};
