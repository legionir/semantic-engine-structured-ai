"use strict";

const { EventEmitter } = require("events");

const { DEFINITIONS, coerce, definitionOf } = require("./SettingsSchema");
const { resolve } = require("./SettingsResolver");
const { maskSecret } = require("./SecretMasker");


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

    const coerced = coerce(definition, value);

    const previous = get(key);

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

        description:
            definition.description,

        default:
            definition.secret
                ? null
                : definition.default,

        value:
            definition.secret
                ? maskSecret(value)
                : value,

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
                    get(definition.key)
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
