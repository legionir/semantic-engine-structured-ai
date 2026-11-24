"use strict";

/*
|--------------------------------------------------------------------------
| Azure OpenAI (roadmap P1-1)
|--------------------------------------------------------------------------
|
| baseUrl is the resource endpoint, https://<resource>.openai.azure.com.
| The model is the deployment name (spec.deployment overrides it):
|
|   {baseUrl}/openai/deployments/{deployment}/chat/completions
|       ?api-version={AZURE_OPENAI_API_VERSION}
|
| A baseUrl that already ends in /openai/v1 uses the version-less v1 API
| ({baseUrl}/chat/completions, model in the body). Auth is the api-key
| header.
|--------------------------------------------------------------------------
*/

const { OpenAIChatProvider } = require("./OpenAIChatProvider");


class AzureOpenAIProvider extends OpenAIChatProvider {

    defaultBaseUrl() {
        return "";
    }


    endpoint(request) {

        const base = this.requireBaseUrl();

        if (/\/openai\/v1$/.test(base)) {
            return `${base}/chat/completions`;
        }

        const deployment = this.spec.deployment || request.model;

        const version = this.spec.apiVersion || "2024-10-21";

        return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(version)}`;
    }


    authHeaders() {
        return this.apiKey ? { "api-key": this.apiKey } : {};
    }
}

AzureOpenAIProvider.providerName = "azure-openai";


module.exports = {
    AzureOpenAIProvider
};
