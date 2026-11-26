"use strict";

/*
|--------------------------------------------------------------------------
| Logging
|--------------------------------------------------------------------------
|
| Terminal output of the runtime: a scope prefix per agent, plain lines
| and pretty-printed objects, all also published as events.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const events = require("../events");
const settings = require("../config");


module.exports = function createLogging(host) {

    /*
    |--------------------------------------------------------------------------
    | Trace Logging
    |--------------------------------------------------------------------------
    |
    | The runtime logs every decision, tool execution, and delegation so the
    | actual execution can be audited instead of inferred from the final answer.
    |--------------------------------------------------------------------------
    */

    /*
    | Progress goes to stdout by default, but a caller that wants machine
    | readable output on stdout can push every log line to stderr instead.
    */

    const LOG_STREAM =
        process.env.AGENT_LOG_STREAM === "stderr"
            ? console.error
            : console.log;

    const PRINT_FINAL =
        process.env.AGENT_PRINT_FINAL !== "0";


    function logScope(scope) {

        return scope
            ? `[${scope}]`
            : "[main_agent]";
    }


    function logLine(
        scope,
        text
    ) {

        if (!settings.get("AGENT_VERBOSE")) {
            return;
        }

        LOG_STREAM(
            `${logScope(scope)} ${text}`
        );
    }


    function logObject(
        scope,
        label,
        value
    ) {

        if (!settings.get("AGENT_VERBOSE")) {
            return;
        }

        const safeValue =
            typeof events.redactForLog === "function"
                ? events.redactForLog(value)
                : value;

        LOG_STREAM(
            `${logScope(scope)} ${label}:\n${
                JSON.stringify(
                    safeValue,
                    null,
                    2
                )
            }`
        );
    }


    return {
        LOG_STREAM,
        PRINT_FINAL,
        logLine,
        logObject
    };
};
