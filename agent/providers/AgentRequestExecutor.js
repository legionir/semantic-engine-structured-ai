"use strict";

/* Provider request transport and schema-degradation policy extracted from
   agent.js. Runtime-specific behavior is injected at construction. */

function createAgentRequestExecutor(deps) {

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

    async function performAgentRequest({
        messages,
        agentDefinition,
        tools,
        responseFormat,
        timeoutMs,
        role
    }, profile, schemaKey) {
        const request = deps.buildAgentRequest({
            messages,
            agentDefinition,
            tools,
            responseFormat,
            role,
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

        const requestSignal = deps.createRequestSignal(timeoutMs);
        let response;
        let text;

        try {
            response = await fetch(profile.endpoint, {
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
                throw aborted;
            }

            error.retryable = true;
            finishWaiting("failed");
            throw error;
        } finally {
            requestSignal.release();
        }

        finishWaiting(response.ok ? "answered" : `http ${response.status}`);

        let data;
        let parsed = true;
        try {
            data = JSON.parse(text);
        } catch {
            parsed = false;
            data = text;
        }

        if (!response.ok) {
            const failure = new Error(`API Error ${response.status}: ${(parsed ? JSON.stringify(data) : data).slice(0, 300)}`);
            failure.status = response.status;
            failure.retryable = deps.isRetryableStatus(response.status);
            failure.retryAfter = response.headers.get("retry-after");
            failure.schema_rejected = Boolean(request.response_format) && mentionsSchemaRejection(text);
            throw failure;
        }

        if (!parsed) {
            throw new Error(`Invalid JSON response: ${text}`);
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
