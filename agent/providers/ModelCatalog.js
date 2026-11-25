"use strict";

const settings = require("../config");
const { httpTransport } = require("./HttpTransport");
const { signRequest } = require("./AwsSigV4");

const ROLES = new Set(["MAIN", "L1", "L2", "L3", "SUMMARY"]);
const DEFAULT_BASE_URLS = Object.freeze({
    openai: "https://api.openai.com/v1",
    "openai-responses": "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com",
    "azure-openai": "",
    bedrock: "",
    ollama: "http://localhost:11434",
    openrouter: "https://openrouter.ai/api/v1"
});


function appendPath(baseUrl, suffix) {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
    url.hash = "";
    return url;
}


function modelNames(payload) {
    const entries = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
            ? payload.models
            : Array.isArray(payload?.modelSummaries)
                ? payload.modelSummaries
                : [];

    return [...new Set(entries
        .map(item => String(item?.id || item?.name || item?.modelId || "").replace(/^models\//, ""))
        .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}


function requestFor({ provider, baseUrl, apiKey, store }) {
    const headers = { accept: "application/json" };
    let url;

    if (["openai-compatible", "openai", "openai-responses", "openrouter"].includes(provider)) {
        url = appendPath(baseUrl, "models");
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    } else if (provider === "anthropic") {
        const suffix = new URL(baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1")
            ? "models"
            : "v1/models";
        url = appendPath(baseUrl, suffix);
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
    } else if (provider === "gemini") {
        const path = new URL(baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1beta")
            ? "models"
            : "v1beta/models";
        url = appendPath(baseUrl, path);
        if (apiKey) headers["x-goog-api-key"] = apiKey;
    } else if (provider === "azure-openai") {
        const base = new URL(baseUrl);
        if (base.pathname.replace(/\/+$/, "").endsWith("/openai/v1")) {
            url = appendPath(baseUrl, "models");
        } else {
            url = appendPath(baseUrl, "openai/models");
            url.searchParams.set("api-version", store.get("AZURE_OPENAI_API_VERSION"));
        }
        if (apiKey) headers["api-key"] = apiKey;
    } else if (provider === "ollama") {
        const base = new URL(baseUrl);
        base.pathname = base.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
        url = appendPath(base.href, "api/tags");
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    } else if (provider === "bedrock") {
        const region = store.get("AGENT_PROVIDER_REGION") || "us-east-1";
        url = new URL(`https://bedrock.${region}.amazonaws.com/foundation-models`);
        const accessKeyId = store.get("BEDROCK_ACCESS_KEY_ID");
        const secretAccessKey = store.get("BEDROCK_SECRET_ACCESS_KEY");
        if (apiKey) {
            headers.authorization = `Bearer ${apiKey}`;
        } else {
            if (!accessKeyId || !secretAccessKey) {
                throw new Error("Bedrock model discovery requires AGENT_API_KEY or BEDROCK_ACCESS_KEY_ID and BEDROCK_SECRET_ACCESS_KEY.");
            }
            Object.assign(headers, signRequest({
                method: "GET",
                url: url.href,
                headers,
                region,
                service: "bedrock",
                accessKeyId,
                secretAccessKey,
                sessionToken: store.get("BEDROCK_SESSION_TOKEN") || undefined
            }));
        }
    } else {
        throw new Error(`Model discovery is not supported for provider "${provider}".`);
    }

    return { url: url.href, headers };
}


async function listModels({ role = "MAIN", settingsStore = settings, transport = httpTransport } = {}) {
    const roleName = String(role).toUpperCase();
    if (!ROLES.has(roleName)) throw new Error("role must be MAIN, L1, L2, L3 or SUMMARY.");

    const provider = settingsStore.get("AGENT_PROVIDER");
    const roleBase = settingsStore.get(`ENDPOINT_${roleName}_BASE_URL`);
    const configuredBase = roleBase || settingsStore.get("AGENT_BASE_URL");
    const baseIsDefault = typeof settingsStore.sourceOf === "function" &&
        settingsStore.sourceOf("AGENT_BASE_URL") === "default";
    const baseUrl = roleBase || (provider === "openai-compatible" || !baseIsDefault
        ? configuredBase
        : DEFAULT_BASE_URLS[provider]);

    if (!baseUrl) throw new Error(`Set ENDPOINT_${roleName}_BASE_URL or AGENT_BASE_URL before loading models.`);

    const apiKey = settingsStore.get(`ENDPOINT_${roleName}_API_KEY`) || settingsStore.get("AGENT_API_KEY");
    const request = requestFor({ provider, baseUrl, apiKey, store: settingsStore });
    const response = await transport.request({
        method: "GET",
        url: request.url,
        headers: request.headers,
        timeoutMs: 20000
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`The ${provider} model endpoint returned HTTP ${response.status}.`);
    }

    let payload;
    try {
        payload = JSON.parse(await response.text());
    } catch {
        throw new Error(`The ${provider} model endpoint did not return valid JSON.`);
    }

    return modelNames(payload);
}


module.exports = { listModels, modelNames, requestFor, appendPath, ROLES };
