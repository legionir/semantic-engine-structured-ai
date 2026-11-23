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
function splitCommands(line, dialect) {

    const commands = [];
    let words = [];
    let word = "";
    let inWord = false;
    let quote = null;
    let pipedFrom = null;

    const text = String(line || "");

    const endWord = () => {
        if (inWord) {
            words.push(word);
        }
        word = "";
        inWord = false;
    };

    const endCommand = separator => {
        endWord();
        if (words.length) {
            commands.push({ words, pipedFrom });
        }
        pipedFrom = separator === "|" && words.length ? words : null;
        words = [];
    };

    for (let index = 0; index < text.length; index += 1) {

        const ch = text[index];
        const next = text[index + 1];

        if (quote) {

            if (ch === quote) {
                quote = null;
                continue;
            }

            if (quote === "\"" && dialect === "posix" && ch === "\\" && next !== undefined && "\"\\$`".includes(next)) {
                word += next;
                index += 1;
                continue;
            }

            if (quote === "\"" && dialect === "powershell" && ch === "`" && next !== undefined) {
                word += next;
                index += 1;
                continue;
            }

            word += ch;
            continue;
        }

        if (ch === "'" && dialect !== "cmd") {
            quote = ch;
            inWord = true;
            continue;
        }

        if (ch === "\"") {
            quote = ch;
            inWord = true;
            continue;
        }

        if (dialect === "posix" && ch === "\\" && next !== undefined) {
            word += next;
            inWord = true;
            index += 1;
            continue;
        }

        if (dialect === "powershell" && ch === "`" && next !== undefined) {
            word += next;
            inWord = true;
            index += 1;
            continue;
        }

        if (ch === "\n" || ch === "\r" || ch === ";") {
            endCommand(";");
            continue;
        }

        if (ch === "&" || ch === "|") {

            if (next === ch) {
                endCommand(ch + ch);
                index += 1;
                continue;
            }

            if (ch === "&" && (text[index - 1] === ">" || next === ">")) {
                /* 2>&1, &> : a redirection, not a separator */
                word += ch;
                inWord = true;
                continue;
            }

            endCommand(ch);
            continue;
        }

        if (ch === " " || ch === "\t") {
            endWord();
            continue;
        }

        if (dialect === "posix" && ch === "(" && !inWord) {
            /* subshell or function body: read what is inside as commands */
            endCommand(";");
            continue;
        }

        if (dialect === "posix" && !inWord && (
            ch === ")" ||
            ch === "}" ||
            ch === "{" && (next === undefined || next === " " || next === "\t" || next === "\n")
        )) {
            /* `( cmd )` and `{ cmd; }` groups: what is inside still runs */
            endCommand(";");
            continue;
        }

        word += ch;
        inWord = true;
    }

    endCommand(";");

    return commands;
}


/* ------------------------------------------------------------- dialect */

const POWERSHELL_VERB = /^(get|set|new|remove|move|copy|rename|clear|invoke|start|stop|restart|format|test|select|write|out|add|import|export|convertto|convertfrom|resolve|split|join|measure|sort|where|foreach|enable|disable|install|uninstall|update|register|unregister|mount|dismount|initialize)-[a-z]+$/i;

const CMD_BUILTINS = new Set([
    "del", "erase", "rd", "rmdir", "dir", "copy", "xcopy", "robocopy", "move", "ren",
    "rename", "type", "cls", "md", "mkdir", "format", "diskpart", "attrib", "icacls",
    "takeown", "reg", "sc", "taskkill", "tasklist", "shutdown", "where", "findstr", "set",
    "cipher", "bcdedit", "vssadmin", "wmic", "schtasks", "net", "ver", "vol", "echo",
    "cd", "chdir", "start", "assoc", "ftype"
]);


function guessDialect(line) {

    const text = String(line || "").trim();
    const first = (text.split(/\s+/)[0] || "").replace(/^["']|["']$/g, "");
    const base = commandName(first);

    if (/^(powershell|pwsh)$/.test(base) || POWERSHELL_VERB.test(base)) {
        return "powershell";
    }

    if (base === "cmd" || /\s\/[a-z](\s|$)/i.test(text) && CMD_BUILTINS.has(base)) {
        return "cmd";
    }

    if (/(^|\s)-(recurse|force|path|literalpath|command|encodedcommand)\b/i.test(text) && !/(^|\s)--/.test(text)) {
        return "powershell";
    }

    return "posix";
}


/* argv[0] as a bare, lower-case program name: /usr/bin/rm -> rm,
   C:\Windows\System32\cmd.exe -> cmd */
function commandName(word) {

    const last = String(word || "").split(/[\\/]/).pop() || "";

    return last.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}


/* ------------------------------------------------------------- targets */

function isRootLike(target) {

    const value = String(target || "").trim().replace(/^["']|["']$/g, "");

    if (!value) {
        return false;
    }

    return (
        /^\/+\*?$/.test(value) ||                         /* /  //  /* */
        /^\/(\*|\.\*|[a-z]+\/?\*?)$/i.test(value) &&
            /^\/(bin|boot|dev|etc|home|lib|lib64|opt|proc|root|sbin|srv|sys|usr|var|users|system|library|applications|private|\*|\.\*)\/?\*?$/i.test(value) ||
        /^~(\/\*?)?$/.test(value) ||                      /* ~  ~/  ~/* */
        /^\$\{?home\}?(\/\*?)?$/i.test(value) ||           /* $HOME */
        /^\$env:(userprofile|homedrive|systemroot|windir|programfiles)\b/i.test(value) ||
        /^%(userprofile|systemroot|windir|homedrive|programfiles)%/i.test(value) ||
        /^[a-z]:[\\/]?\*?(\.\*)?$/i.test(value) ||         /* C:  C:\  C:\*  C:/ */
        /^[a-z]:[\\/](windows|users|program files[^\\/]*|programdata)[\\/]?\*?$/i.test(value) ||
        /^\\\\[^\\]+\\[^\\]+[\\]?$/.test(value) ||          /* \\server\share */
        /^\.\.([\\/]\.\.)*[\\/]?\*?$/.test(value) ||        /* ..  ../..  ..\* */
        /^\*$/.test(value) ||
        /^\.[\\/]?\*?$/.test(value)                        /* .  ./  ./* : the whole workspace */
    );
}


function isAbsolute(target) {

    const value = String(target || "");

    return /^(\/|~|[a-z]:[\\/]|\\\\|\$home|\$env:|%)/i.test(value);
}


/* ------------------------------------------------------------- rating */

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


function rateDeletion(name, args, dialect) {

    const flags = flagSet(args, dialect);
    const targets = operands(args, dialect);

    const recursive =
        hasFlag(flags, "-r", "-R", "--recursive", "/s") ||
        psFlag(args, "recurse", 3);

    const forced =
        hasFlag(flags, "-f", "--force", "/q", "/f") ||
        psFlag(args, "force", 2);

    if (hasFlag(flags, "--no-preserve-root")) {
        return rate(RISK.HIGH, "deletion with --no-preserve-root");
    }

    if (targets.some(isRootLike)) {
        return rate(RISK.HIGH, `deletes a root, drive, home or parent folder (${targets.find(isRootLike)})`);
    }

    if ((recursive || forced) && targets.some(isAbsolute)) {
        return rate(RISK.HIGH, "recursive or forced deletion of an absolute path");
    }

    if (recursive && forced && targets.some(target => /[*?]/.test(target))) {
        return rate(RISK.HIGH, "recursive forced deletion of a wildcard");
    }

    return rate(RISK.MEDIUM, "deletes files");
}


function rateGit(args) {

    const sub = (args.find(arg => !arg.startsWith("-")) || "").toLowerCase();
    const rest = args.slice(args.indexOf(sub) + 1).map(arg => arg.toLowerCase());

    if (sub === "push" && rest.some(arg => /^(-f|--force|--force-with-lease|--mirror|--delete|-d)$/.test(arg) || /^\+/.test(arg) || /^:/.test(arg))) {
        return rate(RISK.HIGH, "force push or remote deletion rewrites published history");
    }

    if (sub === "reset" && rest.includes("--hard")) {
        return rate(RISK.HIGH, "git reset --hard discards work");
    }

    if (sub === "clean" && rest.some(arg => /^-[a-z]*f/.test(arg))) {
        return rate(RISK.HIGH, "git clean -f deletes untracked files");
    }

    if (sub === "filter-branch" || sub === "filter-repo") {
        return rate(RISK.HIGH, "rewrites history");
    }

    if (sub === "checkout" && rest.includes("--") && rest.includes(".")) {
        return rate(RISK.HIGH, "git checkout -- . discards work");
    }

    if (["status", "log", "diff", "show", "branch", "remote", "rev-parse", "describe", "blame", "ls-files", "ls-tree", "tag", "config", "grep", "shortlog", "reflog", "help", "version", "--version"].includes(sub)) {

        if (sub === "config" && !rest.some(arg => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(arg))) {
            return rate(RISK.MEDIUM, "changes git configuration");
        }

        if ((sub === "tag" || sub === "branch" || sub === "remote") && rest.some(arg => !arg.startsWith("-") || /^-(d|D|m|M|f)$/.test(arg))) {
            return rate(RISK.MEDIUM, `git ${sub} changes refs`);
        }

        return rate(RISK.LOW, `git ${sub} reads the repository`);
    }

    return rate(RISK.MEDIUM, `git ${sub || ""} changes the repository or talks to a remote`.replace(/\s+/g, " "));
}


function ratePackageManager(name, args) {

    const sub = (args.find(arg => !arg.startsWith("-")) || "").toLowerCase();

    if (["test", "t", "ls", "list", "outdated", "view", "info", "why", "audit", "--version", "-v", "help", "config"].includes(sub) || args.includes("--version") || args.includes("-v")) {
        return rate(RISK.LOW, `${name} ${sub} reads only`);
    }

    if (name === "npm" && sub === "run") {
        const script = args[args.indexOf(sub) + 1] || "";
        return /^(test|lint|build|check|typecheck|format:check)$/.test(script)
            ? rate(RISK.LOW, `npm run ${script}`)
            : rate(RISK.MEDIUM, `npm run ${script} runs a project script`);
    }

    return rate(RISK.MEDIUM, `${name} ${sub} changes installed packages or runs code`);
}


function rateFind(args) {

    if (args.some(arg => /^-(delete|exec|execdir|ok|okdir|fprint|fls)$/.test(arg))) {

        const root = args.find(arg => !arg.startsWith("-"));

        const wholeWorkspace = /^\.[\\/]?$/.test(String(root || "."));

        return isAbsolute(root) || (isRootLike(root) && !wholeWorkspace)
            ? rate(RISK.HIGH, "find -delete/-exec over a root or absolute path")
            : rate(RISK.MEDIUM, "find runs a command or deletes");
    }

    return rate(RISK.LOW, "find lists files");
}


function ratePermission(name, args, dialect) {

    const flags = flagSet(args, dialect);
    const targets = operands(args, dialect).slice(name === "chmod" || name === "chown" || name === "chgrp" ? 1 : 0);

    if ((hasFlag(flags, "-r", "-R", "--recursive", "/t", "/r") || /icacls|takeown/.test(name)) && targets.some(target => isRootLike(target) || isAbsolute(target))) {
        return rate(RISK.HIGH, `${name} changes permissions of a system or root path`);
    }

    return rate(RISK.MEDIUM, `${name} changes permissions`);
}


const HIGH_PROGRAMS = {
    mkfs: "formats a file system",
    fdisk: "edits partitions",
    sfdisk: "edits partitions",
    gdisk: "edits partitions",
    parted: "edits partitions",
    wipefs: "wipes file system signatures",
    shred: "destroys file contents",
    shutdown: "shuts the machine down",
    reboot: "reboots the machine",
    halt: "halts the machine",
    poweroff: "powers the machine off",
    diskpart: "edits disks and partitions",
    bcdedit: "edits the boot configuration",
    vssadmin: "manages shadow copies (backups)",
    cipher: "can wipe free space",
    "format-volume": "formats a volume",
    "clear-disk": "erases a disk",
    "remove-partition": "deletes a partition",
    "initialize-disk": "initialises a disk",
    "stop-computer": "shuts the machine down",
    "restart-computer": "reboots the machine",
    "set-executionpolicy": "weakens the script execution policy",
    "invoke-expression": "runs a string as code",
    iex: "runs a string as code",
    "remove-itemproperty": "deletes registry values",
    "clear-recyclebin": "empties the recycle bin",
    "disable-computerrestore": "disables system restore"
};


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


function rateProgram(name, rest, dialect, words) {

    if (/^mkfs(\.|$)/.test(name)) {
        return rate(RISK.HIGH, HIGH_PROGRAMS.mkfs);
    }

    if (HIGH_PROGRAMS[name]) {
        return rate(RISK.HIGH, HIGH_PROGRAMS[name]);
    }

    if (name === "init" && /^[06]$/.test(rest[0] || "")) {
        return rate(RISK.HIGH, "changes the run level (halt/reboot)");
    }

    if (name === "systemctl" && /^(poweroff|reboot|halt|kexec|rescue|emergency)$/.test(rest[0] || "")) {
        return rate(RISK.HIGH, `systemctl ${rest[0]}`);
    }

    if (name === "dd") {
        return rest.some(arg => /^of=\/dev\//.test(arg) || /^of=[a-z]:/i.test(arg) || /^of=\\\\\.\\/.test(arg))
            ? rate(RISK.HIGH, "dd writes to a device")
            : rate(RISK.MEDIUM, "dd copies raw data");
    }

    if (name === "format" && (dialect !== "posix" || /^[a-z]:$/i.test(rest[0] || ""))) {
        return rate(RISK.HIGH, "formats a drive");
    }

    if (["rm", "unlink", "rmdir", "remove-item", "del", "erase", "rd", "trash", "srm"].includes(name)) {
        return rateDeletion(name, rest, dialect === "posix" && /^(del|erase|rd)$/.test(name) ? "cmd" : dialect);
    }

    if (name === "git") {
        return rateGit(rest);
    }

    if (["npm", "pnpm", "yarn", "bun", "pip", "pip3", "pipx", "poetry", "cargo", "gem", "go", "composer", "dotnet", "mvn", "gradle", "brew", "apt", "apt-get", "dnf", "yum", "pacman", "apk", "choco", "winget", "scoop", "conda", "uv"].includes(name)) {

        if (["apt", "apt-get", "dnf", "yum", "pacman", "apk"].includes(name) && /^(remove|purge|autoremove|erase|-R)/.test(rest[0] || "")) {
            return rate(RISK.MEDIUM, `${name} removes system packages`);
        }

        return ratePackageManager(name, rest);
    }

    if (name === "find") {
        return rateFind(rest);
    }

    if (["chmod", "chown", "chgrp", "icacls", "takeown", "attrib", "setfacl"].includes(name)) {
        return ratePermission(name, rest, dialect);
    }

    if (name === "reg") {
        const sub = (rest[0] || "").toLowerCase();
        return sub === "delete"
            ? rate(RISK.HIGH, "deletes registry keys")
            : sub === "query" || sub === "export"
                ? rate(RISK.LOW, "reads the registry")
                : rate(RISK.MEDIUM, "changes the registry");
    }

    if (name === "crontab" && rest.includes("-r")) {
        return rate(RISK.HIGH, "removes every cron job");
    }

    if (["kill", "pkill", "killall", "taskkill", "stop-process"].includes(name)) {
        return rest.some(arg => arg === "-1" || arg === "1" || /^\/im$/i.test(arg) && /^(csrss|wininit|winlogon|lsass|smss|system)(\.exe)?$/i.test(rest[rest.indexOf(arg) + 1] || ""))
            ? rate(RISK.HIGH, "kills every process or a system process")
            : rate(RISK.MEDIUM, "stops processes");
    }

    if (name === "mv" || name === "move-item" || name === "move") {
        const targets = operands(rest, dialect);
        return targets.some(isRootLike)
            ? rate(RISK.HIGH, "moves a root, drive, home or parent folder")
            : rate(RISK.MEDIUM, "moves files");
    }

    if (name === "sed" || name === "perl") {
        return rest.some(arg => /^-[a-zA-Z]*i/.test(arg) || /^--in-place/.test(arg))
            ? rate(RISK.MEDIUM, `${name} edits files in place`)
            : name === "sed" ? rate(RISK.LOW, "sed filters text") : rate(RISK.MEDIUM, "runs a perl program");
    }

    if (dialect === "powershell" && READ_VERBS.test(name)) {
        return rate(RISK.LOW, `${name} reads only`);
    }

    if (["node", "python", "python3", "py", "deno", "ruby", "php", "java", "lua"].includes(name)) {
        return rest.length === 1 && /^(--version|-v|-V|--help|-h)$/.test(rest[0])
            ? rate(RISK.LOW, `${name} ${rest[0]}`)
            : rate(RISK.MEDIUM, `${name} runs a program`);
    }

    if (NETWORK_FETCH.has(name)) {
        return rest.some(arg => /^(-o|-O|--output|-OutFile|--remote-name)$/i.test(arg))
            ? rate(RISK.MEDIUM, `${name} downloads a file`)
            : rate(RISK.MEDIUM, `${name} reaches the network`);
    }

    if (LOW_PROGRAMS.has(name)) {

        if (words.some(word => /^\d?>>?$/.test(word) || /^\d?>>?[^&]/.test(word))) {

            const target = words[words.findIndex(word => /^\d?>>?/.test(word)) + 1] || "";
            const inline = (words.find(word => /^\d?>>?[^&]/.test(word)) || "").replace(/^\d?>>?/, "");

            return /^\/dev\/(sd|nvme|hd|disk|mem|kmem)/.test(target || inline)
                ? rate(RISK.HIGH, "writes over a device")
                : /^\/dev\/null$/.test(target || inline) || /^(nul|\$null)$/i.test(target || inline)
                    ? rate(RISK.LOW, `${name} with output discarded`)
                    : rate(RISK.MEDIUM, `${name} writes a file through a redirection`);
        }

        return rate(RISK.LOW, `${name} reads only`);
    }

    return rate(RISK.MEDIUM, `${name} is not known to be read-only`);
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
