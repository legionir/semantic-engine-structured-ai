"use strict";

/*
|--------------------------------------------------------------------------
| Settings Schema — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Canonical definitions for every runtime setting: type, default, min/max,
| group, secret/fixed flags and description. Callers never read env vars
| directly; they go through SettingsStore/SettingsResolver so a change is
| visible on the next get().
|--------------------------------------------------------------------------
*/

const NUMBER = "number";
const STRING = "string";
const BOOLEAN = "boolean";
const ENUM = "enum";


/*
| group        where the value belongs in the console
| fixed        read once at startup, changing it later would be a lie
| secret       never echoed back in full
*/

const DEFINITIONS = [
    ...require("./settings-definitions/01"),
    ...require("./settings-definitions/02"),
    ...require("./settings-definitions/03"),
    ...require("./settings-definitions/04"),
    ...require("./settings-definitions/05")
];


const BY_KEY =
    new Map(
        DEFINITIONS.map(
            definition => [definition.key, definition]
        )
    );

function coerce(definition, raw) {

    if (
        raw === undefined ||
        raw === null ||
        raw === ""
    ) {
        return definition.default;
    }

    if (definition.type === NUMBER) {

        const value = Number(raw);

        if (!Number.isFinite(value)) {

            throw new Error(
                `${definition.key} expects a number, received "${raw}".`
            );
        }

        if (
            definition.min !== undefined &&
            value < definition.min
        ) {

            throw new Error(
                `${definition.key} must be at least ${definition.min}.`
            );
        }

        if (
            definition.max !== undefined &&
            value > definition.max
        ) {

            throw new Error(
                `${definition.key} must be at most ${definition.max}.`
            );
        }

        return value;
    }

    if (definition.type === BOOLEAN) {

        if (typeof raw === "boolean") {
            return raw;
        }

        const text = String(raw).toLowerCase();

        if (["1", "true", "yes", "on"].includes(text)) {
            return true;
        }

        if (["0", "false", "no", "off"].includes(text)) {
            return false;
        }

        throw new Error(
            `${definition.key} expects a boolean, received "${raw}".`
        );
    }

    if (definition.type === ENUM) {

        const text = String(raw);

        if (!definition.values.includes(text)) {

            throw new Error(
                `${definition.key} must be one of: ${
                    definition.values.join(", ")
                }`
            );
        }

        return text;
    }

    return String(raw);
}


function definitionOf(key) {

    const definition = BY_KEY.get(key);

    if (!definition) {

        throw new Error(
            `Unknown setting: ${key}`
        );
    }

    return definition;
}


module.exports = {
    NUMBER,
    STRING,
    BOOLEAN,
    ENUM,
    DEFINITIONS,
    BY_KEY,
    coerce,
    definitionOf
};
