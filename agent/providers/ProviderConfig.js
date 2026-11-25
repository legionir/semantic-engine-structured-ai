"use strict";

/*
|--------------------------------------------------------------------------
| Provider configuration (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Turns settings into provider specs; switching provider is a settings
| change only:
|
|   AGENT_PROVIDER            which adapter (default openai-compatible,
|                             the behaviour before P1-1)
|   AGENT_BASE_URL            endpoint; for a provider other than
|                             openai-compatible it is used only when the
|                             operator set it, otherwise the vendor's own
|                             endpoint applies
|   AGENT_API_KEY / AGENT_MODEL / AGENT_TEMPERATURE
|   AGENT_PROVIDER_REGION     Bedrock region
|   AZURE_OPENAI_API_VERSION
|   BEDROCK_ACCESS_KEY_ID / BEDROCK_SECRET_ACCESS_KEY / BEDROCK_SESSION_TOKEN
|   PROMPT_CACHING
|   PROVIDER_ROLES            JSON: { "planner": {...}, "coder": {...},
|                             "observer": {...} } - a model per role; an
|                             entry is a spec or "provider:model" / "model"
|   PROVIDER_FALLBACKS        JSON list of specs tried in order when the
|                             primary keeps failing
|   MAX_REQUEST_RETRIES / RETRY_BASE_MS / MAX_REQUEST_MS
|
| An entry for another provider never inherits the primary endpoint or
| credential: the operator's key is only sent where the operator sent it.
|--------------------------------------------------------------------------
*/

const settings = require("../config");
const { providerNames } = require("./ProviderRegistry");


function readJson(store, key) {

    const raw = store.get(key);

    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return null;
    }

    try {

        return JSON.parse(String(raw));

    } catch (error) {

        throw new Error(`${key} is not valid JSON: ${error.message}`);
    }
}


/* "anthropic:claude-x" -> { provider, model }; "gpt-x" -> { model } */
function parseShort(text) {

    const value = String(text || "").trim();

    const colon = value.indexOf(":");

    if (colon > 0 && providerNames().includes(value.slice(0, colon))) {
        return { provider: value.slice(0, colon), model: value.slice(colon + 1) };
    }

    return { model: value };
}


function primarySpec(store = settings) {

    const provider = store.get("AGENT_PROVIDER");

    const spec = {
        provider,
        origin: "primary",
        model: store.get("AGENT_MODEL"),
        apiKey: store.get("AGENT_API_KEY"),
        temperature: store.get("AGENT_TEMPERATURE"),
        region: store.get("AGENT_PROVIDER_REGION"),
        apiVersion: provider === "azure-openai" ? store.get("AZURE_OPENAI_API_VERSION") : undefined,
        accessKeyId: store.get("BEDROCK_ACCESS_KEY_ID"),
        secretAccessKey: store.get("BEDROCK_SECRET_ACCESS_KEY"),
        sessionToken: store.get("BEDROCK_SESSION_TOKEN"),
        promptCaching: store.get("PROMPT_CACHING"),
        timeoutMs: store.get("MAX_REQUEST_MS")
    };

    const explicitBaseUrl =
        typeof store.sourceOf === "function"
            ? store.sourceOf("AGENT_BASE_URL") !== "default"
            : true;

    if (provider === "openai-compatible" || explicitBaseUrl) {
        spec.baseUrl = store.get("AGENT_BASE_URL");
    }

    return spec;
}


function inherit(entry, primary, origin) {

    const raw = typeof entry === "string" ? parseShort(entry) : { ...(entry || {}) };

    const provider = raw.provider || primary.provider;

    const out = { ...raw, provider, origin };

    const sameEndpoint = provider === primary.provider && !raw.baseUrl;

    if (sameEndpoint) {

        out.baseUrl = primary.baseUrl;

        if (!raw.apiKey && !raw.accessKeyId) {

            out.apiKey = primary.apiKey;
            out.accessKeyId = primary.accessKeyId;
            out.secretAccessKey = primary.secretAccessKey;
            out.sessionToken = primary.sessionToken;
        }
    }

    if (!out.model) {

        if (provider !== primary.provider) {
            throw new Error(`a ${origin} entry for provider ${provider} needs a model`);
        }

        out.model = primary.model;
    }

    for (const key of ["temperature", "promptCaching", "timeoutMs", "region", "apiVersion"]) {

        if (out[key] === undefined && provider === primary.provider) {
            out[key] = primary[key];
        }
    }

    if (out.promptCaching === undefined) {
        out.promptCaching = primary.promptCaching;
    }

    if (out.timeoutMs === undefined) {
        out.timeoutMs = primary.timeoutMs;
    }

    if (!providerNames().includes(out.provider)) {
        throw new Error(`unknown provider "${out.provider}" in a ${origin} entry; known providers: ${providerNames().join(", ")}`);
    }

    return out;
}


function fromSettings(store = settings) {

    const primary = primarySpec(store);

    const roles = {};

    const rolesJson = readJson(store, "PROVIDER_ROLES");

    if (rolesJson !== null && (typeof rolesJson !== "object" || Array.isArray(rolesJson))) {
        throw new Error("PROVIDER_ROLES must be a JSON object of role -> provider spec");
    }

    for (const [role, entry] of Object.entries(rolesJson || {})) {

        const spec = inherit(entry, primary, "role");

        if (entry && typeof entry === "object" && Array.isArray(entry.fallbacks)) {
            spec.fallbacks = entry.fallbacks.map(item => inherit(item, spec, "fallback"));
        }

        roles[role] = spec;
    }

    const fallbacksJson = readJson(store, "PROVIDER_FALLBACKS");

    if (fallbacksJson !== null && !Array.isArray(fallbacksJson)) {
        throw new Error("PROVIDER_FALLBACKS must be a JSON list of provider specs");
    }

    return {
        primary,
        roles,
        fallbacks: (fallbacksJson || []).map(entry => inherit(entry, primary, "fallback")),
        retry: {
            maxRetries: store.get("MAX_REQUEST_RETRIES"),
            baseMs: store.get("RETRY_BASE_MS")
        }
    };
}


module.exports = {
    fromSettings,
    primarySpec,
    inherit,
    parseShort
};
