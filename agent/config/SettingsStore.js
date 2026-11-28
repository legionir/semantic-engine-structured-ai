"use strict";

const { EventEmitter } = require("events");

const { DEFINITIONS, coerce, definitionOf } = require("./SettingsSchema");
const { resolve } = require("./SettingsResolver");
const { maskSecret, maskUrlPassword, restoreUrlPassword } = require("./SecretMasker");


/* what leaves the store for the console, logs and snapshots */
function shown(definition, value) {

    if (definition.secret) return maskSecret(value);
    if (definition.format === "proxy-url") return maskUrlPassword(value);

    return value;
}


/*
|--------------------------------------------------------------------------
| Settings Store — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| The live map of overrides plus the public get/set/reset/snapshot API.
| All runtime configuration reads go through this canonical store.
|--------------------------------------------------------------------------
*/

const bus = new EventEmitter();

bus.setMaxListeners(64);

const overrides = new Map();


function get(key) {

    return resolve(key, overrides, process.env).value;

}


function sourceOf(key) {

    return resolve(key, overrides, process.env).source;

}


function set(key, value) {

    const definition = definitionOf(key);

    if (definition.fixed) {

        throw new Error(
            `${key} is fixed for the lifetime of the process and cannot be changed at runtime.`
        );

    }

    const previous = get(key);

    /*
    | A secret saved as empty stays empty (Clear in the console), even when
    | its default is a placeholder; elsewhere "" still means the default.
    */
    const coerced =
        definition.secret && value === ""
            ? ""
            : coerce(
                definition,
                definition.format === "proxy-url" ? restoreUrlPassword(value, previous) : value
            );

    overrides.set(key, coerced);

    bus.emit("change", {
        key,
        previous,
        value: coerced
    });

    return coerced;

}


function reset(key) {

    const definition = definitionOf(key);

    if (definition.fixed) {

        throw new Error(
            `${key} is fixed and was never overridden.`
        );

    }

    const previous = get(key);

    overrides.delete(key);

    const value = get(key);

    bus.emit("change", {
        key,
        previous,
        value
    });

    return value;

}


function describe(definition) {

    const value = get(definition.key);

    return {
        key:
            definition.key,

        group:
            definition.group,

        type:
            definition.type,

        values:
            definition.values,

        min:
            definition.min,

        max:
            definition.max,

        fixed:
            Boolean(definition.fixed),

        secret:
            Boolean(definition.secret),

        format:
            definition.format,

        description:
            definition.description,

        default:
            definition.secret
                ? null
                : definition.default,

        value:
            shown(definition, value),

        source:
            sourceOf(definition.key)
    };

}


function all() {

    return DEFINITIONS.map(describe);

}


function snapshot() {

    return Object.fromEntries(
        DEFINITIONS
            .filter(definition => !definition.secret)
            .map(
                definition => [
                    definition.key,
                    shown(definition, get(definition.key))
                ]
            )
    );

}


module.exports = {
    bus,
    get,
    set,
    reset,
    all,
    describe,
    snapshot,
    sourceOf,
    definitionOf,
    definitions: DEFINITIONS,
    maskSecret
};
