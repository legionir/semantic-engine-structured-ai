"use strict";

/* Shell dialect detection, tokenization, command parsing, and path primitives. */

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

    const endCommand = (separator, trailingQuote = null) => {
        endWord();
        if (words.length) {
            const entry = { words, pipedFrom };
            if (trailingQuote) {
                entry.unclosedQuote = trailingQuote;
            }
            commands.push(entry);
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

    const unclosedQuote = quote || null;
    endCommand(";", unclosedQuote);

    const warnings = unclosedQuote
        ? [`unclosed ${unclosedQuote === "'" ? "single" : "double"} quote`]
        : [];

    Object.defineProperties(commands, {
        unclosedQuote: { value: unclosedQuote, enumerable: false },
        warnings: { value: warnings, enumerable: false }
    });

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


const POSIX_WRAPPERS = new Set(["sudo", "doas", "env", "nohup", "nice", "ionice", "time", "timeout", "command", "builtin", "exec"]);

function guessDialect(line) {

    const text = String(line || "").trim();
    const tokens = text.split(/\s+/).map(token => token.replace(/^["']|["']$/g, ""));

    let index = 0;
    while (index < tokens.length) {
        const current = tokens[index];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(current)) {
            index += 1;
            continue;
        }
        const candidateBase = commandName(current);
        if (POSIX_WRAPPERS.has(candidateBase)) {
            index += 1;
            continue;
        }
        break;
    }

    const first = tokens[index] || tokens[0] || "";
    const base = commandName(first);

    if (/^(powershell|pwsh)$/.test(base) || POWERSHELL_VERB.test(base)) {
        return "powershell";
    }

    if (base === "cmd" || (/\s\/[a-z](\s|$)/i.test(text) && CMD_BUILTINS.has(base))) {
        return "cmd";
    }

    if (base !== "find" && /(^|\s)-(recurse|force|path|literalpath|command|encodedcommand)\b/i.test(text) && !/(^|\s)--/.test(text)) {
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

module.exports = { splitCommands, guessDialect, commandName, isRootLike, isAbsolute };
