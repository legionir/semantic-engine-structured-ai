"use strict";

/*
| CLI argument parser — EXECUTION_PLAN Phase 26.
| It has no runtime dependency: options are parsed before agent.js is loaded
| so command-line settings can become process environment safely.
*/

class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "UsageError";
        this.exitCode = 2;
    }
}


function defaultFail(message) {
    throw new UsageError(message);
}


function parseArguments(argv, { fail = defaultFail } = {}) {
    const options = { task: null, positional: [] };

    const requireValue = (flag, value) => {
        if (value === undefined || value.startsWith("-")) {
            fail(`${flag} requires a value`);
        }
        return value;
    };

    const requireNumber = (flag, value) => {
        const parsed = Number(requireValue(flag, value));
        if (!Number.isFinite(parsed)) fail(`${flag} expects a number`);
        return parsed;
    };

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];

        switch (argument) {
            case "-h":
            case "--help":
                options.help = true;
                break;
            case "--version":
                options.version = true;
                break;
            case "-C":
            case "-w":
            case "--dir":
            case "--workspace":
                options.workspace = requireValue(argument, argv[++index]);
                break;
            case "--project":
                options.project = requireValue(argument, argv[++index]);
                break;
            case "--migrate":
                options.migrate = requireValue(argument, argv[++index]);
                break;
            case "-f":
            case "--file":
                options.file = requireValue(argument, argv[++index]);
                break;
            case "-a":
            case "--approve":
                options.approve = requireValue(argument, argv[++index]);
                break;
            case "--dry-run":
                options.dryRun = true;
                break;
            case "-u":
            case "--until-done":
                options.untilDone = true;
                break;
            case "--max-cycles":
                options.maxCycles = requireNumber(argument, argv[++index]);
                break;
            case "--discussion":
                options.discussion = true;
                break;
            case "--personas":
                options.personas = requireValue(argument, argv[++index])
                    .split(",")
                    .map(id => id.trim())
                    .filter(id => id !== "");
                break;
            case "--max-rounds":
                options.maxRounds = requireNumber(argument, argv[++index]);
                break;
            case "-i":
            case "--interactive":
                options.interactive = true;
                break;
            case "-s":
            case "--serve":
                options.serve = true;
                if (argv[index + 1] && /^\d+$/.test(argv[index + 1])) {
                    options.port = Number(argv[++index]);
                }
                break;
            case "--host":
                options.host = requireValue(argument, argv[++index]);
                break;
            case "--json":
                options.json = true;
                break;
            case "-q":
            case "--quiet":
                options.quiet = true;
                break;
            case "-v":
            case "--verbose":
                options.quiet = false;
                break;
            case "-m":
            case "--model":
                options.model = requireValue(argument, argv[++index]);
                break;
            case "-t":
            case "--temperature":
                options.temperature = requireNumber(argument, argv[++index]);
                break;
            case "--base-url":
                options.baseUrl = requireValue(argument, argv[++index]);
                break;
            case "--api-key":
                options.apiKey = requireValue(argument, argv[++index]);
                break;
            case "--proxy-url":
                options.proxyUrl = requireValue(argument, argv[++index]);
                break;
            case "--timeout":
                options.timeoutSeconds = requireNumber(argument, argv[++index]);
                break;
            case "--max-iterations":
                options.maxIterations = requireNumber(argument, argv[++index]);
                break;
            case "--max-agents":
                options.maxAgents = requireNumber(argument, argv[++index]);
                break;
            case "--list-tools":
                options.listTools = true;
                break;
            case "--list-agents":
                options.listAgents = true;
                break;
            case "--list-policy":
                options.listPolicy = true;
                break;
            case "--doctor":
                options.doctor = true;
                break;
            case "--trust":
                options.trust = true;
                break;
            case "--untrust":
                options.untrust = true;
                break;
            case "--list-trusted":
                options.listTrusted = true;
                break;
            default:
                if (argument.startsWith("-")) fail(`unknown option ${argument}`);
                options.positional.push(argument);
        }
    }

    if (!options.doctor && options.positional[0] === "doctor") {
        options.doctor = true;
        options.positional.shift();
    }

    return options;
}


class ArgParser {
    constructor({ fail } = {}) {
        this.fail = fail || defaultFail;
    }

    parse(argv) {
        return parseArguments(argv, { fail: this.fail });
    }
}


module.exports = {
    ArgParser,
    UsageError,
    parseArguments
};
