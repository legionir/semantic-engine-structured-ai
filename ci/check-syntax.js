"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ROOTS = ["agent", "bin", "ci", "web"];
const SKIP_DIRS = new Set(["node_modules", ".git", "vendor"]);

function collectJsFiles(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectJsFiles(full, out);
        } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const files = [];
for (const segment of ROOTS) {
    collectJsFiles(path.join(ROOT, segment), files);
}
files.sort();

let checked = 0;
for (const file of files) {
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
    checked += 1;
}

console.log(`Syntax OK across ${checked} JS/MJS files.`);
