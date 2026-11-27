#!/usr/bin/env node
"use strict";

/*
| Refresh a vendored skill library from a local checkout of its source.
|
|   git clone --depth 1 -b claude-code-format https://github.com/legionir/persona /tmp/persona
|   node tools/sync-skill-library.js /tmp/persona
|
| Copies every <checkout>/skills/<name>/SKILL.md with its references/ into
| agent/skill-library/persona/, drops skills that no longer exist, copies
| LICENSE, and records the commit in manifest.json. The recommended list in
| the manifest is kept; a recommended skill that disappeared is reported.
*/

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LIBRARY = path.join(__dirname, "..", "agent", "skill-library", "persona");


function main(checkout) {

    if (!checkout || !fs.existsSync(path.join(checkout, "skills"))) {
        console.error("usage: node tools/sync-skill-library.js <persona checkout>");
        process.exit(2);
    }

    const source = path.join(checkout, "skills");
    const names = fs.readdirSync(source, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && fs.existsSync(path.join(source, entry.name, "SKILL.md")))
        .map(entry => entry.name)
        .sort();

    for (const entry of fs.readdirSync(LIBRARY, { withFileTypes: true })) {
        if (entry.isDirectory() && !names.includes(entry.name)) {
            fs.rmSync(path.join(LIBRARY, entry.name), { recursive: true, force: true });
        }
    }

    for (const name of names) {
        const target = path.join(LIBRARY, name);
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(target, { recursive: true });
        fs.copyFileSync(path.join(source, name, "SKILL.md"), path.join(target, "SKILL.md"));
        const references = path.join(source, name, "references");
        if (fs.existsSync(references)) {
            fs.cpSync(references, path.join(target, "references"), { recursive: true, dereference: true });
        }
    }

    fs.copyFileSync(path.join(checkout, "LICENSE"), path.join(LIBRARY, "LICENSE"));

    const manifestFile = path.join(LIBRARY, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

    manifest.source.commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const gone = manifest.recommended.filter(name => !names.includes(name));

    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`${names.length} skills synced at ${manifest.source.commit}`);

    if (gone.length > 0) {
        console.log(`recommended but no longer in the library: ${gone.join(", ")}`);
        process.exitCode = 1;
    }
}


main(process.argv[2]);
