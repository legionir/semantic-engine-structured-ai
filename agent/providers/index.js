"use strict";

/*
|--------------------------------------------------------------------------
| Provider abstraction (roadmap P1-1)
|--------------------------------------------------------------------------
|
|   const providers = require("./providers");
|   const router = providers.createRouter();          // from settings
|   const answer = await router.chatCompletions(body, { role: "coder" });
|   const action = readModelAction(answer);           // unchanged parser
|
| See README.md in this folder for the settings of every provider.
|--------------------------------------------------------------------------
*/

const { LLMProvider } = require("./LLMProvider");
const { ProviderError, isRetryableStatus } = require("./ProviderError");
const { ProviderRouter } = require("./ProviderRouter");
const { providerNames, createProvider, adapterFor } = require("./ProviderRegistry");
const { fromSettings, parseShort } = require("./ProviderConfig");
const { estimateTokens, estimateRequestTokens } = require("./TokenCounter");
const { httpTransport } = require("./HttpTransport");


function createRouter(options = {}) {
    return ProviderRouter.fromSettings(options);
}


module.exports = {
    LLMProvider,
    ProviderError,
    ProviderRouter,
    isRetryableStatus,
    providerNames,
    createProvider,
    adapterFor,
    createRouter,
    fromSettings,
    parseShort,
    estimateTokens,
    estimateRequestTokens,
    httpTransport
};
