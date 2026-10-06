"use strict";

/*
|--------------------------------------------------------------------------
| Approval storage — EXECUTION_PLAN Phase 21
|--------------------------------------------------------------------------
|
| A store owns the mutable records around an approval boundary. Policy
| decisions keep a bounded-in-process history, gateway approvals are shared
| across PolicyEngine instances, and the web/interactive front ends may use
| the same class for pending promises without exposing a Map as their API.
|--------------------------------------------------------------------------
*/

const gatewayApprovals = new Map();


class ApprovalStore {

    constructor({ pending, gateway } = {}) {

        this.history = [];
        this.pending = pending instanceof Map ? pending : new Map();
        this.gateway = gateway instanceof Map ? gateway : gatewayApprovals;
    }


    record(value) {
        this.history.push(value);
        return value;
    }


    records({ projectId } = {}) {

        return projectId
            ? this.history.filter(item => item.project_id === projectId)
            : this.history;
    }


    list(options) {
        return this.records(options);
    }


    count() {
        return this.history.length;
    }


    clearHistory() {
        this.history.length = 0;
    }


    hasGateway(serverName) {
        return this.gateway.has(serverName);
    }


    gatewayFor(serverName) {
        return this.gateway.get(serverName);
    }


    rememberGateway(serverName, value) {
        this.gateway.set(serverName, value);
        return value;
    }


    addPending(request) {

        if (!request || !request.id) {
            throw new Error("pending approval requires an id");
        }

        this.pending.set(request.id, request);
        return request;
    }


    getPending(id) {
        return this.pending.get(id);
    }


    removePending(id) {

        const request = this.pending.get(id);

        if (request) {
            this.pending.delete(id);
        }

        return request || null;
    }


    pendingValues({ projectId } = {}) {

        const values = [...this.pending.values()];

        return projectId
            ? values.filter(item => item.project_id === projectId)
            : values;
    }


    pendingList(options) {
        return this.pendingValues(options);
    }


    pendingKeys() {
        return [...this.pending.keys()];
    }


    pendingSize() {
        return this.pending.size;
    }


    clearPending(resolve = false) {

        for (const request of this.pendingValues()) {
            this.removePending(request.id);

            if (typeof request.resolve === "function") {
                request.resolve(resolve);
            }
        }
    }
}


function resetGatewayApprovals() {
    gatewayApprovals.clear();
}


module.exports = {
    ApprovalStore,
    gatewayApprovals,
    resetGatewayApprovals
};
