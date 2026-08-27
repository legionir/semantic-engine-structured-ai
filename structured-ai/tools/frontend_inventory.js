"use strict";

/*
|--------------------------------------------------------------------------
| Frontend inventory — EXECUTION_PLAN Phase 24
|--------------------------------------------------------------------------
|
| The console has no build step and no framework, so nothing checks that a
| module graph the browser can load is even *well formed* — a typo in an import
| path is a blank page in production and a green suite here. This tool turns the
| properties that a bundler would have enforced into a recorded artifact: the DOM
| ids the console reads, the API paths it fetches, the event types it reduces,
| the class names it draws, the top-level names it defines and the listeners it
| binds. Recorded from app.js before the split, asserted against web/public/app/
| after it: if a name is equal in both, the code that produced it survived.
|
*/

const fs = require("fs");
const path = require("path");

function inventory(text) {

    const all = (re, group = 1) => {

        const found = new Set();

        for (const match of text.matchAll(re)) {
            found.add(match[group]);
        }

        return [...found].sort();
    };

    return {
        /* every element the console reaches for by id, however it spells it */

        domIds: all(/(?:\bel\(|document\.getElementById\()\s*"([^"]+)"/g),

        /* every endpoint it talks to, with the interpolations folded away */

        apiPaths: all(/["'`]([^"'`]*\/api\/[^"'`$]*)/g)
            .filter(p => p.startsWith("/api/"))
            .concat(all(/`([^`]*\/api\/[^`$]*)\$\{/g).map(p => p + "…"))
            .sort(),

        /* the event names the reducer recognises — the stream contract */

        eventNames: all(/"([a-z][a-z_]*:[a-z:_-]+)"/g),

        /* …and exactly where each one is tested, so a moved case cannot be
           dropped out of the one if-chain that reads them */

        eventChecks: all(/event\.type\s*(?:===|!==|\.startsWith\()\s*"([a-z:_-]+)"/g)
            .concat(all(/"([a-z:_-]+)"\s*(?:===|\.startsWith)/g))
            .filter((value, index, list) => list.indexOf(value) === index)
            .sort(),

        /* module-level constants: storage keys, tab lists, labels */

        constStrings: all(/^(?:export )?const [A-Z][A-Z0-9_]*\s*=\s*\n?\s*"([^"]+)"/gm),

        /* classes the console creates — the CSS is a contract too */

        classNames: all(/className\s*=\s*"([^"]+)"/g)
            .concat(all(/classList\.(?:add|remove|toggle)\(\s*"([^"]+)"/g))
            .concat(all(/node\(\s*"[a-z0-9]+"\s*,\s*"([^"]+)"/g))
            .filter((value, index, list) => list.indexOf(value) === index)
            .sort(),

        /* the DOM APIs it depends on, which is what a shim must implement */

        domApis: all(/\.(addEventListener|removeEventListener|querySelector|querySelectorAll|createElement|appendChild|removeChild|remove|insertBefore|setAttribute|getAttribute|preventDefault|stopPropagation|requestSubmit|scrollTo|focus|blur|replaceChildren|closest)\(/g)
            .sort(),

        topLevelNames: all(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)
            .concat(all(/^(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm))
            .filter((value, index, list) => list.indexOf(value) === index)
            .sort(),

        /* the console's state literal, key by key, with the source text of each
           initial value: what a domain slice must reproduce exactly */

        stateShape: (() => {

            const lines = text.split("\n");
            const start = lines.findIndex(line => /^const state = \{/.test(line));

            if (start === -1) return [];

            /* walk the literal by brace depth — no regex can match a pair */

            let depth = 0;
            let end = start;

            for (let i = start; i < lines.length; i += 1) {

                for (const char of lines[i]) {

                    if (char === "{") depth += 1;
                    if (char === "}") depth -= 1;
                }

                if (depth === 0 && i > start) { end = i; break; }

                if (depth === 0 && i === start && /\};\s*$/.test(lines[i])) { end = i; break; }
            }

            const body = lines.slice(start + 1, end).join("\n");

            const parts = [];
            let level = 0;
            let current = "";

            for (const char of body) {

                if ("{[".includes(char)) level += 1;
                if ("}]}".includes(char)) level -= 1;

                if (char === "," && level === 0) { parts.push(current); current = ""; continue; }

                current += char;
            }

            if (current.trim() !== "") parts.push(current);

            return parts
                .map(part => {

                    const key = /^\s*([A-Za-z0-9_$]+):/.exec(part);

                    return key
                        ? { key: key[1], value: part.slice(key[0].length).trim().replace(/\s+/g, " ") }
                        : null;
                })
                .filter(Boolean)
                .sort((a, b) => a.key.localeCompare(b.key));
        })(),

        /* which control answers which browser event — the wiring contract */

        listeners: [...text.matchAll(/^\s*([A-Za-z0-9_$.()"]+)\.addEventListener\(\s*"([a-z]+)"/gm)]
            .map(match => `${match[1]} → ${match[2]}`)
            .sort()
    };
}

/* the diff of two inventories, which is what the contract test reports */

function differences(before, after) {

    const report = {};

    for (const field of Object.keys(before)) {

        const oldList = field === "stateShape"
            ? before[field].map(entry => `${entry.key}=${entry.value}`)
            : before[field];

        const newList = field === "stateShape"
            ? after[field].map(entry => `${entry.key}=${entry.value}`)
            : after[field];

        const lost = oldList.filter(value => !newList.includes(value));
        const gained = newList.filter(value => !oldList.includes(value));

        if (lost.length || gained.length) report[field] = { lost, gained };
    }

    return report;
}

if (require.main === module) {

    const target = process.argv[2];
    const out = process.argv[3];

    const data = inventory(fs.readFileSync(target, "utf8"));

    if (out) {

        fs.writeFileSync(out, JSON.stringify({ recordedFrom: path.basename(target), ...data }, null, 2) + "\n");

        for (const [key, list] of Object.entries(data)) {
            console.log(`  ${key.padEnd(14)} ${list.length}`);
        }

        console.log(`\nrecorded → ${out}`);

    } else {

        console.log(JSON.stringify(data, null, 2));
    }
}

module.exports = { inventory, differences };
