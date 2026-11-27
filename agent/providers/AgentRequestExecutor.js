"use strict";

/* Provider request transport and schema-degradation policy extracted from
   agent.js. Runtime-specific behavior is injected at construction. */

const { httpTransport } = require("./HttpTransport");
const { fromSettings, inherit } = require("./ProviderConfig");
const { ProviderRouter } = require("./ProviderRouter");
const { providerNames } = require("./ProviderRegistry");
const { asProviderError } = require("./ProviderError");
const { logs: defaultLogs, clip } = require("../runtime/LogStore");

/* Where a request went, without credentials or query parameters. */
function describeEndpoint(url) {
    try {
        const parsed = new URL(String(url));
        return { endpoint: `${parsed.origin}${parsed.pathname}`, host: parsed.host };
    } catch {
        return { endpoint: "(invalid endpoint URL)", host: "unknown host" };
    }
}

function createAgentRequestExecutor(deps) {

    const transport = deps.transport || httpTransport;
    const logs = deps.logs || defaultLogs;
    const degradedSchemas = new Set();

    function schemaKeyFor(profile, role) {
        return `${role || "MAIN"}|${profile.endpoint}|${profile.model}`;
    }

    function responseFormatAllowed(key) {
        const mode = deps.settings.get("RESPONSE_FORMAT_MODE");
        if (mode === "never") return false;
        if (mode === "always") return true;
        return !degradedSchemas.has(key);
    }

    function mentionsSchemaRejection(text) {
        return /json_?schema|response_format|jsonschemavalidation|schema validation|invalid response for the expected schema/i
            .test(String(text || ""));
    }

    function hasMultiProviderConfig() {
        const provider = deps.settings.get("AGENT_PROVIDER");
        if (provider && provider !== "openai-compatible" && providerNames().includes(provider)) {
            return true;
        }
        const realStore = typeof deps.settings.definitionOf === "function";
        const roles = deps.settings.get("PROVIDER_ROLES");
        if (roles && String(roles).trim() !== "" && (realStore || String(roles).trim().startsWith("{"))) {
            return true;
        }
        const fallbacks = deps.settings.get("PROVIDER_FALLBACKS");
        if (fallbacks && String(fallbacks).trim() !== "" && (realStore || String(fallbacks).trim().startsWith("["))) {
            return true;
        }
        return false;
    }

    function applyRoleProfileOverrides(spec, profile, primaryProvider) {
        const out = { ...spec, maxRetries: 0 };
        const roleName = profile.role || "MAIN";
        const hasRoleBase = Boolean(deps.settings.get(`ENDPOINT_${roleName}_BASE_URL`));
        const hasRoleKey = Boolean(deps.settings.get(`ENDPOINT_${roleName}_API_KEY`));
        const hasRoleModel = Boolean(deps.settings.get(`ENDPOINT_${roleName}_MODEL`));
        const hasRoleTemp = Number(deps.settings.get(`ENDPOINT_${roleName}_TEMPERATURE`)) >= 0;

        if (out.provider === primaryProvider) {
            if (hasRoleBase) out.baseUrl = profile.base_url;
            if (hasRoleKey) out.apiKey = profile.api_key;
            if (hasRoleModel && !spec.origin) out.model = profile.model;
            if (out.origin === "primary" || out.origin === "role") {
                if (hasRoleModel) out.model = profile.model;
                if (hasRoleTemp) out.temperature = profile.temperature;
            }
        }
        if (Array.isArray(out.fallbacks)) {
            out.fallbacks = out.fallbacks.map(fb => ({ ...fb, maxRetries: 0 }));
        }
        return out;
    }

    async function sendAgentRequest(options) {
        const { agentDefinition, responseFormat, role } = options;
        const profile = deps.endpointFor(role, agentDefinition);
        const key = schemaKeyFor(profile, role);

        try {
            return await performAgentRequest(options, profile, key);
        } catch (error) {
            if (!error.schema_rejected || responseFormat === null || degradedSchemas.has(key)) {
                throw error;
            }

            degradedSchemas.add(key);
            deps.logLine(
                options.scope,
                `The endpoint rejected the response schema; continuing without it for ${profile.model}`
            );
            deps.events.emit("endpoint:degraded", {
                role: role || "MAIN",
                model: profile.model,
                endpoint: profile.endpoint,
                reason: error.message.slice(0, 200),
                dropped: "response_format"
            });

            return performAgentRequest(options, profile, key);
        }
    }

    async function performRoutedRequest({
        request,
        profile,
        role,
        agent,
        waitingSince,
        requestSignal,
        finishWaiting,
        failureContext
    }) {
        const baseConfig = fromSettings(deps.settings);
        const primaryProvider = baseConfig.primary.provider;
        const roles = {};
        for (const [k, v] of Object.entries(baseConfig.roles || {})) {
            roles[k] = applyRoleProfileOverrides(v, profile, primaryProvider);
        }
        const config = {
            ...baseConfig,
            primary: applyRoleProfileOverrides(baseConfig.primary, profile, primaryProvider),
            roles,
            fallbacks: (baseConfig.fallbacks || []).map(fb =>
                applyRoleProfileOverrides(
                    fb.origin ? fb : inherit(fb, baseConfig.primary, "fallback"),
                    profile,
                    primaryProvider
                )
            ),
            retry: { ...baseConfig.retry, maxRetries: 0 }
        };

        const router = new ProviderRouter({ config, transport });
        const roleKey = role || "MAIN";
        let data;

        try {
            data = await router.complete(
                {
                    model: request.model,
                    messages: request.messages,
                    tools: request.tools,
                    toolChoice: request.tool_choice,
                    parallelToolCalls: request.parallel_tool_calls,
                    responseFormat: request.response_format,
                    maxTokens: request.max_tokens || request.max_completion_tokens,
                    temperature: request.temperature,
                    stream: false
                },
                {
                    role: roleKey,
                    signal: requestSignal.signal
                }
            );
        } catch (caught) {
            const err = asProviderError(caught, primaryProvider);
            if (err.code === "aborted" || err.name === "AbortError") {
                const aborted = new Error(`Model request aborted: ${requestSignal.reason || err.message || "unknown reason"}`);
                aborted.retryable = !deps.isRunCancelled();
                finishWaiting("aborted");
                logs.record(
                    deps.isRunCancelled() ? "info" : "warn",
                    "ai",
                    `AI request aborted (${profile.model}): ${requestSignal.reason || "unknown reason"}`,
                    failureContext({ provider: err.provider || primaryProvider, retryable: aborted.retryable })
                );
                throw aborted;
            }

            finishWaiting(err.status ? `http ${err.status}` : "failed");
            const failure = new Error(
                err.status
                    ? `API Error ${err.status}: ${String(err.message || "").slice(0, 300)}`
                    : String(err.message || "Model request failed")
            );
            if (err.status) failure.status = err.status;
            failure.retryable = err.retryable === true || (err.status ? deps.isRetryableStatus(err.status) : true);
            if (Number.isFinite(err.retryAfterMs)) {
                failure.retryAfter = String(err.retryAfterMs / 1000);
            }
            failure.schema_rejected = Boolean(request.response_format) && mentionsSchemaRejection(err.message);
            logs.error(
                "ai",
                `AI request failed${err.status ? `: HTTP ${err.status}` : ""} (${err.provider || primaryProvider}, ${profile.model})`,
                failureContext({
                    provider: err.provider || primaryProvider,
                    status: err.status,
                    code: err.code,
                    retryable: failure.retryable,
                    retry_after: failure.retryAfter || undefined,
                    schema_rejected: failure.schema_rejected || undefined,
                    response: clip(err.message || "", 4000)
                })
            );
            throw failure;
        } finally {
            requestSignal.release();
        }

        finishWaiting("answered");
        if (typeof deps.recordUsage === "function" && data && data.usage) {
            deps.recordUsage({ model: data.model || profile.model, usage: data.usage, agent, role: roleKey });
        }
        return data;
    }

    async function performAgentRequest({
        messages,
        agentDefinition,
        tools,
        responseFormat,
        timeoutMs,
        role,
        reasoning_effort
    }, profile, schemaKey) {
        const request = deps.buildAgentRequest({
            messages,
            agentDefinition,
            tools,
            responseFormat,
            role,
            reasoningEffort: reasoning_effort,
            withSchema: responseFormatAllowed(schemaKey)
        });

        deps.assertRunActive("model request");
        const waitingSince = Date.now();
        const agent = role === "SUMMARY" ? "summariser" : agentDefinition?.name || "main_agent";

        deps.events.emit("request:start", { agent, role: role || "MAIN", model: profile.model });

        const finishWaiting = outcome => deps.events.emit("request:end", {
            agent,
            role: role || "MAIN",
            outcome,
            duration_ms: Date.now() - waitingSince
        });

        /* what every failure record says about the request */
        const target = describeEndpoint(profile.endpoint);
        const failureContext = extra => ({
            agent,
            role: role || "MAIN",
            model: profile.model,
            provider: profile.provider || target.host,
            endpoint: target.endpoint,
            duration_ms: Date.now() - waitingSince,
            ...extra
        });

        const requestSignal = deps.createRequestSignal(timeoutMs);

        if (hasMultiProviderConfig()) {
            return performRoutedRequest({
                request,
                profile,
                role,
                agent,
                waitingSince,
                requestSignal,
                finishWaiting,
                failureContext
            });
        }

        let response;
        let text;

        try {
            response = await transport.request({
                url: profile.endpoint,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${profile.api_key}`
                },
                body: JSON.stringify(request),
                signal: requestSignal.signal
            });
            text = await response.text();
        } catch (error) {
            if (error.name === "AbortError") {
                const aborted = new Error(`Model request aborted: ${requestSignal.reason || "unknown reason"}`);
                aborted.retryable = !deps.isRunCancelled();
                finishWaiting("aborted");
                logs.record(
                    deps.isRunCancelled() ? "info" : "warn",
                    "ai",
                    `AI request aborted (${profile.model}): ${requestSignal.reason || "unknown reason"}`,
                    failureContext({ retryable: aborted.retryable })
                );
                throw aborted;
            }

            error.retryable = true;
            finishWaiting("failed");
            const cause = error.cause && (error.cause.message || error.cause.code);
            logs.error(
                "ai",
                `AI request to ${target.host} failed (${profile.model}): ${error.message}${cause && cause !== error.message ? ` — ${cause}` : ""}`,
                failureContext({ code: error.code || error.cause?.code, cause, retryable: true })
            );
            throw error;
        } finally {
            requestSignal.release();
        }

        const responseOk = response.status >= 200 && response.status < 300;
        finishWaiting(responseOk ? "answered" : `http ${response.status}`);

        let data;
        let parsed = true;
        try {
            data = JSON.parse(text);
        } catch {
            parsed = false;
            data = text;
        }

        if (!responseOk) {
            const failure = new Error(`API Error ${response.status}: ${(parsed ? JSON.stringify(data) : data).slice(0, 300)}`);
            failure.status = response.status;
            failure.retryable = deps.isRetryableStatus(response.status);
            failure.retryAfter = response.header("retry-after");
            failure.schema_rejected = Boolean(request.response_format) && mentionsSchemaRejection(text);
            logs.error(
                "ai",
                `AI request failed: HTTP ${response.status} from ${target.host} (${profile.model})`,
                failureContext({
                    status: response.status,
                    retryable: failure.retryable,
                    retry_after: failure.retryAfter || undefined,
                    schema_rejected: failure.schema_rejected || undefined,
                    response: clip(text, 4000)
                })
            );
            throw failure;
        }

        if (!parsed) {
            logs.error(
                "ai",
                `AI response from ${target.host} is not valid JSON (${profile.model})`,
                failureContext({ status: response.status, response: clip(text, 4000) })
            );
            throw new Error(`Invalid JSON response: ${text}`);
        }

        /* P3-05: what the response cost, against the run's cap */
        if (typeof deps.recordUsage === "function" && data && data.usage) {
            deps.recordUsage({ model: data.model || profile.model, usage: data.usage, agent, role: role || "MAIN" });
        }

        return data;
    }

    return {
        sendAgentRequest,
        performAgentRequest,
        schemaKeyFor,
        responseFormatAllowed,
        mentionsSchemaRejection,
        degradedSchemas
    };
}


module.exports = { createAgentRequestExecutor };
