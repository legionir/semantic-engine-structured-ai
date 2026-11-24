"use strict";

const fs = require("fs");
const path = require("path");

const summaryPath = path.join(__dirname, "..", "coverage", "coverage-summary.json");
if (!fs.existsSync(summaryPath)) {
    console.error("Coverage summary is missing; run the c8 coverage suite first.");
    process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const roots = ["agent/policy/", "agent/mcp/", "agent/tools/"];
let failed = false;

for (const root of roots) {
    const marker = `/${root}`;
    const files = Object.entries(summary)
        .filter(([file]) => file.replace(/\\/g, "/").includes(marker));
    const total = files.reduce((sum, [, data]) => sum + data.lines.total, 0);
    const covered = files.reduce((sum, [, data]) => sum + data.lines.covered, 0);
    const percent = total === 0 ? 0 : (covered / total) * 100;
    console.log(`${root}: ${percent.toFixed(2)}% (${covered}/${total} lines across ${files.length} files)`);
    if (files.length === 0 || percent <= 80) {
        failed = true;
    }
}

if (failed) {
    console.error("Each P1 coverage area must be strictly above 80% line coverage.");
    process.exit(1);
}
