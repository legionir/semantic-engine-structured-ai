"use strict";

const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");

const settings = require(path.join(__dirname, "..", "..", "agent", "config"));
const { httpTransport } = require(path.join(__dirname, "..", "..", "agent", "providers", "HttpTransport"));
const { createAgentRequestExecutor } = require(path.join(__dirname, "..", "..", "agent", "providers", "AgentRequestExecutor"));


function listen(server) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve(server.address());
        });
    });
}


function close(server) {
    return new Promise(resolve => server.close(resolve));
}


function createSocks5Server(onConnect) {
    return net.createServer(client => {
        let buffer = Buffer.alloc(0);
        let stage = "greeting";

        client.on("data", chunk => {
            buffer = Buffer.concat([buffer, chunk]);

            if (stage === "greeting") {
                if (buffer.length < 2) return;
                const methods = buffer[1];
                if (buffer.length < 2 + methods) return;
                buffer = buffer.subarray(2 + methods);
                client.write(Buffer.from([5, 0]));
                stage = "request";
            }

            if (stage !== "request" || buffer.length < 5) return;
            if (buffer[0] !== 5 || buffer[1] !== 1) {
                client.destroy(new Error("unsupported SOCKS5 command"));
                return;
            }

            const addressType = buffer[3];
            let host;
            let offset;

            if (addressType === 1) {
                if (buffer.length < 10) return;
                host = [...buffer.subarray(4, 8)].join(".");
                offset = 8;
            } else if (addressType === 3) {
                const length = buffer[4];
                if (buffer.length < 7 + length) return;
                host = buffer.subarray(5, 5 + length).toString("utf8");
                offset = 5 + length;
            } else {
                client.destroy(new Error("unsupported SOCKS5 address type"));
                return;
            }

            const port = buffer.readUInt16BE(offset);
            buffer = buffer.subarray(offset + 2);
            stage = "connecting";

            const upstream = net.connect(port, host, () => {
                onConnect();
                client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
                if (buffer.length) upstream.write(buffer);
                client.pipe(upstream);
                upstream.pipe(client);
            });

            upstream.once("error", () => {
                client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
            });

            client.once("error", () => upstream.destroy());
            client.once("close", () => upstream.destroy());
        });
    });
}


async function main() {
    const originalEnv = process.env.AGENT_PROXY_URL;
    delete process.env.AGENT_PROXY_URL;
    settings.reset("AGENT_PROXY_URL");

    let originHits = 0;
    let httpProxyHits = 0;
    let socksProxyHits = 0;

    const origin = http.createServer((req, res) => {
        originHits += 1;
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ path: req.url, body: Buffer.concat(chunks).toString("utf8") }));
        });
    });

    const originAddress = await listen(origin);
    const originUrl = `http://127.0.0.1:${originAddress.port}/provider-test`;

    const httpProxy = http.createServer((req, res) => {
        httpProxyHits += 1;
        let target;
        try {
            target = new URL(req.url);
        } catch {
            res.writeHead(400).end("proxy expected an absolute request URL");
            return;
        }
        const upstream = http.request(target, { method: req.method, headers: req.headers }, response => {
            res.writeHead(response.statusCode || 502, response.headers);
            response.pipe(res);
        });
        upstream.once("error", error => res.writeHead(502).end(error.message));
        req.pipe(upstream);
    });

    const httpProxyAddress = await listen(httpProxy);
    const socksProxy = createSocks5Server(() => { socksProxyHits += 1; });
    const socksProxyAddress = await listen(socksProxy);

    try {
        await settings.set("AGENT_PROXY_URL", `http://proxy-user:proxy-password@127.0.0.1:${httpProxyAddress.port}`);
        const viaHttp = await httpTransport.request({ method: "POST", url: originUrl, body: "via-http" });
        assert.equal(viaHttp.status, 200);
        assert.deepEqual(JSON.parse(await viaHttp.text()), { path: "/provider-test", body: "via-http" });
        assert.equal(httpProxyHits, 1);

        const requestExecutor = createAgentRequestExecutor({
            settings: { get: () => "auto" },
            endpointFor: () => ({ endpoint: originUrl, model: "proxy-test", api_key: "test-key" }),
            buildAgentRequest: () => ({ messages: [] }),
            assertRunActive() {},
            events: { emit() {} },
            createRequestSignal: () => ({ signal: undefined, reason: null, release() {} }),
            isRunCancelled: () => false,
            isRetryableStatus: () => true,
            logLine() {}
        });
        const runtimeAnswer = await requestExecutor.sendAgentRequest({
            agentDefinition: { name: "proxy-test" },
            messages: [],
            tools: [],
            responseFormat: null,
            timeoutMs: 1000,
            role: "MAIN"
        });
        assert.deepEqual(runtimeAnswer, { path: "/provider-test", body: JSON.stringify({ messages: [] }) });
        assert.equal(httpProxyHits, 2, "the live runtime request also uses the configured proxy");

        const described = settings.describe(settings.definitionOf("AGENT_PROXY_URL"));
        assert.equal(described.secret, true);
        assert.notEqual(described.value, settings.get("AGENT_PROXY_URL"));
        assert.doesNotMatch(JSON.stringify(described), /proxy-password/);

        await settings.set("AGENT_PROXY_URL", `socks5h://127.0.0.1:${socksProxyAddress.port}`);
        const viaSocks = await httpTransport.request({ method: "POST", url: originUrl, body: "via-socks" });
        assert.equal(viaSocks.status, 200);
        assert.deepEqual(JSON.parse(await viaSocks.text()), { path: "/provider-test", body: "via-socks" });
        assert.equal(socksProxyHits, 1);

        await settings.reset("AGENT_PROXY_URL");
        const direct = await httpTransport.request({ method: "POST", url: originUrl, body: "direct" });
        assert.equal(direct.status, 200);
        assert.deepEqual(JSON.parse(await direct.text()), { path: "/provider-test", body: "direct" });
        assert.equal(originHits, 4);

        assert.throws(
            () => settings.set("AGENT_PROXY_URL", "file:///tmp/proxy"),
            /supports only http:\/\/, socks5:\/\//
        );
    } finally {
        settings.reset("AGENT_PROXY_URL");
        if (originalEnv !== undefined) process.env.AGENT_PROXY_URL = originalEnv;
        await Promise.all([close(origin), close(httpProxy), close(socksProxy)]);
    }

    console.log("  ok   HTTP and SOCKS5 proxies route provider requests");
    console.log("  ok   proxy changes apply on the next request without restarting the transport");
    console.log("  ok   proxy credentials are masked and unsupported schemes are rejected");
    console.log("\n3/3 passed");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
