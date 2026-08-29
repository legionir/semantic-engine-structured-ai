"use strict";

const { BaseController } = require("./BaseController");


class ApprovalController extends BaseController {

    constructor({ approvalStore, resolve, forward } = {}) {
        super({ forward });
        this.approvalStore = approvalStore || null;
        this.resolveHandler = resolve || null;
    }


    pending(projectId) {
        return this.approvalStore.pendingValues(
            projectId ? { projectId } : undefined
        );
    }


    resolve(id, approved) {
        if (typeof this.resolveHandler !== "function") {
            throw new Error("approval controller is not bound");
        }
        return this.resolveHandler(id, approved);
    }
}


module.exports = {
    ApprovalController
};
