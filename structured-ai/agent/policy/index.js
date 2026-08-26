"use strict";

const settings = require("../config");

const {
    PolicyEngine,
    DECISIONS
} = require("./PolicyEngine");
const {
    PolicyMatcher,
    matchesGlob,
    valueAtPath,
    conditionMatches,
    ruleTargets
} = require("./PolicyMatcher");
const {
    PolicyRegistry,
    policyProblems,
    VALID_ACTIONS
} = require("./PolicyRegistry");
const {
    ApprovalManager,
    setGlobalApprovalHandler
} = require("./ApprovalManager");
const {
    ApprovalStore,
    resetGatewayApprovals
} = require("./ApprovalStore");
const PolicyErrors = require("./PolicyErrors");


function getApprovalMode() {
    return settings.get("AGENT_APPROVAL");
}


function setApprovalMode(mode) {
    return settings.set("AGENT_APPROVAL", mode);
}


function setApprovalHandler(handler) {
    return setGlobalApprovalHandler(handler);
}


function createPolicyEngine(options) {
    return new PolicyEngine(options);
}


module.exports = {
    PolicyEngine,
    PolicyMatcher,
    PolicyRegistry,
    ApprovalManager,
    ApprovalStore,
    PolicyErrors,
    ...PolicyErrors,
    DECISIONS,
    VALID_ACTIONS,
    policyProblems,
    matchesGlob,
    valueAtPath,
    conditionMatches,
    ruleTargets,
    createPolicyEngine,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler,
    resetGatewayApprovals
};
