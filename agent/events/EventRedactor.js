"use strict";

/*
| Event redaction — EXECUTION_PLAN Phase 27.
| Raw business events remain available to the event store; these helpers are
| used when an event is rendered into an operator log or external surface.
|
| P0-5: secrets are also masked by VALUE, not only by key. A tool that
| prints its environment, or an error that echoes a header, carries an API
| key inside ordinary text; that text is masked before it is logged or
| persisted (redactSecrets is what the event store and the journal use).
*/

const SECRET_KEY = /token|authorization|api[_-]?key|secret|password|credential/i;
const SOURCE_KEY = /^(content|source|raw|arguments|result)$/i;

const mask = "****";

/* Keys whose string value is a credential wherever it is persisted. Kept
   narrower than SECRET_KEY so counters such as max_tokens or input_tokens
   (numbers) and "tokens" lists survive in the stored stream. */
const persistedSecretKey =
    /^(?:.*[_-])?(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|bearer[_-]?token|secret|client[_-]?secret|password|passwd|passphrase|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|credentials?)$/i;

/* A bare "token" key is also used for streamed text, so only a value that
   looks like a credential (long, no whitespace) is masked under it. */
const bareTokenKey = /^(?:.*[_-])?token$/i;

const credentialEnvName =
    /(api[_-]?key|apikey|token|secret|passw(or)?d|credential|private[_-]?key|access[_-]?key|auth)/i;

const assignmentPattern =
    /\b([A-Z0-9_]*(?:API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)=([^\s"'`]+)/g;

const authSchemePattern =
    /\b(Bearer|Basic|token)\s+([A-Za-z0-9._~+/=-]{8,})/g;

const knownShapePattern =
    /\b(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g;

const minimumSecretLength = 8;

/* a stored secret was put there on purpose, so shorter ones count */
const minimumStoredSecretLength = 4;

let knownValueCache = { at: 0, values: [] };


/*
| The secret values this runtime actually holds: credential-named
| environment variables and settings flagged secret. Recomputed at most
| once a second, because a test or the console may change them.
*/

function knownSecretValues() {

    const now = Date.now();

    if (now - knownValueCache.at < 1000) {
        return knownValueCache.values;
    }

    const values = new Set();

    for (const name of Object.keys(process.env)) {

        const value = process.env[name];

        if (
            typeof value === "string" &&
            value.length >= minimumSecretLength &&
            credentialEnvName.test(name)
        ) {
            values.add(value);
        }
    }

    try {

        const settings = require("../config");
        const schema = require("../config/SettingsSchema");

        for (const definition of schema.DEFINITIONS || []) {

            if (!definition || definition.secret !== true) {
                continue;
            }

            let value;

            try {
                value = settings.get(definition.key);
            } catch {
                continue;
            }

            if (
                typeof value === "string" &&
                value.length >= minimumSecretLength &&
                value !== definition.default
            ) {
                values.add(value);
            }
        }

    } catch {

        /* settings are optional here: environment values still apply */
    }

    /* P4-01: every value in the secret store, however it is named */
    try {

        for (const value of require("../secrets/SecretStore").values()) {

            if (value.length >= minimumStoredSecretLength) {
                values.add(value);
            }
        }

    } catch {

        /* no store, or one that cannot be opened: nothing to add */
    }

    knownValueCache = {
        at: now,
        values: [...values].sort((a, b) => b.length - a.length)
    };

    return knownValueCache.values;
}


function resetKnownSecrets() {

    knownValueCache = { at: 0, values: [] };
}


/* Mask every secret that appears inside free text. */
function maskText(text) {

    if (typeof text !== "string" || text.length === 0) {
        return text;
    }

    let output = text;

    for (const value of knownSecretValues()) {

        if (output.includes(value)) {
            output = output.split(value).join(mask);
        }
    }

    output = output
        .replace(assignmentPattern, (whole, name) => `${name}=${mask}`)
        .replace(authSchemePattern, (whole, scheme) => `${scheme} ${mask}`)
        .replace(knownShapePattern, mask);

    return output;
}


function redact(value, { sourceContent = false, maxSourceChars = 240 } = {}) {

    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
        const masked = maskText(value);
        return sourceContent && masked.length > maxSourceChars
            ? `${masked.slice(0, maxSourceChars)}…`
            : masked;
    }

    if (Array.isArray(value)) {
        return value.map(item => redact(item, { sourceContent, maxSourceChars }));
    }

    if (typeof value !== "object") return value;

    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) {
            output[key] = "****";
        } else {
            output[key] = redact(item, {
                sourceContent: sourceContent || SOURCE_KEY.test(key),
                maxSourceChars
            });
        }
    }
    return output;
}


function maskAllStrings(value, seen) {

    if (typeof value === "string") {
        return value.length > 0 ? mask : value;
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    return redactSecrets(value, seen, true);
}


function isSecretKey(key, item) {

    if (persistedSecretKey.test(key)) {
        return true;
    }

    if (bareTokenKey.test(key)) {

        return (
            typeof item === "string" &&
            item.length >= 16 &&
            !/\s/.test(item)
        );
    }

    return false;
}


/*
| Persistence-grade redaction: the full event is kept (no truncation),
| credential-keyed strings are masked and every string is scanned for
| secret values. Numbers, booleans and structure are left untouched.
*/

function redactSecrets(value, seen = new WeakSet(), maskStrings = false) {

    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
        return maskStrings ? (value.length > 0 ? mask : value) : maskText(value);
    }

    if (typeof value !== "object") return value;

    if (typeof value.toJSON === "function" && !Array.isArray(value)) {
        return value;
    }

    if (seen.has(value)) {
        return undefined;
    }

    seen.add(value);

    let output;

    if (Array.isArray(value)) {

        output = value.map(item => redactSecrets(item, seen, maskStrings));

    } else {

        output = {};

        for (const [key, item] of Object.entries(value)) {

            if (!maskStrings && isSecretKey(key, item)) {
                output[key] = typeof item === "string" ? mask : maskAllStrings(item, seen);
            } else {
                output[key] = redactSecrets(item, seen, maskStrings);
            }
        }
    }

    seen.delete(value);

    return output;
}


/*
| P4-01: value-only masking for API answers: every string is scanned for
| the secrets the runtime holds; keys and structure are left as they are.
*/
function maskDeep(value, seen = new WeakSet()) {

    if (typeof value === "string") return maskText(value);

    if (!value || typeof value !== "object" || seen.has(value)) return value;

    seen.add(value);

    const output = Array.isArray(value)
        ? value.map(item => maskDeep(item, seen))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item, seen)]));

    seen.delete(value);

    return output;
}


function redactEvent(event, options) {
    return redact(event, options);
}


function redactForLog(event) {
    return redactEvent(event, { sourceContent: true });
}


module.exports = {
    SECRET_KEY,
    SOURCE_KEY,
    redact,
    redactEvent,
    redactForLog,
    redactSecrets: value => redactSecrets(value),
    maskText,
    maskDeep: value => maskDeep(value),
    knownSecretValues,
    resetKnownSecrets
};
