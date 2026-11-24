"use strict";

/*
|--------------------------------------------------------------------------
| Provider registry (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Provider name -> adapter class. The AGENT_PROVIDER setting accepts
| exactly these names (a test keeps the two lists equal).
|--------------------------------------------------------------------------
*/

const { ProviderError } = require("./ProviderError");
const { OpenAIChatProvider, OpenAICompatibleProvider } = require("./OpenAIChatProvider");
const { OpenAIResponsesProvider } = require("./OpenAIResponsesProvider");
const { AnthropicProvider } = require("./AnthropicProvider");
const { GeminiProvider } = require("./GeminiProvider");
const { AzureOpenAIProvider } = require("./AzureOpenAIProvider");
const { BedrockProvider } = require("./BedrockProvider");
const { OllamaProvider } = require("./OllamaProvider");
const { OpenRouterProvider } = require("./OpenRouterProvider");


const adapters = new Map([
    ["openai-compatible", OpenAICompatibleProvider],
    ["openai", OpenAIChatProvider],
    ["openai-responses", OpenAIResponsesProvider],
    ["anthropic", AnthropicProvider],
    ["gemini", GeminiProvider],
    ["azure-openai", AzureOpenAIProvider],
    ["bedrock", BedrockProvider],
    ["ollama", OllamaProvider],
    ["openrouter", OpenRouterProvider]
]);


function providerNames() {
    return [...adapters.keys()];
}


function adapterFor(name) {
    return adapters.get(String(name || "")) || null;
}


function createProvider(spec = {}, deps = {}) {

    const Adapter = adapterFor(spec.provider);

    if (!Adapter) {

        throw new ProviderError(
            `unknown provider "${spec.provider}"; known providers: ${providerNames().join(", ")}`,
            { provider: spec.provider || null, code: "unknown_provider", retryable: false }
        );
    }

    return new Adapter({ ...spec, provider: spec.provider }, deps);
}


module.exports = {
    providerNames,
    adapterFor,
    createProvider
};
