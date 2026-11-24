"use strict";

/* REPL output boundary — EXECUTION_PLAN Phase 26. */

const colours = process.stdout.isTTY && process.env.NO_COLOR === undefined
    ? {
        dim: text => `\u001b[2m${text}\u001b[0m`,
        bold: text => `\u001b[1m${text}\u001b[0m`,
        green: text => `\u001b[32m${text}\u001b[0m`,
        red: text => `\u001b[31m${text}\u001b[0m`,
        yellow: text => `\u001b[33m${text}\u001b[0m`
    }
    : {
        dim: text => text,
        bold: text => text,
        green: text => text,
        red: text => text,
        yellow: text => text
    };

function formatDuration(ms) {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function write(stream, value) {
    stream.write(String(value));
}

module.exports = {
    colours,
    formatDuration,
    write
};
