"use strict";

const { sendSseHeaders, writeSse } = require("./Response");


/*
|--------------------------------------------------------------------------
| SSE hub — EXECUTION_PLAN Phase 23
|--------------------------------------------------------------------------
|
| Keeps client lifecycle and keep-alives out of route/controller code. The
| event transformer is per client so project authorization/filtering remains
| enforced for every live event and not only for the initial snapshot.
|--------------------------------------------------------------------------
*/

class SseHub {

    constructor({ clients, keepAliveMs = 15_000 } = {}) {
        this.clients = clients || new Set();
        this.keepAliveMs = keepAliveMs;
        this.timers = new Map();
    }


    attach(req, res, client, snapshot) {

        sendSseHeaders(res);
        writeSse(res, snapshot);
        this.clients.add(client);

        const timer = setInterval(
            () => {
                try {
                    res.write(": ping\n\n");
                } catch {
                    this.remove(client);
                }
            },
            this.keepAliveMs
        );

        this.timers.set(client, timer);

        req.on("close", () => this.remove(client));
        return client;
    }


    remove(client) {

        const timer = this.timers.get(client);

        if (timer) {
            clearInterval(timer);
            this.timers.delete(client);
        }

        this.clients.delete(client);
    }


    broadcast(event, transform = value => value) {

        for (const client of [...this.clients]) {

            const visible = transform(event, client);

            if (!visible) {
                continue;
            }

            try {
                writeSse(client.res, visible);
            } catch {
                this.remove(client);
            }
        }
    }


    close() {

        for (const client of [...this.clients]) {
            this.remove(client);
            try {
                client.res.end();
            } catch {
                /* already closed */
            }
        }
    }


    size() {
        return this.clients.size;
    }
}


module.exports = {
    SseHub
};
