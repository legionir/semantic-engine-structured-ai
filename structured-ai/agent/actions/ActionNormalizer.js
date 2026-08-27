"use strict";

/*
|--------------------------------------------------------------------------
| Action Normalizer (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Argument shape normalisation used both while reading a model answer and
| later when the runtime graph executes a call. Behaviour is identical to
| the historical helpers in agent.js.
|--------------------------------------------------------------------------
*/

const ctx = require("./context");


function parseArguments(value, toolName) {

    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value;
    }

    if (typeof value === "string") {

        if (value.trim() === "") {
            return {};
        }

        try {

            const parsed =
                JSON.parse(value);

            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed;
            }

            throw new Error("not an object");

        } catch {

            throw new Error(
                `Arguments for "${toolName}" are a string that is not a JSON object.`
            );
        }
    }

    return {};
}


function keepDeclaredArguments(name, args) {

    const declared =
        ctx.toolsOf().find(
            tool => tool.function.name === name
        );

    const properties =
        declared?.function?.parameters?.properties;

    if (!properties) {

        return { arguments: args, dropped: [] };
    }

    const kept = {};
    const dropped = [];

    for (const [key, value] of Object.entries(args)) {

        if (Object.prototype.hasOwnProperty.call(properties, key)) {

            kept[key] = value;

            continue;
        }

        dropped.push(key);
    }

    return { arguments: kept, dropped };
}


module.exports = {
    parseArguments,
    keepDeclaredArguments
};
