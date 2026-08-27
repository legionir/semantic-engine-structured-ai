"use strict";

/*
|--------------------------------------------------------------------------
| Web console request body (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The one place a console request body is read, and the one place that
| decides a body is too large to be a console request.
|
| Moved verbatim out of web/server.js: the 1 MB ceiling, the
| empty-body-means-`{}` rule and the destroy-then-reject order all stay,
| because answering 400 after the socket has been torn down is the bug that
| order avoids. Every route that accepts a body reaches it as
| ctx.readBody(req) — none of them parses JSON on its own.
|--------------------------------------------------------------------------
*/

function readBody(req) {

    return new Promise((resolve, reject) => {

        let body = "";
        let size = 0;
        let rejected = false;

        const rejectTooLarge = () => {

            if (rejected) {
                return;
            }

            rejected = true;
            req.destroy();
            reject(new Error("request body is too large"));
        };

        req.on("data", chunk => {

            if (rejected) {
                return;
            }

            size += chunk.length;

            if (size > 1_000_000) {
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
    readBody
};
