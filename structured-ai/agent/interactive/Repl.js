"use strict";

const path = require("path");
const { OutputRenderer, COLOURS } = require("./OutputRenderer");
const { InputReader } = require("./InputReader");
const { ApprovalPrompt } = require("./ApprovalPrompt");
const { ReplCommands } = require("./ReplCommands");

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

/*
|--------------------------------------------------------------------------
| Interactive REPL Session — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Orchestrates an interactive agent session: manages conversational state,
| dispatches tasks and slash commands, connects approvals to the reader,
| handles SIGINT cancellation, and cleanly shuts down on exit.
|--------------------------------------------------------------------------
*/

class Repl {

    constructor(runtime, options = {}) {

        this.runtime = runtime;
        this.options = options;

        this.toolRuntime =
            require(path.join(REPO_ROOT, "agent", "tools"));

        this.session = {
            history: [],
            lastAnswer: null,
            running: false,
            tasks: 0
        };

        this.inputReader =
            new InputReader({
                historySize:
                    runtime.settings?.get("SESSION_HISTORY_SIZE") || 100,
                prompt: COLOURS.bold("› ")
            });

        this.context =
            runtime.createRuntimeContext();

        this.interruptedAt = 0;
    }

    async runTask(task) {

        this.session.running = true;
        this.session.tasks++;

        const startedAt = Date.now();

        try {

            const action =
                await this.runtime.runAgent({
                    task,
                    history: this.session.history
                });

            if (action?.response) {

                this.session.lastAnswer =
                    action.response.content;
            }

            OutputRenderer.renderTaskResult(action, startedAt);

        } catch (error) {

            const cancelled =
                this.runtime.isRunCancelled();

            if (cancelled) {

                OutputRenderer.renderTaskCancelled();

            } else {

                OutputRenderer.renderTaskError(
                    error,
                    this.options.verbose
                );
            }

        } finally {

            this.session.running = false;
        }
    }

    setupSignals() {

        process.on("SIGINT", () => {

            if (this.session.running) {

                this.runtime.cancelRun("interrupt");
                return;
            }

            const now = Date.now();

            if (now - this.interruptedAt < 2000) {

                this.inputReader.close();
                return;
            }

            this.interruptedAt = now;

            OutputRenderer.renderInterruptNotice();

            this.inputReader.prompt();
        });
    }

    start() {

        ApprovalPrompt.install(this.runtime, this.inputReader);

        OutputRenderer.renderBanner(this.runtime);

        this.setupSignals();

        this.inputReader.setLineHandler(async line => {

            if (line.startsWith("/")) {

                await ReplCommands.execute(line, {
                    session: this.session,
                    runtime: this.runtime,
                    context: this.context,
                    toolRuntime: this.toolRuntime,
                    inputReader: this.inputReader
                });

            } else {

                await this.runTask(line);
            }
        });

        this.inputReader.prompt();

        return new Promise(resolve => {

            const finish = () => {

                OutputRenderer.renderExit(this.session);

                this.toolRuntime.shutdown();

                resolve(0);
            };

            this.inputReader.onClose(finish);
        });
    }
}


async function startSession(runtime, options) {

    const repl = new Repl(runtime, options);

    return repl.start();
}


module.exports = {
    Repl,
    startSession
};
