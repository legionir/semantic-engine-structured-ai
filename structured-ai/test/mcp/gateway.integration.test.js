const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/*
|--------------------------------------------------------------------------|
| Gateway integration — the real engine, the real client                   |
|--------------------------------------------------------------------------|
|
| EXECUTION_PLAN فاز ۱۰ گام ۳: `test/helpers/stubSemanticGateway.js` was
| written when the engine-side Gateway did not exist, and it stays for the
| unit tests (it is fast and has no moving parts). This file is the other
| half: it starts the real `semantic-engine gateway`, registers two projects
| whose directories share a name, and drives them through the shipped
| SemanticClient + HttpTransport.
|
| It needs the engine to be built (`semantic-engine/dist`). When it is not,
| the file reports a skip and exits 0, so `npm test` stays usable on a
| checkout that has not run `npm run build` in the engine package.
|--------------------------------------------------------------------------|
*/

/* این فایل در structured-ai/test/mcp است؛ ریپو سه سطح بالاتر است. */
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ENGINE_ROOT = path.join(REPO_ROOT, "semantic-engine");
const ENGINE_BIN = path.join(ENGINE_ROOT, "bin", "semantic-engine.js");
const ENGINE_BUILT = fs.existsSync(path.join(ENGINE_ROOT, "dist", "cli", "main.js"));

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.error(error);
    }
}

function httpJson(port, method, urlPath, body, token) {

    return new Promise((resolve, reject) => {

        const payload = body === undefined ? undefined : JSON.stringify(body);

        const req = http.request(
            {
                host: "127.0.0.1",
                port,
                path: urlPath,
                method,
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(payload
                        ? {
                            "Content-Type": "application/json",
                            "Content-Length": Buffer.byteLength(payload)
                        }
                        : {})
                }
            },
            res => {

                const chunks = [];

                res.on("data", chunk => chunks.push(chunk));

                res.on("end", () => {

                    const text = Buffer.concat(chunks).toString("utf8");

                    let json = null;

                    try {
                        json = text === "" ? null : JSON.parse(text);
                    } catch {
                        json = { raw: text };
                    }

                    resolve({ status: res.statusCode, json, text });
                });
            }
        );

        req.on("error", reject);

        if (payload) {
            req.write(payload);
        }

        req.end();
    });
}

function startGateway(base) {

    const dataDir = path.join(base, "data");

    const child = spawn(
        process.execPath,
        [ENGINE_BIN, "gateway", "--port", "0", "--host", "127.0.0.1", "--data-dir", dataDir],
        { cwd: ENGINE_ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderr = "";

    return new Promise((resolve, reject) => {

        const timer = setTimeout(
            () => reject(new Error(`gateway did not start:\n${stderr}`)),
            60000
        );

        child.stderr.on("data", chunk => {

            stderr += String(chunk);

            const match = /gateway url=http:\/\/127\.0\.0\.1:(\d+) token=(\S+)/.exec(stderr);

            if (match) {

                clearTimeout(timer);

                resolve({
                    child,
                    port: Number(match[1]),
                    token: match[2],
                    dataDir
                });
            }
        });

        child.once("exit", code => {

            clearTimeout(timer);

            reject(new Error(`gateway exited with ${code}:\n${stderr}`));
        });
    });
}

function makeProject(base, client, symbol) {

    const root = path.join(base, client, "app");

    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    fs.writeFileSync(
        path.join(root, "src", "a.ts"),
        `export function ${symbol}(): number { return 1; }\n`
    );

    return root;
}

async function main() {

    if (!ENGINE_BUILT) {

        console.log(
            "  skip semantic-engine is not built (run `npm run build` in semantic-engine/)"
        );

        console.log("\n0/0 passed (skipped)");

        process.exit(0);
    }

    const base = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "sai-gateway-"))
    );

    process.env.WORKSPACE_ROOT = base;
    process.env.SEMANTIC_ENABLED = "true";
    process.env.SEMANTIC_CALL_TIMEOUT_MS = "30000";

    const rootA = makeProject(base, "client-a", "alphaOnly");
    const rootB = makeProject(base, "client-b", "betaOnly");

    const gateway = await startGateway(base);

    let clientA = null;
    let clientB = null;

    /*
    | هر چیزی که می‌تواند throw کند باید *داخل* try باشد، وگرنه یک خطای
    | زودهنگام، gateway را بدون cleanup رها می‌کند و workerهایش زنده
    | می‌مانند — دقیقاً همان چیزی که اولین اجرای ناموفق این فایل ساخت.
    */
    try {

        /* module.exports خودِ کلاس است، نه یک named export. */
        const SemanticClient = require("../../agent/mcp/SemanticClient");

        const registered = [];

        for (const root of [rootA, rootB]) {

            const reply = await httpJson(
                gateway.port,
                "POST",
                "/api/v1/gateway/projects",
                { path: root, autoStart: true },
                gateway.token
            );

            assert.equal(reply.status, 201, `register ${root}: ${reply.text}`);

            registered.push(reply.json);
        }

        const [projectA, projectB] = registered;

        const endpointFor = project =>
            `http://127.0.0.1:${gateway.port}/mcp/${project.id}?token=${gateway.token}`;

        clientA = new SemanticClient({
            projectId: projectA.id,
            workspaceRoot: projectA.rootPath,
            semanticEndpoint: endpointFor(projectA)
        });

        clientB = new SemanticClient({
            projectId: projectB.id,
            workspaceRoot: projectB.rootPath,
            semanticEndpoint: endpointFor(projectB)
        });

        await test("tools/list reaches the real engine through the gateway", async () => {

            const connection = clientA.ensureClient();

            const listed = await connection.listTools();

            const names = (listed.tools || listed || []).map(tool => tool.name);

            assert.ok(names.includes("find_symbol"), `tools: ${names.join(",")}`);
        });

        await test("each project answers with its own symbols", async () => {

            const foundA = await clientA.call("find_symbol", { name: "alphaOnly" });

            const foundB = await clientB.call("find_symbol", { name: "betaOnly" });

            const textA = JSON.stringify(foundA);
            const textB = JSON.stringify(foundB);

            assert.ok(textA.includes("alphaOnly"), textA.slice(0, 300));
            assert.ok(!textA.includes("betaOnly"), "project A leaked B's symbol");
            assert.ok(textB.includes("betaOnly"), textB.slice(0, 300));
            assert.ok(!textB.includes("alphaOnly"), "project B leaked A's symbol");
        });

        await test("the generation protocol reaches the shipped client", async () => {

            assert.equal(
                typeof clientA.indexGeneration,
                "number",
                `indexGeneration: ${clientA.indexGeneration}`
            );

            assert.equal(
                typeof clientB.indexGeneration,
                "number",
                `indexGeneration: ${clientB.indexGeneration}`
            );
        });

        await test("reindexing A moves only A's generation", async () => {

            const beforeA = clientA.indexGeneration;
            const beforeB = clientB.indexGeneration;

            const reindexed = await httpJson(
                gateway.port,
                "POST",
                `/api/v1/gateway/projects/${projectA.id}/reindex`,
                {},
                gateway.token
            );

            assert.ok(
                reindexed.status === 200 || reindexed.status === 202,
                `reindex: ${reindexed.status} ${reindexed.text}`
            );

            /* Worker A writes a new index; the watcher reloads it. */
            let afterA = beforeA;

            const deadline = Date.now() + 60000;

            while (Date.now() < deadline && afterA === beforeA) {

                await new Promise(resolve => setTimeout(resolve, 500));

                await clientA.call("find_symbol", { name: "alphaOnly" });

                afterA = clientA.indexGeneration;
            }

            assert.notEqual(afterA, beforeA, "A's generation did not move");

            await clientB.call("find_symbol", { name: "betaOnly" });

            assert.equal(
                clientB.indexGeneration,
                beforeB,
                "B's generation moved although only A was reindexed"
            );
        });

    } finally {

        for (const client of [clientA, clientB]) {

            try {
                if (client) {
                    await client.disconnect();
                }
            } catch {
                /* بستن کلاینت نباید نتیجه را عوض کند. */
            }
        }

        gateway.child.kill("SIGTERM");

        await new Promise(resolve => {

            const timer = setTimeout(() => {

                gateway.child.kill("SIGKILL");

                resolve();
            }, 10000);

            gateway.child.once("exit", () => {

                clearTimeout(timer);

                resolve();
            });
        });

        fs.rmSync(base, { recursive: true, force: true });
    }

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);

    process.exit(1);
});
