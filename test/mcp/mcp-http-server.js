/*
| mcp.test.js: the HTTP, SSE and WebSocket server
|
| Uses the shared answers from mcp-stdio-server.js; every server it
| starts is closed through the runner's cleanup list.
*/

const http = require("http");


module.exports = function createHttpServers({ answer, cleanups, websocket }) {

    /*
    | One HTTP listener that speaks all three network transports, chosen by
    | path, so a test can point any of them at the same port.
    */

    function startHttpServer(options = {}) {

        const sseClients = new Set();

        const server =
            http.createServer((req, res) => {

                const url =
                    new URL(req.url, "http://127.0.0.1");

                if (url.pathname === "/mcp" && req.method === "POST") {

                    readBody(req).then(body => {

                        const message = JSON.parse(body);

                        const reply = answer(message, options.name || "http-server");

                        if (!reply) {

                            res.writeHead(202).end();

                            return;
                        }

                        if (options.stream) {

                            res.writeHead(200, {
                                "content-type": "text/event-stream"
                            });

                            res.write(
                                `event: message\ndata: ${JSON.stringify({
                                jsonrpc: "2.0",
                                method: "notifications/message",
                                params: { level: "info", data: "working" }
                            })}\n\n`
                            );

                            res.write(
                                `event: message\ndata: ${JSON.stringify(reply)}\n\n`
                            );

                            res.end();

                            return;
                        }

                        res.writeHead(200, {
                            "content-type": "application/json",
                            "mcp-session-id": "session-1"
                        });

                        res.end(JSON.stringify(reply));
                    });

                    return;
                }

                if (url.pathname === "/mcp" && req.method === "DELETE") {

                    res.writeHead(200).end();

                    return;
                }

                /* the older pair: a stream to read, a path to post to */

                if (url.pathname === "/sse" && req.method === "GET") {

                    res.writeHead(200, {
                        "content-type": "text/event-stream",
                        "cache-control": "no-cache",
                        connection: "keep-alive"
                    });

                    res.write("event: endpoint\ndata: /messages\n\n");

                    sseClients.add(res);

                    req.on("close", () => sseClients.delete(res));

                    return;
                }

                if (url.pathname === "/messages" && req.method === "POST") {

                    readBody(req).then(body => {

                        const message = JSON.parse(body);

                        res.writeHead(202).end();

                        const reply = answer(message, options.name || "sse-server");

                        if (!reply) {
                            return;
                        }

                        for (const client of sseClients) {

                            client.write(
                                `event: message\ndata: ${JSON.stringify(reply)}\n\n`
                            );
                        }
                    });

                    return;
                }

                res.writeHead(404).end();
            });

        /* the websocket half: a hand rolled handshake and frame codec */

        server.on("upgrade", (req, socket) => {

            const key = req.headers["sec-websocket-key"];

            socket.write(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${websocket.acceptValue(key)}\r\n\r\n`
            );

            let buffer = Buffer.alloc(0);

            socket.on("data", chunk => {

                buffer = Buffer.concat([buffer, chunk]);

                for (;;) {

                    const frame =
                        websocket.decodeFrame(buffer);

                    if (!frame) {
                        return;
                    }

                    buffer = frame.rest;

                    if (frame.opcode === websocket.OPCODE.CLOSE) {

                        socket.end();

                        return;
                    }

                    if (frame.opcode !== websocket.OPCODE.TEXT) {
                        continue;
                    }

                    const message =
                        JSON.parse(frame.payload.toString("utf8"));

                    const reply =
                        answer(message, options.name || "ws-server");

                    if (!reply) {
                        continue;
                    }

                    /*
                    | Answered unmasked, as a server must, and through the
                    | runtime's own encoder with the mask bit cleared.
                    */

                    socket.write(
                        serverFrame(JSON.stringify(reply))
                    );
                }
            });
        });

        return new Promise(resolve => {

            server.listen(0, "127.0.0.1", () => {

                const port = server.address().port;

                const handle = {
                    port,

                    close: () =>
                        new Promise(done => {

                            for (const client of sseClients) {
                                client.end();
                            }

                            server.closeAllConnections?.();

                            server.close(done);
                        })
                };

                cleanups.push(handle.close);

                resolve(handle);
            });
        });
    }


    function serverFrame(text) {

        const body = Buffer.from(text, "utf8");

        const header =
            body.length < 126
                ? Buffer.alloc(2)
                : Buffer.alloc(4);

        header[0] = 0x81;

        if (body.length < 126) {

            header[1] = body.length;

        } else {

            header[1] = 126;

            header.writeUInt16BE(body.length, 2);
        }

        return Buffer.concat([header, body]);
    }


    function readBody(req) {

        return new Promise(resolve => {

            let body = "";

            req.on("data", chunk => body += chunk);

            req.on("end", () => resolve(body));
        });
    }

    return { startHttpServer };
};
