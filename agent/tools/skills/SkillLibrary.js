"use strict";

/*
|--------------------------------------------------------------------------
| Shipped skill libraries
|--------------------------------------------------------------------------
|
| Third-party SKILL.md collections vendored under agent/skill-library/:
|
|   agent/skill-library/<library>/manifest.json   source, license, the
|                                                  recommended skills
|   agent/skill-library/<library>/<skill>/SKILL.md
|
| A library is large (the persona library is 218 skills), ships with the
| runtime and does not change while it runs, so it is read once per
| process — keyed by the directory's modification time — instead of on
| every prompt like the project's own skills.
|
| Every library skill is available to skill_get and to `/skill`; only
| the `recommended` ones go into the prompt's skill index by default
| (SkillSelection.js decides, the operator can change it).
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const LIBRARY_ROOT = path.join(__dirname, "..", "..", "skill-library");

const CACHE = new Map();


function statMtime(file) {

    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
}


function readManifest(directory) {

    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
        return manifest && typeof manifest === "object" ? manifest : {};
    } catch {
        return {};
    }
}


function libraryDirectories(root = LIBRARY_ROOT) {

    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => ({ name: entry.name, dir: path.join(root, entry.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}


function loadLibrary({ name, dir }) {

    const signature = `${statMtime(dir)}:${statMtime(path.join(dir, "manifest.json"))}`;
    const cached = CACHE.get(dir);

    if (cached && cached.signature === signature) {
        return cached.library;
    }

    const { readSkill } = require("./MarkdownSkills");
    const manifest = readManifest(dir);
    const recommended = new Set(Array.isArray(manifest.recommended) ? manifest.recommended : []);
    const skills = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {

        if (!entry.isDirectory()) continue;

        const skill = readSkill(path.join(dir, entry.name), "library");

        if (!skill) continue;

        skills.push({ ...skill, library: name, recommended: recommended.has(skill.name) });
    }

    const library = {
        name,
        title: typeof manifest.title === "string" ? manifest.title : name,
        license: typeof manifest.license === "string" ? manifest.license : null,
        source: manifest.source && typeof manifest.source === "object" ? manifest.source : null,
        recommended: [...recommended],
        skills
    };

    CACHE.set(dir, { signature, library });

    return library;
}


/* Every library, each with its skills; the first library wins a name. */
function libraries(root = LIBRARY_ROOT) {

    return libraryDirectories(root).map(loadLibrary);
}


function loadLibrarySkills(root = LIBRARY_ROOT) {

    const seen = new Set();
    const skills = [];

    for (const library of libraries(root)) {
        for (const skill of library.skills) {
            if (seen.has(skill.name)) continue;
            seen.add(skill.name);
            skills.push(skill);
        }
    }

    return skills;
}


module.exports = {
    LIBRARY_ROOT,
    libraries,
    loadLibrarySkills
};
