"use strict";

/*
| Request body parsing — EXECUTION_PLAN Phase 23
|
| The limit and error messages are part of the Web API contract. Keep the
| parser independent from routing so every controller receives the same
| bounded JSON input.
*/

const defaultMaxBytes = 1_000_000;


function readBody(req, { maxBytes = defaultMaxBytes } = {}) {

    return new Promise((resolve, reject) => {

        let body = "";
        let size = 0;
        let rejected = false;

        const rejectTooLarge = () => {

            if (rejected) {
                return;
            }

            rejected = true;

            if (typeof req.destroy === "function") {
                req.destroy();
            }

            reject(new Error("request body is too large"));
        };

        req.on("data", chunk => {

            if (rejected) {
                return;
            }

            size += chunk.length;

            if (size > maxBytes) {
                rejectTooLarge();
                return;
            }

            body += chunk.toString("utf8");
        });

        req.on("end", () => {

            if (rejected) {
                return;
            }

            if (body.trim() === "") {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("request body is not valid JSON"));
            }
        });

        req.on("error", error => {

            if (!rejected) {
                reject(error);
            }
        });
    });
}


module.exports = {
    DEFAULT_MAX_BYTES: defaultMaxBytes,
    readBody
};
