"use strict";

/* Ordered REPL input — EXECUTION_PLAN Phase 26. */

class InputReader {
    constructor({ input = process.stdin } = {}) {
        this.input = input;
        this.queue = [];
        this.waiting = null;
        this.closed = false;
    }

    push(value) {
        if (this.waiting) {
            const resolve = this.waiting;
            this.waiting = null;
            resolve(value);
            return;
        }
        this.queue.push(value);
    }

    read(defaultValue = "") {
        if (this.queue.length) return Promise.resolve(this.queue.shift());
        if (this.closed) return Promise.resolve(defaultValue);
        return new Promise(resolve => { this.waiting = resolve; });
    }

    close(defaultValue = "") {
        this.closed = true;
        if (this.waiting) {
            const resolve = this.waiting;
            this.waiting = null;
            resolve(defaultValue);
        }
    }
}


module.exports = {
    InputReader
};
