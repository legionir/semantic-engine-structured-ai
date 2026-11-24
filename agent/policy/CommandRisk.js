"use strict";

/*
|--------------------------------------------------------------------------
| Command risk classification (roadmap P1-4)
|--------------------------------------------------------------------------
|
| The policy's shell rules are regular expressions over the raw command
| line, so they see `echo "rm -rf /"` as a deletion and miss
| `Remove-Item -Recurse -Force C:\`. This module parses the line the way a
| shell would - quotes, escapes, separators (; && || | &), wrappers such as
| sudo, env, `bash -c`, `powershell -Command` and `cmd /c` - and rates
| every command it would run:
|
|   high     irrecoverable or system-wide: recursive/forced deletion of a
|            root, drive, home or parent folder, disk and partition tools,
|            shutdown, piping a download into a shell, history rewriting
|   medium   changes something or reaches the network: writes, installs,
|            moves, process control, unknown programs
|   low      reads only: listings, file views, searches, status queries
|
| The line's risk is the highest risk of its commands. It is a label for
| the policy (PolicyMatcher escalates a high-risk command to approval
| even when a rule would allow it) and for the operator; it never makes
| anything more permissive. Three dialects are understood: posix (sh,
| bash, zsh), powershell and cmd. The dialect is guessed per command
| unless the caller names it.
|--------------------------------------------------------------------------
*/

const {
    splitCommands,
    guessDialect,
    commandName,
    isRootLike,
    isAbsolute
} = require("./ShellCommandLexer");
const { createCommandMutations } = require("./CommandMutations");
const { createProgramRater, HIGH_PROGRAMS } = require("./ProgramRisk");

const RISK = Object.freeze({ LOW: "low", MEDIUM: "medium", HIGH: "high" });

const ORDER = { low: 0, medium: 1, high: 2 };


function maxRisk(a, b) {

    return ORDER[b] > ORDER[a] ? b : a;
}


/* --------------------------------------------------------------- lexer */

/*
| Splits a command line into commands and each command into words. A
| separator inside quotes is text. `|` is kept as a pipe marker so a
| download piped into a shell can be recognised.
*/
const LOW_PROGRAMS = new Set([
    "ls", "ll", "dir", "pwd", "cat", "type", "head", "tail", "less", "more", "wc", "echo",
    "printf", "grep", "egrep", "fgrep", "rg", "ag", "ack", "which", "where", "whereis",
    "whoami", "id", "uname", "hostname", "date", "env", "printenv", "stat", "file", "du",
    "df", "tree", "sort", "uniq", "cut", "diff", "cmp", "basename", "dirname", "realpath",
    "readlink", "true", "false", "test", "[", "cd", "pushd", "popd", "jq", "yq", "md5sum",
    "sha1sum", "sha256sum", "shasum", "column", "nl", "tac", "rev", "ps", "top", "uptime",
    "free", "lscpu", "lsblk", "nproc", "history", "tasklist", "ver", "vol", "findstr",
    "sleep", "seq", "time", "cls", "clear", "man", "help", "type", "awk", "tr", "fold",
    "strings", "hexdump", "xxd", "od", "locale", "groups", "tty", "w", "who", "last"
]);

const READ_VERBS = /^(get|select|test|measure|resolve|split|join|sort|where|foreach|convertto|convertfrom|out-string|write-output|write-host|format-list|format-table|format-wide|set-location|push-location|pop-location)(-|$)/i;

const PS_ALIASES = {
    ri: "remove-item", rm: "remove-item", rmdir: "remove-item", del: "remove-item",
    erase: "remove-item", rd: "remove-item", gci: "get-childitem", ls: "get-childitem",
    dir: "get-childitem", cat: "get-content", gc: "get-content", type: "get-content",
    iex: "invoke-expression", iwr: "invoke-webrequest", irm: "invoke-restmethod",
    curl: "invoke-webrequest", wget: "invoke-webrequest", mv: "move-item", mi: "move-item",
    move: "move-item", cp: "copy-item", copy: "copy-item", ci: "copy-item", sc: "set-content",
    ni: "new-item", saps: "start-process", start: "start-process", kill: "stop-process",
    spps: "stop-process", echo: "write-output", pwd: "get-location", cd: "set-location",
    sl: "set-location", gl: "get-location", select: "select-object", sls: "select-string",
    where: "where-object", "?": "where-object", "%": "foreach-object", foreach: "foreach-object"
};

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "ash", "busybox"]);

const NETWORK_FETCH = new Set(["curl", "wget", "fetch", "invoke-webrequest", "invoke-restmethod", "iwr", "irm"]);

const SHELL_SINKS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "python", "python3", "perl", "ruby", "node", "powershell", "pwsh", "iex", "invoke-expression", "cmd"]);


function rate(risk, reason) {

    return { risk, reason };
}


function flagSet(args, dialect) {

    const flags = new Set();

    for (const arg of args) {

        if (dialect === "posix" && /^-[a-zA-Z]+$/.test(arg)) {
            for (const letter of arg.slice(1)) {
                flags.add(`-${letter}`);
            }
        } else if (/^--?[a-zA-Z][\w-]*(=.*)?$/.test(arg)) {
            flags.add(arg.toLowerCase().replace(/=.*$/, ""));
        } else if (dialect !== "posix" && /^\/[a-zA-Z?]+$/.test(arg)) {
            flags.add(arg.toLowerCase());
        }
    }

    return flags;
}


/* Arguments that are not flags. A cmd switch looks like /s, which on a
   POSIX shell is an absolute path, so only non-POSIX dialects drop it. */
function operands(args, dialect) {

    return args.filter(arg =>
        !/^-/.test(arg) &&
        !(dialect !== "posix" && /^\/[a-zA-Z?]{1,3}$/.test(arg))
    );
}


function hasFlag(flags, ...names) {

    return names.some(name => flags.has(name) || flags.has(name.toLowerCase()));
}


/* PowerShell parameters may be abbreviated: -Rec, -Fo */
function psFlag(args, full, minimum) {

    const lower = full.toLowerCase();

    return args.some(arg => {
        const name = String(arg).toLowerCase().replace(/:.*$/, "");
        return name.startsWith("-") &&
            name.length - 1 >= minimum &&
            lower.startsWith(name.slice(1));
    });
}


const commandMutations = createCommandMutations({
    RISK,
    rate,
    flagSet,
    operands,
    hasFlag,
    psFlag,
    isRootLike,
    isAbsolute
});

const {
    rateDeletion,
    rateGit,
    ratePackageManager,
    rateFind,
    ratePermission
} = commandMutations;

const rateProgram = createProgramRater({
    RISK,
    rate,
    ...commandMutations,
    operands,
    isRootLike,
    READ_VERBS,
    NETWORK_FETCH,
    LOW_PROGRAMS
});


function rateOne(words, dialect, pipedFrom, depth) {

    let args = words.slice();

    /* leading VAR=value assignments */
    while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]) && dialect === "posix") {
        args.shift();
    }

    if (!args.length) {
        return rate(RISK.LOW, "assignment only");
    }

    let name = commandName(args[0]);
    let elevated = false;

    /* wrappers that run the rest of the line */
    for (let guard = 0; guard < 6; guard += 1) {

        if (["sudo", "doas", "su", "runas", "gsudo"].includes(name)) {
            elevated = true;
            args = args.slice(1);
            if (name === "su") {
                const index = args.indexOf("-c");
                if (index >= 0) {
                    return rateLine(args[index + 1] || "", "posix", depth + 1, true);
                }
            }
            while (args.length && /^-/.test(args[0])) {
                const flag = args.shift();
                if (/^-(u|g|C|p|h)$/.test(flag)) {
                    args.shift();
                }
            }
        } else if (["env", "nohup", "nice", "ionice", "time", "timeout", "stdbuf", "xargs", "exec", "command", "builtin", "caffeinate", "chrt", "taskset"].includes(name) && dialect === "posix") {
            args = args.slice(1);
            while (args.length && (/^-/.test(args[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]) || (name === "timeout" && /^\d+[smhd]?$/.test(args[0])))) {
                args.shift();
            }
        } else {
            break;
        }

        if (!args.length) {
            return rate(elevated ? RISK.MEDIUM : RISK.LOW, "wrapper without a command");
        }

        name = commandName(args[0]);
    }

    const rest = args.slice(1);

    const lift = verdict =>
        elevated && verdict.risk === RISK.LOW
            ? rate(RISK.MEDIUM, `${verdict.reason}, as another user`)
            : elevated && verdict.risk === RISK.MEDIUM
                ? rate(RISK.HIGH, `${verdict.reason}, with elevated rights`)
                : verdict;

    /* a nested shell: classify what it runs */
    if (SHELLS.has(name)) {

        const index = rest.findIndex(arg => /^-[a-zA-Z]*c$/.test(arg));

        if (index >= 0) {
            return lift(rateLine(rest[index + 1] || "", "posix", depth + 1));
        }

        if (pipedFrom && NETWORK_FETCH.has(commandName(pipedFrom[0]))) {
            return rate(RISK.HIGH, "pipes a download into a shell");
        }

        return lift(rate(RISK.MEDIUM, `runs a ${name} script`));
    }

    if (name === "powershell" || name === "pwsh") {

        const index = rest.findIndex(arg => /^[-/](c|command|enc|encodedcommand|e|ec)$/i.test(arg));

        if (index >= 0 && /^[-/](enc|encodedcommand|e|ec)$/i.test(rest[index])) {
            return rate(RISK.HIGH, "runs an encoded PowerShell command that cannot be reviewed");
        }

        const inline =
            index >= 0
                ? rest.slice(index + 1).join(" ")
                : rest.filter(arg => !/^[-/]/.test(arg)).join(" ");

        if (pipedFrom && NETWORK_FETCH.has(commandName(pipedFrom[0]))) {
            return rate(RISK.HIGH, "pipes a download into PowerShell");
        }

        return inline
            ? lift(rateLine(inline, "powershell", depth + 1))
            : rate(RISK.MEDIUM, "starts PowerShell");
    }

    if (name === "cmd") {

        const index = rest.findIndex(arg => /^\/[ck]$/i.test(arg));

        return index >= 0
            ? lift(rateLine(rest.slice(index + 1).join(" "), "cmd", depth + 1))
            : rate(RISK.MEDIUM, "starts cmd");
    }

    if (dialect === "powershell") {
        name = PS_ALIASES[name] || name;
    }

    if (pipedFrom && SHELL_SINKS.has(name) && NETWORK_FETCH.has(PS_ALIASES[commandName(pipedFrom[0])] || commandName(pipedFrom[0]))) {
        return rate(RISK.HIGH, "pipes a download into an interpreter");
    }

    return lift(rateProgram(name, rest, dialect, words));
}


/* The bodies of $(...) and `...` outside single quotes. */
function substitutions(text) {

    const unquoted = String(text).replace(/'[^']*'/g, "''");
    const found = [];

    const pattern = /\$\(([^()]*)\)|`([^`]*)`/g;
    let match;

    while ((match = pattern.exec(unquoted)) !== null) {

        const body = match[1] !== undefined ? match[1] : match[2];

        if (body && body.trim()) {
            found.push(body);
        }
    }

    return found;
}


/*
| :(){ :|:& };:  - the fork bomb has no program name to match.
*/
function looksLikeForkBomb(line) {

    return /([A-Za-z_:][\w:]*)\s*\(\s*\)\s*\{[^}]*\1\s*\|\s*\1\s*&[^}]*\}\s*;?\s*\1/.test(String(line));
}


function rateLine(line, dialect, depth = 0, elevated = false) {

    const text = String(line || "");

    if (depth > 4) {
        return rate(RISK.HIGH, "nested shells too deep to review");
    }

    if (looksLikeForkBomb(text)) {
        return rate(RISK.HIGH, "fork bomb");
    }

    const commands = splitCommands(text, dialect || guessDialect(text));

    let verdict = rate(RISK.LOW, "nothing to run");
    const reasons = [];

    /* $(...) and `...` run even inside double quotes */
    if ((dialect || guessDialect(text)) === "posix") {

        for (const inner of substitutions(text)) {

            const nested = rateLine(inner, "posix", depth + 1, elevated);

            reasons.push(nested);

            if (ORDER[nested.risk] > ORDER[verdict.risk] || verdict.reason === "nothing to run") {
                verdict = nested;
            }
        }
    }

    for (const command of commands) {

        const own =
            dialect
                ? dialect
                : guessDialect(command.words.join(" "));

        let one = rateOne(command.words, own, command.pipedFrom, depth);

        if (elevated && one.risk !== RISK.HIGH) {
            one = rate(one.risk === RISK.LOW ? RISK.MEDIUM : RISK.HIGH, `${one.reason}, with elevated rights`);
        }

        reasons.push(one);

        if (ORDER[one.risk] > ORDER[verdict.risk] || verdict.reason === "nothing to run") {
            verdict = one;
        }
    }

    return { risk: verdict.risk, reason: verdict.reason, commands: reasons };
}


/*
| classify("rm -rf /") -> { risk: "high", reason, commands: [...], dialect }
| options.dialect: "posix" | "powershell" | "cmd" (guessed when absent)
*/
function classify(line, options = {}) {

    const dialect =
        ["posix", "powershell", "cmd"].includes(options.dialect)
            ? options.dialect
            : guessDialect(line);

    const verdict = rateLine(line, dialect);

    return { ...verdict, dialect };
}


module.exports = {
    RISK,
    classify,
    splitCommands,
    guessDialect,
    commandName,
    isRootLike,
    maxRisk
};
