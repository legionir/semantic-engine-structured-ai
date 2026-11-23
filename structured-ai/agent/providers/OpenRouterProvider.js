"use strict";

/*
|--------------------------------------------------------------------------
| OpenRouter (roadmap P1-1)
|--------------------------------------------------------------------------
|
| OpenAI-compatible gateway at https://openrouter.ai/api/v1. Model names
| carry the vendor ("anthropic/claude-sonnet-4", "google/gemini-2.5-pro").
| The optional attribution headers identify the app; they can be changed
| with spec.referer / spec.title.
|--------------------------------------------------------------------------
*/

const { OpenAIChatProvider } = require("./OpenAIChatProvider");


class OpenRouterProvider extends OpenAIChatProvider {

    defaultBaseUrl() {
        return "https://openrouter.ai/api/v1";
    }


    capabilities() {
        return { ...super.capabilities(), promptCaching: "model-dependent" };
    }


    authHeaders() {

        return {
            ...super.authHeaders(),
            "HTTP-Referer": this.spec.referer || "https://github.com/legionir/semantic-engine-structured-ai",
            "X-Title": this.spec.title || "structured-ai"
        };
    }
}

OpenRouterProvider.providerName = "openrouter";


module.exports = {
    OpenRouterProvider
};
