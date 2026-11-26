"use strict";

/*
| The console's operator tools: the application log (and its live SSE
| feed), the system terminals and the workspace root the file manager and
| terminals start from. Reads `runtime` from `shared`; returns what the
| logs, terminal and files route groups use, plus their shutdown.
| `terminalOptions` (createServer's `terminal` option) reaches
| TerminalSessions, so tests can supply a pty module or shell.
*/

const path = require("path");

const { SseHub } = require("../SseHub");
const { logs } = require("../../../agent/runtime/LogStore");
const events = require("../../../agent/events");
const { WORKSPACE_ROOT } = require("../../../agent/context/WorkspaceBoundary");
const { TerminalSessions } = require("./terminal-sessions");


module.exports = function createOperatorTools(shared, terminalOptions = {}) {

    const { runtime } = shared;

    logs.attachToBus(events.bus);

    const workspaceRoot = () => {
        try {
            const context = typeof runtime.createRuntimeContext === "function" ? runtime.createRuntimeContext() : null;
            const root = context && context.runtime && context.runtime.workspace_root;
            return typeof root === "string" && root ? path.resolve(root) : WORKSPACE_ROOT;
        } catch {
            return WORKSPACE_ROOT;
        }
    };

    const logHub = new SseHub();
    const forwardEntry = entry => logHub.broadcast({ type: "entry", entry });
    const forwardCleared = () => logHub.broadcast({ type: "cleared", summary: logs.summary() });
    logs.on("entry", forwardEntry);
    logs.on("cleared", forwardCleared);

    const terminals = new TerminalSessions({
        ...terminalOptions,
        cwd: workspaceRoot(),
        maxSessions: () => Number(runtime.settings.get("CONSOLE_TERMINAL_MAX_SESSIONS")) || 4,
        scrollbackChars: () => Number(runtime.settings.get("CONSOLE_TERMINAL_SCROLLBACK_CHARS")) || 256 * 1024,
        onLog: (level, message, details) => logs.record(level, "terminal", message, details)
    });

    function closeOperatorTools() {
        logs.removeListener("entry", forwardEntry);
        logs.removeListener("cleared", forwardCleared);
        logHub.close();
        terminals.shutdown();
    }

    return {
        closeOperatorTools,
        logHub,
        logs,
        terminals,
        workspaceRoot
    };
};
