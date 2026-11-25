"use strict";

/*
|--------------------------------------------------------------------------
| Policy errors — EXECUTION_PLAN Phase 21
|--------------------------------------------------------------------------
|
| Policy and approval failures have historically been plain Error instances
| with stable messages. These small types give the extracted boundary a
| useful vocabulary without changing the legacy error name or message that
| callers and the tool graph already consume.
|--------------------------------------------------------------------------
*/

const CODES = Object.freeze({
    POLICY: "POLICY_ERROR",
    POLICY_DENIED: "POLICY_DENIED",
    APPROVAL_DENIED: "APPROVAL_DENIED",
    APPROVAL_UNAVAILABLE: "APPROVAL_UNAVAILABLE",
    POLICY_CONFIGURATION: "POLICY_CONFIGURATION"
});


class PolicyError extends Error {

    constructor(message, code = CODES.POLICY) {

        super(message);

        /* Keep the historical `Error` identity used by tool results. */
        this.name = "Error";
        this.code = code;
    }
}


class PolicyDeniedError extends PolicyError {

    constructor(tool, reason) {
        super(
            `Tool "${tool}" is denied by policy: ${reason}`,
            CODES.POLICY_DENIED
        );
    }
}


class ApprovalDeniedError extends PolicyError {

    constructor(tool, reason) {
        super(
            `Tool "${tool}" was denied by the operator: ${reason}`,
            CODES.APPROVAL_DENIED
        );
    }
}


class ApprovalUnavailableError extends PolicyError {

    constructor(message) {
        super(message, CODES.APPROVAL_UNAVAILABLE);
    }
}


function unattendedApproval(tool, reason) {

    return new ApprovalUnavailableError(
        `Tool "${tool}" requires approval and the runtime is running unattended (AGENT_APPROVAL=deny): ${reason}`
    );
}


function interactiveApprovalUnavailable(tool, reason) {

    return new ApprovalUnavailableError(
        `Tool "${tool}" requires an interactive approval, but no approval handler or TTY is available: ${reason}`
    );
}


function configurationError(message) {
    return new PolicyError(message, CODES.POLICY_CONFIGURATION);
}


module.exports = {
    CODES,
    PolicyError,
    PolicyDeniedError,
    ApprovalDeniedError,
    ApprovalUnavailableError,
    unattendedApproval,
    interactiveApprovalUnavailable,
    configurationError
};
