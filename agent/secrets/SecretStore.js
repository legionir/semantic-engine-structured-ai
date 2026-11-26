"use strict";

/*
|--------------------------------------------------------------------------
| Secret Store (roadmap P4-01)
|--------------------------------------------------------------------------
|
| Tokens an MCP server needs (a GitHub PAT, a search API key) are kept
| here instead of in a configuration file. The store is one file in the
| data home, encrypted with AES-256-GCM:
|
|   <data home>/secrets.enc    the encrypted names and values
|   <data home>/secrets.key    the 32-byte key, created on first use
|
| SECRET_STORE_KEY replaces the key file with a passphrase from the
| environment. A process the model starts never sees it: ChildEnvironment
| drops every credential-looking name, and nothing in the store is ever
| handed to a tool.
|
| A configuration refers to a value as ${secret:NAME}; only operator
| configuration may (McpConfigValidator). The console can list the names,
| add and delete; there is deliberately no route or tool that returns a
| value. Every value held here is masked by EventRedactor wherever the
| runtime writes or answers text: the log, the journal, API responses.
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const settings = require("../config");

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORMAT_VERSION = "1";
const ALGORITHM = "aes-256-gcm";

const changes = new EventEmitter();

let cache = null;


function dataHome() {
    return require("../projects/ProjectStore").resolveDataHome();
}


function storeFile() {
    return path.join(dataHome(), "secrets.enc");
}


function keyFile() {
    return path.join(dataHome(), "secrets.key");
}


function maxValueChars() {
    return 16384;
}


function writePrivate(file, data) {

    fs.mkdirSync(path.dirname(file), { recursive: true });

    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(temp, data, { mode: 0o600 });

    try {
        fs.chmodSync(temp, 0o600);
    } catch {
        /* platforms without POSIX modes keep the default */
    }

    fs.renameSync(temp, file);
}


/*
| The key: a passphrase from SECRET_STORE_KEY (stretched with scrypt and
| a fixed salt, so the same passphrase opens the same store), otherwise
| the key file, which is created the first time a secret is written.
*/

function key({ create = false } = {}) {

    const passphrase = settings.get("SECRET_STORE_KEY");

    if (typeof passphrase === "string" && passphrase.length > 0) {
        return crypto.scryptSync(passphrase, "structured-ai/secret-store/v1", 32);
    }

    const file = keyFile();

    if (fs.existsSync(file)) {

        const raw = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");

        if (raw.length !== 32) {
            throw new Error(`the secret store key at ${file} is damaged (expected 32 bytes)`);
        }

        return raw;
    }

    if (!create) {
        return null;
    }

    const fresh = crypto.randomBytes(32);

    writePrivate(file, `${fresh.toString("base64")}\n`);

    return fresh;
}


function emptyDocument() {
    return { secrets: {} };
}


function fileStamp(file) {
    try {
        const stat = fs.statSync(file);
        return `${stat.mtimeMs}:${stat.size}`;
    } catch {
        return null;
    }
}


function readDocument() {

    const file = storeFile();
    const stamp = fileStamp(file);

    if (!stamp) {
        cache = { file, stamp: null, document: emptyDocument() };
        return cache.document;
    }

    if (cache && cache.file === file && cache.stamp === stamp) {
        return cache.document;
    }

    let envelope;

    try {
        envelope = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`the secret store at ${file} is not readable: ${error.message}`);
    }

    const secretKey = key();

    if (!secretKey) {
        throw new Error(
            `the secret store at ${file} exists but its key does not (${keyFile()}); ` +
            "restore the key file or set SECRET_STORE_KEY"
        );
    }

    let document;

    try {

        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            secretKey,
            Buffer.from(envelope.iv, "base64")
        );

        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

        const plain = Buffer.concat([
            decipher.update(Buffer.from(envelope.data, "base64")),
            decipher.final()
        ]).toString("utf8");

        document = JSON.parse(plain);

    } catch {
        throw new Error(
            `the secret store at ${file} could not be decrypted ` +
            "(a different SECRET_STORE_KEY, or a damaged key file)"
        );
    }

    if (!document || typeof document.secrets !== "object" || document.secrets === null) {
        document = emptyDocument();
    }

    cache = { file, stamp, document };

    return document;
}


function writeDocument(document) {

    const secretKey = key({ create: true });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, secretKey, iv);

    const data = Buffer.concat([
        cipher.update(JSON.stringify(document), "utf8"),
        cipher.final()
    ]);

    const envelope = {
        version: FORMAT_VERSION,
        algorithm: ALGORITHM,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64")
    };

    const file = storeFile();

    writePrivate(file, `${JSON.stringify(envelope)}\n`);

    cache = { file, stamp: fileStamp(file), document };
}


function changed(name, action) {

    try {
        require("../events/EventRedactor").resetKnownSecrets();
    } catch {
        /* the redactor recomputes within a second anyway */
    }

    changes.emit("change", { name, action });
}


function checkName(name) {

    const value = String(name ?? "").trim();

    if (!NAME_PATTERN.test(value)) {
        const error = new Error(
            `"${value}" is not a usable secret name; use letters, digits and underscore, starting with a letter or underscore (at most 64)`
        );
        error.status = 400;
        throw error;
    }

    return value;
}


/* names and dates only: a value never leaves this module through list() */
function list() {

    const document = readDocument();

    return Object.entries(document.secrets)
        .map(([name, entry]) => ({
            name,
            created_at: entry.created_at || null,
            updated_at: entry.updated_at || null,
            length: typeof entry.value === "string" ? entry.value.length : 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}


function has(name) {

    try {
        return Object.prototype.hasOwnProperty.call(readDocument().secrets, String(name));
    } catch {
        return false;
    }
}


/*
| Internal: used by McpConfigValidator to resolve ${secret:NAME} in
| operator configuration. No route and no tool calls this.
*/
function resolve(name) {

    const entry = readDocument().secrets[String(name)];

    return entry && typeof entry.value === "string" ? entry.value : undefined;
}


function set(name, value) {

    const checked = checkName(name);

    if (typeof value !== "string" || value.length === 0) {
        const error = new Error(`secret "${checked}" needs a non-empty value`);
        error.status = 400;
        throw error;
    }

    if (value.length > maxValueChars()) {
        const error = new Error(`secret "${checked}" is longer than ${maxValueChars()} characters`);
        error.status = 400;
        throw error;
    }

    const document = readDocument();
    const now = new Date().toISOString();
    const previous = document.secrets[checked];
    const next = {
        secrets: {
            ...document.secrets,
            [checked]: {
                value,
                created_at: previous?.created_at || now,
                updated_at: now
            }
        }
    };

    writeDocument(next);
    changed(checked, previous ? "updated" : "created");

    return { name: checked, created: !previous };
}


function remove(name) {

    const checked = checkName(name);
    const document = readDocument();

    if (!Object.prototype.hasOwnProperty.call(document.secrets, checked)) {
        return false;
    }

    const secrets = { ...document.secrets };

    delete secrets[checked];

    writeDocument({ secrets });
    changed(checked, "deleted");

    return true;
}


/* every stored value, for masking (EventRedactor); never fails */
function values() {

    try {
        return Object.values(readDocument().secrets)
            .map(entry => entry && entry.value)
            .filter(value => typeof value === "string" && value.length > 0);
    } catch {
        return [];
    }
}


/* the ${secret:NAME} references inside a (raw) definition */
function referencesIn(value, into = new Set()) {

    if (typeof value === "string") {
        for (const match of value.matchAll(/\$\{secret:([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
            into.add(match[1]);
        }
    } else if (Array.isArray(value)) {
        value.forEach(item => referencesIn(item, into));
    } else if (value && typeof value === "object") {
        Object.values(value).forEach(item => referencesIn(item, into));
    }

    return into;
}


function resetCache() {
    cache = null;
}


module.exports = {
    NAME_PATTERN,
    changes,
    storeFile,
    keyFile,
    checkName,
    list,
    has,
    resolve,
    set,
    remove,
    values,
    referencesIn,
    resetCache
};
