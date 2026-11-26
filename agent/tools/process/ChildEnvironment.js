"use strict";

/*
|--------------------------------------------------------------------------
| Child Environment (P0-5: secret isolation)
|--------------------------------------------------------------------------
|
| Every process the runtime starts on behalf of a model (stdio MCP
| servers, terminal_exec, process_start) used to inherit the runtime's
| whole environment, so any API key or token in it was one "env" command
| away from a transcript. A child now gets only the variables a shell and
| ordinary toolchains need to work, plus whatever its own configuration
| sets explicitly. A name that looks like a credential is never passed
| through, even if it is on the list.
|--------------------------------------------------------------------------
*/

/* Compared upper-cased: Windows keeps names like "Path" and "SystemRoot". */
const inheritedNames = new Set([
    "PATH", "PATHEXT", "HOME", "USER", "USERNAME", "LOGNAME", "SHELL",
    "TERM", "COLORTERM", "LANG", "LANGUAGE", "TZ",
    "TMPDIR", "TMP", "TEMP",
    "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
    "PUBLIC", "ALLUSERSPROFILE", "PSMODULEPATH",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
    "DISPLAY", "WAYLAND_DISPLAY", "EDITOR", "VISUAL", "PAGER",
    "NODE_PATH", "NVM_DIR", "NVM_BIN", "PNPM_HOME",
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_API_VERSION",
    "CONTAINER_HOST", "CONTAINER_SSHKEY", "CONTAINERS_CONF", "CONTAINERS_STORAGE_CONF",
    "JAVA_HOME", "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME",
    "PYTHONPATH", "VIRTUAL_ENV", "CONDA_PREFIX",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    "CI"
]);

const inheritedPrefixes = ["LC_"];

const credentialName =
    /(api[_-]?key|apikey|token|secret|passw(or)?d|credential|private[_-]?key|session[_-]?key|access[_-]?key|auth)/i;


function looksLikeCredential(name) {

    return credentialName.test(String(name));
}


/*
| CHILD_ENV_PASSTHROUGH names extra variables an operator wants children
| to see (roadmap P2-02), comma or space separated. Read on every call so
| a change applies to the next process; a credential-looking name stays
| blocked even when listed: a child that needs a secret gets it through
| its own explicit configuration.
*/

function extraNames() {

    let raw = "";

    try {
        raw = require("../../config").get("CHILD_ENV_PASSTHROUGH") || "";
    } catch {
        raw = "";
    }

    return new Set(
        String(raw)
            .split(/[\s,]+/)
            .map(name => name.trim().toUpperCase())
            .filter(Boolean)
    );
}


function isInherited(name, extra = extraNames()) {

    if (looksLikeCredential(name)) {
        return false;
    }

    const upper = String(name).toUpperCase();

    return (
        inheritedNames.has(upper) ||
        extra.has(upper) ||
        inheritedPrefixes.some(prefix => upper.startsWith(prefix))
    );
}


/*
| The environment for one child: the allowlisted part of `source`
| (the runtime's own environment by default) with `explicit` on top.
| Explicit values come from the server's or tool's own configuration,
| so they are passed as given.
*/

function build(explicit = {}, source = process.env) {

    const env = {};
    const extra = extraNames();

    for (const name of Object.keys(source || {})) {

        const value = source[name];

        if (value === undefined || value === null) {
            continue;
        }

        if (isInherited(name, extra)) {
            env[name] = String(value);
        }
    }

    if (explicit && typeof explicit === "object") {

        for (const [name, value] of Object.entries(explicit)) {

            if (value === undefined || value === null) {
                continue;
            }

            env[name] = String(value);
        }
    }

    return env;
}


module.exports = {
    inheritedNames,
    inheritedPrefixes,
    looksLikeCredential,
    isInherited,
    extraNames,
    build
};
