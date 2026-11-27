"use strict";

const assert = require("assert");
const {
    listModels,
    listModelCatalog,
    clearModelCatalogCache,
    modelNames,
    requestFor
} = require("../../agent/providers/ModelCatalog");

const fakeStore = values => ({
    get: key => values[key] ?? "",
    sourceOf: key => key === "AGENT_BASE_URL" ? "default" : "override"
});


async function main() {
    assert.deepStrictEqual(modelNames({ data: [{ id: "z" }, { id: "a" }, { id: "a" }] }), ["a", "z"]);
    assert.deepStrictEqual(modelNames({ models: [{ name: "llama3" }] }), ["llama3"]);
    assert.deepStrictEqual(modelNames({ modelSummaries: [{ modelId: "vendor.model" }] }), ["vendor.model"]);

    const openAiRequest = requestFor({
        provider: "openai-compatible",
        baseUrl: "https://example.test/v1/",
        apiKey: "secret",
        store: fakeStore({})
    });
    assert.equal(openAiRequest.url, "https://example.test/v1/models");
    assert.equal(openAiRequest.headers.authorization, "Bearer secret");

    let requested;
    const names = await listModels({
        role: "L2",
        settingsStore: fakeStore({
            AGENT_PROVIDER: "ollama",
            AGENT_BASE_URL: "http://localhost:11434/v1",
            ENDPOINT_L2_BASE_URL: "",
            ENDPOINT_L2_API_KEY: "",
            AGENT_API_KEY: ""
        }),
        transport: {
            request: async options => {
                requested = options;
                return { status: 200, text: async () => JSON.stringify({ models: [{ name: "qwen" }, { name: "llama" }] }) };
            }
        }
    });

    assert.equal(requested.url, "http://localhost:11434/api/tags");
    assert.deepStrictEqual(names, ["llama", "qwen"]);

    clearModelCatalogCache();
    const sharedSettings = fakeStore({
        AGENT_PROVIDER: "openai-compatible",
        AGENT_BASE_URL: "https://main.example/v1",
        AGENT_API_KEY: "shared-secret"
    });
    const sharedCalls = [];
    const sharedTransport = {
        request: async options => {
            sharedCalls.push(options.url);
            return { status: 200, text: async () => JSON.stringify({ data: [{ id: "main-model" }] }) };
        }
    };
    const sharedCatalog = await listModelCatalog({ settingsStore: sharedSettings, transport: sharedTransport });

    assert.equal(sharedCalls.length, 1, "unconfigured roles reuse the MAIN endpoint request");
    for (const role of ["MAIN", "L1", "L2", "L3", "SUMMARY"]) {
        assert.deepStrictEqual(sharedCatalog.byRole[role], ["main-model"]);
    }

    clearModelCatalogCache();
    const distinctSettings = fakeStore({
        AGENT_PROVIDER: "openai-compatible",
        AGENT_BASE_URL: "https://main.example/v1",
        AGENT_API_KEY: "shared-secret",
        ENDPOINT_L1_BASE_URL: "https://layer.example/v1"
    });
    const distinctCalls = [];
    const distinctCatalog = await listModelCatalog({
        settingsStore: distinctSettings,
        transport: {
            request: async options => {
                distinctCalls.push(options.url);
                const id = options.url.includes("layer.example") ? "layer-model" : "main-model";
                return { status: 200, text: async () => JSON.stringify({ data: [{ id }] }) };
            }
        }
    });

    assert.equal(distinctCalls.length, 2, "a newly configured endpoint adds one upstream request");
    assert.deepStrictEqual(distinctCatalog.byRole.MAIN, ["main-model"]);
    assert.deepStrictEqual(distinctCatalog.byRole.L1, ["layer-model"]);
    assert.deepStrictEqual(distinctCatalog.byRole.L2, ["main-model"]);

    assert.throws(() => requestFor({
        provider: "bedrock",
        baseUrl: "https://unused.invalid",
        apiKey: "",
        store: fakeStore({})
    }), /BEDROCK_ACCESS_KEY_ID/);

    console.log("  ok   model catalog normalizes provider responses and fetches layer models over the configured transport");
    console.log("\n1/1 passed");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
