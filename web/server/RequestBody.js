"use strict";

/*
| Request body parsing — EXECUTION_PLAN Phase 23
|
| The limit and error messages are part of the Web API contract. Keep the
| parser independent from routing so every controller receives the same
| bounded JSON input.
*/

const defaultMaxBytes = 1_000_000;

/*
| SA-F-005: a multi-byte UTF-8 character can be split across incoming
| chunks. `chunk.toString("utf8")` per chunk replaces each orphaned
| continuation byte with U+FFFD, corrupting the body (a non-ASCII task
| string becomes mojibake, or the JSON parse fails outright).
| StringDecoder keeps the incomplete tail of one chunk and prepends it
| to the next, so decoding is correct across boundaries.
*/

const { StringDecoder } = require("string_decoder");


function readBody(req, { maxBytes = defaultMaxBytes } = {}) {

    return new Promise((resolve, reject) => {

        const decoder = new StringDecoder("utf8");
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

            body += decoder.write(chunk);
        });

        req.on("end", () => {

            if (rejected) {
                return;
            }

            body += decoder.end();

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
