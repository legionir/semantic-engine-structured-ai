"use strict";

const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

if (!isMainThread) {
    let matcher;
    try {
        matcher = new RegExp(workerData.pattern, workerData.flags);
    } catch (error) {
        parentPort.postMessage({ type: "error", message: error.message });
    }

    parentPort.on("message", ({ id, line }) => {
        try {
            matcher.lastIndex = 0;
            parentPort.postMessage({ id, matched: matcher.test(line) });
        } catch (error) {
            parentPort.postMessage({ id, error: error.message });
        }
    });
} else {
    class RegexWorkerMatcher {

        constructor(pattern, flags, timeoutMs = 2000) {
            this.timeoutMs = timeoutMs;
            this.nextId = 0;
            this.pending = new Map();
            this.closed = false;
            this.worker = new Worker(__filename, { workerData: { pattern, flags } });
            this.worker.on("message", message => this._receive(message));
            this.worker.on("error", error => this._failAll(error));
            this.worker.on("exit", code => {
                if (code !== 0) this._failAll(new Error(`regex worker exited (${code})`));
            });
        }

        _receive(message) {
            if (message.type === "error") {
                this._failAll(new Error(`Invalid regular expression: ${message.message}`));
                return;
            }

            const pending = this.pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);

            if (message.error) pending.reject(new Error(message.error));
            else pending.resolve(message.matched === true);
        }

        _failAll(error) {
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(error);
            }
            this.pending.clear();
        }

        test(line) {
            if (this.closed) return Promise.reject(new Error("regex worker is closed"));
            const id = ++this.nextId;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(id);
                    this.closed = true;
                    this.worker.terminate().catch(() => {});
                    reject(new Error(`Regular expression evaluation exceeded ${this.timeoutMs} ms; search was stopped.`));
                }, this.timeoutMs);
                this.pending.set(id, { resolve, reject, timer });
                this.worker.postMessage({ id, line });
            });
        }

        async close() {
            if (this.closed) return;
            this.closed = true;
            this._failAll(new Error("regex worker closed"));
            await this.worker.terminate();
        }
    }

    module.exports = RegexWorkerMatcher;
}
