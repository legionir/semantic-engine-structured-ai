"use strict";

/*
|--------------------------------------------------------------------------
| Tool calls and dependency graph
|--------------------------------------------------------------------------
|
| Compatibility wrappers over the runtime engine: the allowlist guard,
| tool-call normalisation, dependency graphs and their references, retries
| and the plain model call.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const actionKit = require("../actions");
const runtimeEngine = require("../runtime/engine");


module.exports = function createToolGraph(host) {

    /*
    |--------------------------------------------------------------------------
    | Permission Boundary
    |--------------------------------------------------------------------------
    |
    | The policy boundary is enforced by the extracted policy engine. This
    | function remains the allowlist/availability guard used before that
    | boundary and is kept as a compatibility wrapper.
    |--------------------------------------------------------------------------
    */

    function assertToolAllowed(...args) {

        return runtimeEngine.assertToolAllowed(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Tool Call Normalization
    |--------------------------------------------------------------------------
    */

    function parseArguments(value, toolName) {

        return actionKit.parseArguments(value, toolName);
    }


    function normalizeToolCalls(...args) {

        return runtimeEngine.normalizeToolCalls(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Dependency Validation
    |--------------------------------------------------------------------------
    */

    function validateDependencyGraph(...args) {

        return runtimeEngine.validateDependencyGraph(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Generic Dependency Graph Executor
    |--------------------------------------------------------------------------
    */

    /*
    | The scheduler decides the shape of an execution by itself, but nothing
    | outside it could see that shape, so a console could not tell a
    | dependency graph from three unrelated calls that happened to run
    | together. The same ready-set rule is replayed here without executing
    | anything, which gives the waves and a name for the shape.
    */

    function describeGraph(...args) {

        return runtimeEngine.describeGraph(...args);

    }


    async function executeDependencyGraph(...args) {

        return await runtimeEngine.executeDependencyGraph(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Dependency References
    |--------------------------------------------------------------------------
    |
    | depends_on orders the graph. A reference such as
    |
    |     { "path": "${call_1.result.entries.0.name}" }
    |
    | also carries the earlier result into the dependent call, so a two-step
    | operation costs one iteration instead of two. A reference may only
    | point at an id the call actually declared in depends_on.
    |--------------------------------------------------------------------------
    */


    function readReferencePath(...args) {

        return runtimeEngine.readReferencePath(...args);

    }


    function resolveReference(...args) {

        return runtimeEngine.resolveReference(...args);

    }


    function resolveArgumentReferences(...args) {

        return runtimeEngine.resolveArgumentReferences(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Tool Graph
    |--------------------------------------------------------------------------
    */


    async function executeToolGraph(...args) {

        return await runtimeEngine.executeToolGraph(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | API
    |--------------------------------------------------------------------------
    */

    /*
    | A transient failure from the endpoint should not end a run that may
    | have been working for minutes. Rate limits, gateway errors, and
    | dropped connections are retried with exponential backoff and jitter;
    | a request that the server rejected on its merits is not.
    */

    function isRetryableStatus(...args) {

        return runtimeEngine.isRetryableStatus(...args);

    }


    function retryDelayMs(...args) {

        return runtimeEngine.retryDelayMs(...args);

    }


    async function callAI(...args) {

        return await runtimeEngine.callAI(...args);

    }


    return {
        callAI,
        executeDependencyGraph,
        executeToolGraph,
        isRetryableStatus,
        normalizeToolCalls,
        parseArguments,
        resolveArgumentReferences
    };
};
