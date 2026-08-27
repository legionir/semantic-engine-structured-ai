/*
|--------------------------------------------------------------------------\
| Policy boundary
|--------------------------------------------------------------------------\
|
| Everything the enforcement path needs, behind one require: the rule
| document and its matching, the approval lifecycle, and the audit/pending
| state both share. `agent/lib/policy.js` re-exports this for importers that
| still name the old path.
|--------------------------------------------------------------------------*/

const { PolicyEngine } = require("./PolicyEngine");
const { PolicyRegistry } = require("./PolicyRegistry");

const {
    matchesGlob,
    valueAtPath,
    conditionMatches,
    ruleTargets,
    mcpServerOf,
    mcpEscalation
} = require("./PolicyMatcher");

const {
    ApprovalManager,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler,
    getApprovalHandler,
    globalMcpServer
} = require("./ApprovalManager");

const {
    ApprovalStore,
    currentProjectId,
    resetGatewayApprovals
} = require("./ApprovalStore");

const {
    DECISIONS,
    deniedByPolicy,
    deniedByOperator,
    unattendedDenied,
    noInteractiveApprover
} = require("./PolicyErrors");


module.exports = {
    PolicyEngine,
    PolicyRegistry,
    ApprovalManager,
    ApprovalStore,

    /* matching primitives, exported for the tests that pin rule semantics */
    matchesGlob,
    valueAtPath,
    conditionMatches,
    ruleTargets,
    mcpServerOf,
    mcpEscalation,

    /* approval lifecycle */
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler,
    getApprovalHandler,
    resetGatewayApprovals,
    globalMcpServer,
    currentProjectId,

    DECISIONS,

    errors: {
        deniedByPolicy,
        deniedByOperator,
        unattendedDenied,
        noInteractiveApprover
    }
};
