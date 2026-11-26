"use strict";

/*
| runtime.test.js: endpoint profiles
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function endpointProfilesCases(ctx) {

    const {
        runtime,
        settings,
        test
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nendpoint profiles");

    await test("each role resolves its own endpoint, key, model and temperature", async () => {

        settings.set("AGENT_MODEL", "house-model");
        settings.set("AGENT_BASE_URL", "http://house/v1");

        /* everything inherits until a role is configured */
        for (const role of ["MAIN", "L1", "L2", "L3", "SUMMARY"]) {

            const resolved =
                runtime.endpointFor(role, null);

            assert.equal(resolved.model, "house-model");
            assert.equal(resolved.base_url, "http://house/v1");
        }

        settings.set("ENDPOINT_L1_MODEL", "mid-model");
        settings.set("ENDPOINT_L2_BASE_URL", "http://cheap/v1");
        settings.set("ENDPOINT_L2_API_KEY", "cheap-key");
        settings.set("ENDPOINT_SUMMARY_MODEL", "tiny-model");
        settings.set("ENDPOINT_SUMMARY_TEMPERATURE", 0);
        settings.set("AGENT_REASONING_EFFORT", "medium");
        settings.set("ENDPOINT_L1_REASONING_EFFORT", "high");

        assert.equal(
            runtime.endpointFor("L1", null).model,
            "mid-model"
        );

        const level2 =
            runtime.endpointFor("L2", null);

        assert.equal(level2.base_url, "http://cheap/v1");
        assert.equal(level2.api_key, "cheap-key");
        assert.equal(level2.endpoint, "http://cheap/v1/chat/completions");
        assert.equal(level2.reasoning_effort, "medium", "unset layer effort inherits AGENT_REASONING_EFFORT");
        assert.equal(runtime.endpointFor("L1", null).reasoning_effort, "high", "a layer-specific effort overrides the agent default");

        const request = runtime.buildAgentRequest({
            messages: [{ role: "user", content: "test" }],
            agentDefinition: null,
            tools: [],
            responseFormat: null,
            role: "L1"
        });
        assert.equal(request.reasoning_effort, "high");

        const runContext = runtime.runManager.createRun({ reasoningEffort: "low" });
        const runEffort = await runtime.runManager.execute(
            runContext,
            () => runtime.endpointFor("L2", null).reasoning_effort
        );
        assert.equal(runEffort, "low", "a per-task effort selection overrides all endpoint layers");

        /* a role model outranks the profile's own */
        assert.equal(
            runtime.endpointFor("SUMMARY", { model: "profile" }).model,
            "tiny-model"
        );

        assert.equal(
            runtime.endpointFor("SUMMARY", { temperature: 0.9 }).temperature,
            0
        );

        /* an unconfigured role still inherits */
        assert.equal(
            runtime.endpointFor("L3", null).model,
            "house-model"
        );

        for (const key of [
            "ENDPOINT_L1_MODEL",
            "ENDPOINT_L2_BASE_URL",
            "ENDPOINT_L2_API_KEY",
            "ENDPOINT_SUMMARY_MODEL",
            "ENDPOINT_SUMMARY_TEMPERATURE",
            "AGENT_REASONING_EFFORT",
            "ENDPOINT_L1_REASONING_EFFORT",
            "AGENT_MODEL",
            "AGENT_BASE_URL"
        ]) {
            settings.reset(key);
        }
    });

    await test("depth maps to a role, and deep agents share the last one", async () => {

        assert.equal(runtime.roleForDepth(0), "MAIN");
        assert.equal(runtime.roleForDepth(1), "L1");
        assert.equal(runtime.roleForDepth(2), "L2");
        assert.equal(runtime.roleForDepth(3), "L3");
        assert.equal(runtime.roleForDepth(9), "L3");
    });
};
