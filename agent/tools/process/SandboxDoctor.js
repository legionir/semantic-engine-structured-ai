"use strict";

/*
|--------------------------------------------------------------------------
| Process sandbox diagnostics (P1-2)
|--------------------------------------------------------------------------
|
| This is intentionally a bounded, read-only probe. It checks the selected
| backend and reports what the configured launch mode actually guarantees;
| it never pulls an image or starts a user command.
|--------------------------------------------------------------------------
*/

const { spawnSync } = require("child_process");
const settings = require("../../config");
const childEnvironment = require("./ChildEnvironment");


function probe(executable, args, runner = spawnSync) {

    let result;

    try {
        result = runner(executable, args, {
            encoding: "utf8",
            timeout: 3000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
            env: childEnvironment.build()
        });
    } catch {
        return { ok: false, reason: "probe-error" };
    }

    if (result && result.error) {
        return {
            ok: false,
            reason: result.error.code === "ETIMEDOUT" ? "timeout" :
                result.error.code === "ENOENT" ? "not-installed" : "probe-error"
        };
    }

    if (!result || result.status !== 0) {
        return {
            ok: false,
            reason: result && result.signal ? "interrupted" : "unavailable"
        };
    }

    return {
        ok: true,
        output: String(result.stdout || "").trim().replace(/\s+/g, " ").slice(0, 160)
    };
}


function readSandboxSettings(store) {

    return {
        mode: store.get("PROCESS_SANDBOX_MODE"),
        image: store.get("PROCESS_SANDBOX_IMAGE"),
        network: store.get("PROCESS_SANDBOX_NETWORK"),
        cpus: store.get("PROCESS_SANDBOX_CPUS"),
        memoryMb: store.get("PROCESS_SANDBOX_MEMORY_MB"),
        pidsLimit: store.get("PROCESS_SANDBOX_PIDS_LIMIT"),
        tmpMb: store.get("PROCESS_SANDBOX_TMP_MB")
    };
}


function diagnose({ settingsStore = settings, platform = process.platform, runner = spawnSync } = {}) {

    let configured;

    try {
        configured = readSandboxSettings(settingsStore);
    } catch {
        return {
            ok: false,
            mode: "invalid",
            status: "misconfigured",
            engine: "none",
            capabilities: [],
            warnings: ["Sandbox settings could not be resolved; process execution must remain disabled."]
        };
    }

    const report = {
        ok: true,
        ...configured,
        status: "ready",
        engine: "none",
        engineVersion: "",
        capabilities: [],
        warnings: []
    };

    if (configured.mode === "deny") {
        report.status = "disabled";
        report.capabilities.push("Process tools are denied by configuration.");
        return report;
    }

    if (configured.mode === "test") {
        report.ok = false;
        report.status = "unsafe-test-mode";
        report.capabilities.push("Host shell with a filtered environment; no OS isolation.");
        report.warnings.push("Test mode is not a production sandbox. Use deny, bwrap, Docker, or Podman.");
        return report;
    }

    if (configured.mode === "bwrap") {
        report.engine = "bwrap";

        if (platform !== "linux") {
            report.ok = false;
            report.status = "unsupported-platform";
            report.warnings.push("bubblewrap is supported only on Linux.");
            return report;
        }

        const result = probe("bwrap", ["--version"], runner);

        if (!result.ok) {
            report.ok = false;
            report.status = result.reason;
            report.warnings.push("bubblewrap is not available; no unsandboxed fallback will be used.");
            return report;
        }

        report.engineVersion = result.output;
        report.capabilities.push("PID, UTS, IPC, and network namespaces.");
        report.capabilities.push("Workspace is the only writable host bind; host system binds are read-only.");
        report.warnings.push("Binary presence is checked; kernel namespace availability and resource quotas are not verified.");
        return report;
    }

    if (configured.mode !== "docker" && configured.mode !== "podman") {
        report.ok = false;
        report.status = "unsupported-mode";
        report.warnings.push("Unknown process sandbox mode; process execution must remain disabled.");
        return report;
    }

    report.engine = configured.mode;

    const args = configured.mode === "docker"
        ? ["info", "--format", "{{.ServerVersion}}"]
        : ["info", "--format", "json"];
    const result = probe(configured.mode, args, runner);

    if (!result.ok) {
        report.ok = false;
        report.status = result.reason;
        report.warnings.push(`${configured.mode} CLI or engine is unavailable; no unsandboxed fallback will be used.`);
        return report;
    }

    report.engineVersion = result.output;
    report.capabilities.push("Read-only container root filesystem; writable workspace bind only.");
    report.capabilities.push("Capabilities dropped and no-new-privileges enabled.");
    report.capabilities.push(`${configured.cpus} CPU, ${configured.memoryMb} MiB memory, ${configured.pidsLimit} processes, ${configured.tmpMb} MiB /tmp limits.`);
    report.capabilities.push(`Network mode: ${configured.network}.`);

    if (configured.network === "bridge") {
        report.warnings.push("Bridge mode permits general egress; it is not a destination allowlist.");
    }

    return report;
}


function formatReport(report) {

    const lines = [
        "Structured AI sandbox diagnostics",
        `Mode: ${report.mode}`,
        `Status: ${report.status}`,
        `Engine: ${report.engine}${report.engineVersion ? ` (${report.engineVersion})` : ""}`
    ];

    if (report.image && (report.mode === "docker" || report.mode === "podman")) {
        lines.push(`Image: ${report.image}`);
    }

    for (const capability of report.capabilities || []) {
        lines.push(`Capability: ${capability}`);
    }

    for (const warning of report.warnings || []) {
        lines.push(`Warning: ${warning}`);
    }

    return `${lines.join("\n")}\n`;
}


module.exports = {
    probe,
    diagnose,
    formatReport
};
