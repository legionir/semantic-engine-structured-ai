"use strict";

const runAgent = require("./run-agent");
const { runSession } = require("./run-session");
const lifecycle = require("./lifecycle");


module.exports = {
    bind: runAgent.bind,
    runAgent: runAgent.runAgent,
    main: runAgent.main,
    runSession,
    lifecycle
};
