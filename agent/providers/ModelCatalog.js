"use strict";

const crypto = require("crypto");
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
const catalogCache = new Map();


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
                throw Object.assign(
                    new Error("Bedrock model discovery requires AGENT_API_KEY or BEDROCK_ACCESS_KEY_ID and BEDROCK_SECRET_ACCESS_KEY."),
                    { status: 400 }
                );
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
        throw Object.assign(
            new Error(`Model discovery is not supported for provider "${provider}".`),
            { status: 400 }
        );
    }

    return { url: url.href, headers };
}


function requestCacheKey(provider, request, store) {

    const headers = { ...request.headers };
    const isIamSigned = provider === "bedrock" &&
        String(headers.authorization || "").startsWith("AWS4-HMAC-SHA256");

    if (isIamSigned) {
        /* SigV4 timestamps/signatures vary per request; identity is the
           credential set and target, not the ephemeral signature. */
        delete headers.authorization;
        delete headers["x-amz-date"];
        delete headers["x-amz-security-token"];
    }

    const identity = {
        provider,
        url: request.url,
        headers,
        iam: isIamSigned
            ? {
                accessKeyId: store.get("BEDROCK_ACCESS_KEY_ID"),
                secretAccessKey: store.get("BEDROCK_SECRET_ACCESS_KEY"),
                sessionToken: store.get("BEDROCK_SESSION_TOKEN")
            }
            : null
    };

    return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}


async function fetchModelsForRequest({ provider, request, settingsStore, transport }) {

    const key = requestCacheKey(provider, request, settingsStore);
    const cached = catalogCache.get(key);

    if (cached && cached.transport === transport && cached.expiresAt > Date.now()) {
        return cached.promise;
    }

    const entry = { transport, expiresAt: Infinity, promise: null };

    entry.promise = (async () => {
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
    })().then(
        models => {
            entry.expiresAt = Infinity;
            return models;
        },
        error => {
            /* Avoid retry storms on an unavailable endpoint. A changed
               endpoint/key gets a different cache key immediately. */
            entry.expiresAt = Date.now() + 10000;
            throw error;
        }
    );

    catalogCache.set(key, entry);
    return entry.promise;
}


function endpointForRole(role, settingsStore) {
    const provider = settingsStore.get("AGENT_PROVIDER");
    const roleBase = settingsStore.get(`ENDPOINT_${role}_BASE_URL`);
    const configuredBase = roleBase || settingsStore.get("AGENT_BASE_URL");
    const baseIsDefault = typeof settingsStore.sourceOf === "function" &&
        settingsStore.sourceOf("AGENT_BASE_URL") === "default";
    const baseUrl = roleBase || (provider === "openai-compatible" || !baseIsDefault
        ? configuredBase
        : DEFAULT_BASE_URLS[provider]);

    if (!baseUrl) {
        throw Object.assign(
            new Error(`Set ENDPOINT_${role}_BASE_URL or AGENT_BASE_URL before loading models.`),
            { status: 400 }
        );
    }

    const apiKey = settingsStore.get(`ENDPOINT_${role}_API_KEY`) || settingsStore.get("AGENT_API_KEY");
    return { provider, request: requestFor({ provider, baseUrl, apiKey, store: settingsStore }) };
}


async function listModels({ role = "MAIN", settingsStore = settings, transport = httpTransport } = {}) {
    const roleName = String(role).toUpperCase();
    if (!ROLES.has(roleName)) {
        throw Object.assign(new Error("role must be MAIN, L1, L2, L3 or SUMMARY."), { status: 400 });
    }

    const endpoint = endpointForRole(roleName, settingsStore);
    return fetchModelsForRequest({ ...endpoint, settingsStore, transport });
}


async function listModelCatalog({ settingsStore = settings, transport = httpTransport } = {}) {

    const byRole = Object.create(null);
    const errors = Object.create(null);
    const statuses = Object.create(null);
    let mainModels = [];

    try {
        mainModels = await listModels({ role: "MAIN", settingsStore, transport });
        byRole.MAIN = mainModels;
    } catch (error) {
        errors.MAIN = error.message;
        statuses.MAIN = error.status || 502;
        byRole.MAIN = [];
    }

    const explicitRoles = [...ROLES].filter(role =>
        role !== "MAIN" && (
            settingsStore.get(`ENDPOINT_${role}_BASE_URL`) ||
            settingsStore.get(`ENDPOINT_${role}_API_KEY`)
        )
    );

    await Promise.all([...ROLES].filter(role => role !== "MAIN").map(async role => {
        if (!explicitRoles.includes(role)) {
            byRole[role] = mainModels;
            return;
        }

        try {
            byRole[role] = await listModels({ role, settingsStore, transport });
        } catch (error) {
            errors[role] = error.message;
            statuses[role] = error.status || 502;
            byRole[role] = mainModels;
        }
    }));

    if (Object.values(byRole).every(models => models.length === 0)) {
        const allStatuses = Object.values(statuses);
        const status = allStatuses.length > 0 && allStatuses.every(code => code === 400) ? 400 : 502;
        throw Object.assign(
            new Error(errors.MAIN || Object.values(errors)[0] || "No model catalog is available."),
            { status }
        );
    }

    return { models: mainModels, byRole, errors };
}


function clearModelCatalogCache() {
    catalogCache.clear();
}


module.exports = {
    listModels,
    listModelCatalog,
    clearModelCatalogCache,
    modelNames,
    requestFor,
    appendPath,
    ROLES
};
