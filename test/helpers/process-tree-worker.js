"use strict";

/*
| A short-lived test helper used by process reliability tests. The outer
| process and this child both stay alive so the test can verify that a
| terminal timeout/termination removes the entire descendant tree on
| Windows (taskkill /T) as well as POSIX process groups.
*/

const fs = require("fs");
const { spawn } = require("child_process");

const pidFile = process.argv[2];

if (!pidFile) {
    throw new Error("pid file argument is required");
}

const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
        stdio: "ignore",
        windowsHide: true
    }
);

fs.writeFileSync(pidFile, `${process.pid}\n${child.pid}\n`);
setInterval(() => {}, 1000);
