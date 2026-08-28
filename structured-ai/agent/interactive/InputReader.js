"use strict";

const readline = require("readline");
const { COLOURS } = require("./OutputRenderer");

/*
|--------------------------------------------------------------------------
| Interactive Input Reader — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Manages the readline interface, line-ordering queue, and inline answers
| for interactive sessions. Ensures commands typed while a task is running
| are executed sequentially, and approval questions consume the next line
| without racing the prompt.
|--------------------------------------------------------------------------
*/

class InputReader {

    constructor({
        input = process.stdin,
        output = process.stdout,
        historySize = 100,
        prompt = COLOURS.bold("› ")
    } = {}) {

        this.queue = [];
        this.waitingForAnswer = null;
        this.inputClosed = false;
        this.draining = false;
        this.exitRequested = false;
        this.onDrained = null;

        this.rl = readline.createInterface({
            input,
            output,
            prompt,
            historySize
        });

        this._setupListeners();
    }

    _setupListeners() {

        this.rl.on("line", line => {

            const trimmed = line.trim();

            /* an approval question owns the next line */
            if (this.waitingForAnswer) {

                const resolve = this.waitingForAnswer;
                this.waitingForAnswer = null;
                resolve(trimmed);
                return;
            }

            if (trimmed === "") {

                if (!this.draining) {
                    this.prompt();
                }
                return;
            }

            this.queue.push(trimmed);
            this.drain();
        });
    }

    readAnswer() {

        return new Promise(resolve => {

            if (this.queue.length > 0) {

                resolve(this.queue.shift());
                return;
            }

            if (this.inputClosed) {

                resolve("n");
                return;
            }

            this.waitingForAnswer = resolve;
        });
    }

    setLineHandler(handler) {

        this.lineHandler = handler;
    }

    async drain() {

        if (this.draining) {
            return;
        }

        this.draining = true;

        while (
            this.queue.length > 0 &&
            !this.exitRequested
        ) {

            const line = this.queue.shift();

            if (typeof this.lineHandler === "function") {

                await this.lineHandler(line);
            }

            if (!this.exitRequested) {
                this.prompt();
            }
        }

        this.draining = false;

        if (this.onDrained) {

            const done = this.onDrained;
            this.onDrained = null;
            done();
        }
    }

    prompt() {

        this.rl.prompt();
    }

    requestExit() {

        this.exitRequested = true;
        this.rl.close();
    }

    close() {

        this.rl.close();
    }

    onClose(finish) {

        this.rl.on("close", () => {

            this.inputClosed = true;

            if (this.waitingForAnswer) {

                const answer = this.waitingForAnswer;
                this.waitingForAnswer = null;
                answer("n");
            }

            /*
            | End of input is not the end of the work: whatever is still
            | queued or running finishes first.
            */
            if (
                this.draining ||
                this.queue.length > 0
            ) {

                this.onDrained = finish;
                this.drain();
                return;
            }

            finish();
        });
    }
}

module.exports = {
    InputReader
};
