"use strict";

/* Classify well-known program invocations after shell tokenization. */

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



function createProgramRater({ RISK, rate, rateDeletion, rateGit, ratePackageManager, rateFind, ratePermission, operands, isRootLike, READ_VERBS, NETWORK_FETCH, LOW_PROGRAMS }) {
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



    return rateProgram;
}

module.exports = { createProgramRater, HIGH_PROGRAMS };
