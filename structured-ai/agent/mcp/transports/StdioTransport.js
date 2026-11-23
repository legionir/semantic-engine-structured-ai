const { spawn } = require("child_process");
const path = require("path");

const protocol = require("../protocol");
const childEnvironment = require("../../tools/process/ChildEnvironment");


/*
|--------------------------------------------------------------------------
| stdio Transport
|--------------------------------------------------------------------------
|
| The server is a child process of this runtime and the pipe is the
| session: messages go down stdin, answers come back on stdout, and
| anything the server writes to stderr is kept as a diagnostic rather
| than printed, because a sidecar that logs is not a sidecar that failed.
|
| The process is started on the first call and reused. When it dies,
| every call still waiting is rejected with the reason, so a crashed
| server surfaces as a failed tool call instead of a run that hangs.
|--------------------------------------------------------------------------
*/

class StdioTransport {

    static get kind() {

        return "stdio";
    }


    constructor(config = {}) {

        this.config = config;

        this.name = config.name || "stdio";

        this.child = null;

        this.startPromise = null;

        this.pending = new Map();

        this.notificationHandler = () => {};

        this.diagnosticHandler = () => {};

        this.closeHandler = () => {};

        this.framing =
            config.framing || protocol.FRAMING.AUTO;

        this.decoder =
            new protocol.MessageDecoder(
                message => this.receive(message),
                text => this.diagnose(text)
            );

        /*
        | A server that answers with Content-Length must be answered the
        | same way. Until one message has arrived the framing is a guess,
        | and Content-Length is the safe guess because a server that
        | wants lines tolerates headers far less often than the reverse.
        */

        this.observedFraming = null;
    }


    onNotification(handler) {

        this.notificationHandler = handler || (() => {});
    }


    onDiagnostic(handler) {

        this.diagnosticHandler = handler || (() => {});
    }


    onClose(handler) {

        this.closeHandler = handler || (() => {});
    }


    diagnose(text) {

        this.diagnosticHandler(String(text));
    }


    isConnected() {

        return Boolean(
            this.child &&
            !this.child.killed &&
            this.child.exitCode === null
        );
    }


    describe() {

        return {
            kind: StdioTransport.kind,

            command:
                this.config.command,

            args:
                this.config.args || [],

            connected:
                this.isConnected(),

            pid:
                this.child ? this.child.pid : null
        };
    }


    /*
    | A ".js" entry point is run with the same Node binary the runtime
    | uses, so a server does not have to be executable or on PATH.
    */

    resolveCommand() {

        const command =
            this.config.command;

        if (!command) {

            throw new Error(
                `MCP server "${this.name}" has no command to start.`
            );
        }

        const args =
            Array.isArray(this.config.args)
                ? [...this.config.args]
                : [];

        if (
            typeof command === "string" &&
            command.toLowerCase().endsWith(".js")
        ) {

            return {
                command: process.execPath,
                args: [command, ...args]
            };
        }

        return { command, args };
    }


    async connect() {

        if (this.isConnected()) {
            return this;
        }

        if (this.startPromise) {
            return this.startPromise;
        }

        this.startPromise =
            new Promise((resolve, reject) => {

                const { command, args } =
                    this.resolveCommand();

                const child =
                    spawn(command, args, {

                        cwd:
                            this.config.cwd ||
                            process.cwd(),

                        stdio: ["pipe", "pipe", "pipe"],

                        /* P0-5: only an allowlisted environment plus the
                           server's own configured env, never the
                           runtime's API keys and tokens. */
                        env: childEnvironment.build(this.config.env || {}),

                        windowsHide: true
                    });

                child.stdout.on("data", chunk => {
                    this.decoder.push(chunk);
                });

                child.stderr.on("data", chunk => {
                    this.diagnose(
                        chunk.toString("utf8").slice(0, 1000)
                    );
                });

                child.on("error", error => {

                    this.diagnose(
                        `failed to start: ${error.message}`
                    );

                    if (this.child === child) {
                        this.teardown(
                            new Error(
                                `MCP server "${this.name}" failed to start: ${error.message}`
                            )
                        );
                    }

                    reject(error);
                });

                child.on("exit", (code, signal) => {

                    this.diagnose(
                        `exited with code ${code}, signal ${signal}`
                    );

                    if (this.child === child) {

                        this.teardown(
                            new Error(
                                `MCP server "${this.name}" exited unexpectedly (code: ${code}, signal: ${signal}).`
                            )
                        );

                        this.closeHandler({ code, signal });
                    }
                });

                this.child = child;

                resolve(this);
            });

        return this.startPromise;
    }


    receive(message) {

        if (
            this.observedFraming === null &&
            this.framing === protocol.FRAMING.AUTO
        ) {

            /*
            | The decoder already told the two framings apart; what is
            | recorded here is only which one the last message used.
            */

            this.observedFraming =
                this.decoder.lastFraming || protocol.FRAMING.CONTENT_LENGTH;
        }

        if (protocol.isResponse(message)) {

            const waiting =
                this.pending.get(message.id);

            if (!waiting) {
                return;
            }

            this.pending.delete(message.id);

            clearTimeout(waiting.timer);

            if (message.error) {

                waiting.reject(
                    protocol.toError(message.error, waiting.context)
                );

                return;
            }

            waiting.resolve(message.result);

            return;
        }

        if (protocol.isNotification(message)) {

            this.notificationHandler(message);
        }
    }


    writeFraming() {

        if (this.framing !== protocol.FRAMING.AUTO) {
            return this.framing;
        }

        return this.observedFraming || protocol.FRAMING.CONTENT_LENGTH;
    }


    write(message) {

        if (!this.isConnected()) {

            throw new Error(
                `MCP server "${this.name}" is not running.`
            );
        }

        this.child.stdin.write(
            protocol.encode(message, this.writeFraming())
        );
    }


    async send(message, options = {}) {

        await this.connect();

        this.write(message);
    }


    async request(message, options = {}) {

        await this.connect();

        const timeoutMs =
            options.timeoutMs || 30000;

        return new Promise((resolve, reject) => {

            const timer =
                setTimeout(() => {

                    if (!this.pending.has(message.id)) {
                        return;
                    }

                    this.pending.delete(message.id);

                    reject(
                        new Error(
                            `MCP request "${message.method}" to "${this.name}" timed out after ${timeoutMs}ms.`
                        )
                    );
                }, timeoutMs);

            if (typeof timer.unref === "function") {
                timer.unref();
            }

            this.pending.set(message.id, {
                resolve,
                reject,
                timer,
                context: `${this.name}/${message.method}`
            });

            try {

                this.write(message);

            } catch (error) {

                clearTimeout(timer);

                this.pending.delete(message.id);

                reject(error);
            }
        });
    }


    teardown(error) {

        for (const [id, waiting] of this.pending.entries()) {

            clearTimeout(waiting.timer);

            waiting.reject(error);

            this.pending.delete(id);
        }

        this.decoder.reset();

        this.child = null;

        this.startPromise = null;

        this.observedFraming = null;
    }


    async close() {

        const child = this.child;

        this.teardown(
            new Error(
                `MCP server "${this.name}" was shut down.`
            )
        );

        if (!child) {
            return;
        }

        try {

            child.stdin.end();

        } catch {
            /* the pipe is already gone */
        }

        try {

            child.kill("SIGTERM");

        } catch {
            /* the process is already gone */
        }

        /*
        | A server that ignores SIGTERM must not keep the runtime alive,
        | so the follow-up kill is scheduled and unreferenced.
        */

        const timer =
            setTimeout(() => {

                try {

                    if (child.exitCode === null) {
                        child.kill("SIGKILL");
                    }

                } catch {
                    /* nothing left to kill */
                }
            }, 3000);

        if (typeof timer.unref === "function") {
            timer.unref();
        }
    }
}


module.exports = {
    StdioTransport
};
