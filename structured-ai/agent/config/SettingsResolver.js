"use strict";

/*
|--------------------------------------------------------------------------
| Settings Resolver — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Priority: runtime override, then environment, then schema default.
| Resolution happens on every read so a console change is visible inside
| a loop that is already running.
|--------------------------------------------------------------------------
*/

const { coerce, definitionOf } = require("./SettingsSchema");


function resolve(key, overrides, env) {

    const definition = definitionOf(key);

    if (overrides.has(key)) {

        return {
            definition,
            value: overrides.get(key),
            source: "override"
        };

    }

    const raw = env[key];

    if (raw !== undefined && raw !== "") {

        return {
            definition,
            value: coerce(definition, raw),
            source: "environment"
        };

    }

    return {
        definition,
        value: coerce(definition, undefined),
        source: "default"
    };

}


module.exports = {
    resolve
};
