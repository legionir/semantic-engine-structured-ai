"use strict";

/*
|--------------------------------------------------------------------------
| Which skills are sent to the AI
|--------------------------------------------------------------------------
|
| Every skill can be loaded (skill_get) or attached to one message
| (`/skill <name>`); only the skills "sent to the AI" are listed in the
| prompt's skill index, which every request pays for.
|
| Default: a library skill (agent/skill-library) is sent only when its
| library recommends it; every other skill — the registry skills, the
| runtime's own SKILL.md skills, the operator's and the project's — is
| sent. The operator overrides either way, per skill name; an override
| equal to the default is dropped, so a library update that changes its
| recommendations still reaches anyone who never touched that skill.
|
|   <data home>/skills-prompt.json   { "enabled": [...], "disabled": [...] }
|
| The file is re-read when its modification time changes, so a change
| made by the console reaches the next request without a restart.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const FILE_NAME = "skills-prompt.json";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const CACHE = { file: null, mtime: null, value: null };


function selectionFile() {

    const { resolveDataHome } = require("../../projects/ProjectStore");

    return path.join(resolveDataHome(), FILE_NAME);
}


function cleanList(value) {

    return Array.isArray(value)
        ? [...new Set(value.filter(name => typeof name === "string" && NAME_PATTERN.test(name)))].sort()
        : [];
}


function readOverrides() {

    let file;

    try {
        file = selectionFile();
    } catch {
        return { enabled: new Set(), disabled: new Set() };
    }

    let mtime = null;

    try {
        mtime = fs.statSync(file).mtimeMs;
    } catch {
        mtime = null;
    }

    if (CACHE.file !== file || CACHE.mtime !== mtime) {

        let parsed = {};

        if (mtime !== null) {
            try {
                parsed = JSON.parse(fs.readFileSync(file, "utf8")) || {};
            } catch {
                parsed = {};
            }
        }

        CACHE.file = file;
        CACHE.mtime = mtime;
        CACHE.value = { enabled: new Set(cleanList(parsed.enabled)), disabled: new Set(cleanList(parsed.disabled)) };
    }

    return CACHE.value;
}


function writeOverrides({ enabled, disabled }) {

    const file = selectionFile();
    const temporary = `${file}.${process.pid}.tmp`;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify({ enabled: cleanList([...enabled]), disabled: cleanList([...disabled]) }, null, 2)}\n`);
    fs.renameSync(temporary, file);

    CACHE.file = null;
}


function defaultEnabled(skill) {

    return skill.origin === "library" ? skill.recommended === true : true;
}


function isPromptEnabled(skill) {

    const { enabled, disabled } = readOverrides();

    if (disabled.has(skill.name)) return false;
    if (enabled.has(skill.name)) return true;

    return defaultEnabled(skill);
}


/* Records the operator's choice for one skill; returns the new state. */
function setPromptEnabled(skill, wanted) {

    const current = readOverrides();
    const enabled = new Set(current.enabled);
    const disabled = new Set(current.disabled);

    enabled.delete(skill.name);
    disabled.delete(skill.name);

    if (Boolean(wanted) !== defaultEnabled(skill)) {
        (wanted ? enabled : disabled).add(skill.name);
    }

    writeOverrides({ enabled, disabled });

    return isPromptEnabled(skill);
}


/* Back to the defaults: the libraries' recommendations, everything else on. */
function resetPromptSelection() {

    writeOverrides({ enabled: new Set(), disabled: new Set() });
}


module.exports = {
    FILE_NAME,
    defaultEnabled,
    isPromptEnabled,
    setPromptEnabled,
    resetPromptSelection
};
