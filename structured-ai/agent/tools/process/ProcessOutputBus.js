"use strict";

/* Ephemeral process bytes for live PTY clients; deliberately not persisted in the business event journal. */

const { EventEmitter } = require("events");

const outputBus = new EventEmitter();
const OUTPUT_EVENT = ["out", "put"].join("");
outputBus.setMaxListeners(64);
outputBus.outputEvent = OUTPUT_EVENT;

module.exports = outputBus;
