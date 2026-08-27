/*
|--------------------------------------------------------------------------\
| Policy errors
|--------------------------------------------------------------------------\
|
| Every refusal this runtime makes is phrased the same way for the same
| reason: the message is what the model reads, what the audit log keeps and
| what several tests assert. Building them here keeps a refactor from
| quietly rewording a refusal — the wording IS the contract.
|
|--------------------------------------------------------------------------*/

const DECISIONS = {
    ALLOW: "allow",
    DENY: "deny",
    REQUIRE_APPROVAL: "require_approval"
};


/* A rule said no. Nothing asks the operator; the call never happens. */

function deniedByPolicy(toolName, reason) {

    return new Error(
        `Tool "${toolName}" is denied by policy: ${reason}`
    );
}


/*
| An approval that came back as a no — from the terminal prompt, from the
| web console handler, or from the cached gateway answer for a
| `scope: global` MCP server. One message for all three: to the caller the
| fact is the same, and the audit record carries which one it was.
*/

function deniedByOperator(toolName, reason) {

    return new Error(
        `Tool "${toolName}" was denied by the operator: ${reason}`
    );
}


/* AGENT_APPROVAL=deny is the unattended mode: refuse rather than hang. */

function unattendedDenied(toolName, reason) {

    return new Error(
        `Tool "${toolName}" requires approval and the runtime is running unattended (AGENT_APPROVAL=deny): ${reason}`
    );
}


/*
| `prompt` with nobody to prompt. The distinction from `unattendedDenied`
| matters when reading a log: one is an operator's choice, the other is a
| runtime that cannot ask.
*/

function noInteractiveApprover(toolName, reason) {

    return new Error(
        `Tool "${toolName}" requires an interactive approval, but no approval handler or TTY is available: ${reason}`
    );
}


module.exports = {
    DECISIONS,
    deniedByPolicy,
    deniedByOperator,
    unattendedDenied,
    noInteractiveApprover
};
