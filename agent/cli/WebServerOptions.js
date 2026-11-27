"use strict";

/* Resolve the conventional PORT variable before runtime startup. */
function hasExplicitNonWebCommand(options, env, { pipedStdin = false } = {}) {
    return Boolean(
        options.interactive ||
        options.untilDone ||
        options.discussion ||
        options.file ||
        options.positional?.length ||
        options.resume ||
        options.review ||
        options.help ||
        options.version ||
        options.planMode ||
        options.goal ||
        options.jsonSchema ||
        options.quiet ||
        options.json ||
        options.dryRun ||
        options.listTools ||
        options.listAgents ||
        options.listPolicy ||
        options.doctor ||
        options.trust ||
        options.untrust ||
        options.listTrusted ||
        options.migrate ||
        env.AGENT_TASK ||
        pipedStdin
    );
}


function hasConfiguredPort(env = process.env) {
    const configuredPort = env.PORT;
    return configuredPort !== undefined && String(configuredPort).trim() !== "";
}


function resolveWebServerOptions(options, env = process.env, context = {}) {
    const configuredPort = env.PORT;
    const hasPort = hasConfiguredPort(env);

    if (options.serve && options.port !== undefined) return options;
    if (!options.serve && hasExplicitNonWebCommand(options, env, context)) return options;
    if (!hasPort) return options;

    const port = Number(String(configuredPort).trim());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        const error = new Error("PORT must be an integer between 1 and 65535.");
        error.exitCode = 2;
        throw error;
    }

    if (options.serve) {
        options.port = port;
        options.host ||= "0.0.0.0";
        return options;
    }

    if (!hasExplicitNonWebCommand(options, env, context)) {
        options.serve = true;
        options.port = port;
        options.host ||= "0.0.0.0";
        options.autoServe = true;
    }

    return options;
}


module.exports = { resolveWebServerOptions, hasExplicitNonWebCommand, hasConfiguredPort };
