"use strict";

/*
| Live smoke for the built sibling semantic-engine package. This is kept
| separate from the hermetic coverage suite because CI/test installs may
| omit that package's optional native dependencies and build artifacts.
| Run `npm run build` in ../semantic-engine first, then
| `npm run test:semantic:live` here.
*/

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const engineCli = path.resolve(__dirname, "..", "..", "semantic-engine", "bin", "semantic-engine.js");
const engineMain = path.resolve(__dirname, "..", "..", "semantic-engine", "dist", "cli", "main.js");

if (!fs.existsSync(engineMain)) {
    console.error("semantic-engine is not built; run npm run build in ../semantic-engine first.");
    process.exit(2);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "structured-ai-semantic-live-"));
const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "structured-ai-semantic-data-"));

process.env.WORKSPACE_ROOT = workspace;
process.env.SEMANTIC_ENGINE_DATA_DIR = dataHome;
process.env.SEMANTIC_ENABLED = "true";
process.env.MCP_ENABLED = "true";

async function main() {

    try {
        fs.writeFileSync(
            path.join(workspace, "smoke.js"),
            "export class CheckpointSemanticSmoke {\n  queryIndex() {}\n}\n",
            "utf8"
        );

        const indexed = spawnSync(
            process.execPath,
            [engineCli, "index", "--root", workspace, "--data-dir", dataHome, "--no-vectors", "--no-git"],
            { encoding: "utf8", timeout: 120000 }
        );
        if (indexed.error) throw indexed.error;
        if (indexed.status !== 0) {
            throw new Error(`semantic-engine index failed (${indexed.status}): ${indexed.stderr || indexed.stdout}`);
        }

        const tools = require("../agent/tools");
        const result = await tools.executeTool(
            "code_find_symbol",
            { name: "CheckpointSemanticSmoke" },
            { agent: "semantic-engine-live-smoke" }
        );

        if (!result.symbols?.some(item => item.name === "CheckpointSemanticSmoke")) {
            throw new Error(
                `Structured AI could not query the live semantic-engine sidecar: ${JSON.stringify(result)}; ` +
                `diagnostics=${JSON.stringify(require("../agent/mcp/semantic")._getDiagnostics())}`
            );
        }

        console.log("ok   semantic-engine index + stdio MCP query");
        console.log(`     ${result.returned}/${result.total} symbol result(s), index=${result.index_state}`);

    } finally {
        try { require("../agent/mcp/semantic").shutdown(); } catch { /* best-effort child cleanup */ }
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(dataHome, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
