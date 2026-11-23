"use strict";

/*
|--------------------------------------------------------------------------
| Provider router (roadmap P1-1)
|--------------------------------------------------------------------------
|
| complete(request, { role, signal, onDelta, timeoutMs }):
|
|   1. targets = the role's spec (PROVIDER_ROLES) or the primary, then
|      the role's own fallbacks or PROVIDER_FALLBACKS
|   2. per target up to MAX_REQUEST_RETRIES retries of a retryable error
|      (429, 5xx, network, timeout) with exponential backoff and jitter,
|      or exactly the server's Retry-After when it sent one
|   3. a non-retryable error, or retries used up, moves on to the next
|      target; aborts are never retried; a stream that already emitted
|      deltas is not retried (the caller has shown that output)
|   4. the answer carries routing: { provider, model, role, attempts,
|      fallback }; a final failure is the last ProviderError with
|      error.attempts listing every try
|
| chatCompletions(body, options) takes and returns the OpenAI chat body
| the runtime already builds (RequestBuilder), so the agent loop can
| switch to the router without changing its own request code.
|--------------------------------------------------------------------------
*/

const { createProvider } = require("./ProviderRegistry");
const { ProviderError, asProviderError } = require("./ProviderError");
const { fromSettings, inherit } = require("./ProviderConfig");


function abortedError(provider) {

    return new ProviderError(
        "the request was cancelled",
        { provider, code: "aborted", retryable: false }
    );
}


class ProviderRouter {

    constructor({ config, transport, sleep, random } = {}) {

        this.config = config || fromSettings();

        this.transport = transport;

        this.sleep =
            sleep ||
            (ms => new Promise(resolve => {

                const timer = setTimeout(resolve, ms);

                if (typeof timer.unref === "function") {
                    timer.unref();
                }
            }));

        this.random = random || Math.random;

        this.instances = new Map();
    }


    static fromSettings(options = {}) {

        return new ProviderRouter({
            ...options,
            config: fromSettings(options.settings)
        });
    }


    targets(role) {

        const main =
            (role && this.config.roles[role]) ||
            this.config.roles.default ||
            this.config.primary;

        const fallbacks =
            Array.isArray(main.fallbacks)
                ? main.fallbacks
                : (this.config.fallbacks || []).map(entry =>
                    entry.origin ? entry : inherit(entry, this.config.primary, "fallback")
                );

        return [main, ...fallbacks];
    }


    providerFor(spec) {

        const { fallbacks, ...plain } = spec;

        const key = JSON.stringify(plain);

        if (!this.instances.has(key)) {
            this.instances.set(key, createProvider(plain, { transport: this.transport }));
        }

        return this.instances.get(key);
    }


    backoff(attempt, error) {

        if (error && Number.isFinite(error.retryAfterMs)) {
            return Math.min(error.retryAfterMs, 60000);
        }

        const base = Number(this.config.retry && this.config.retry.baseMs) || 500;

        const delay = base * Math.pow(2, attempt);

        return Math.min(60000, Math.round(delay * (0.5 + this.random() / 2)));
    }


    modelFor(spec, request) {

        if (spec.origin === "primary" && request.model) {
            return request.model;
        }

        return spec.model || request.model;
    }


    async complete(request, options = {}) {

        const targets = this.targets(options.role);

        const configured = this.config.retry && this.config.retry.maxRetries;

        const attempts = [];

        let lastError = null;

        for (let index = 0; index < targets.length; index++) {

            const spec = targets[index];

            const provider = this.providerFor(spec);

            const retries =
                Number.isInteger(spec.maxRetries)
                    ? spec.maxRetries
                    : Number.isInteger(configured)
                        ? configured
                        : 2;

            const prepared = { ...request, model: this.modelFor(spec, request) };

            for (let attempt = 0; attempt <= retries; attempt++) {

                if (options.signal && options.signal.aborted) {
                    throw abortedError(provider.name);
                }

                let emitted = false;

                const onDelta =
                    typeof options.onDelta === "function"
                        ? delta => {
                            emitted = true;
                            options.onDelta({ ...delta, provider: provider.name });
                        }
                        : undefined;

                try {

                    const response =
                        await provider.complete(
                            { ...prepared, stream: prepared.stream === true || Boolean(onDelta) },
                            { signal: options.signal, onDelta, timeoutMs: options.timeoutMs }
                        );

                    attempts.push({ provider: provider.name, model: prepared.model, ok: true });

                    response.routing = {
                        provider: provider.name,
                        model: prepared.model,
                        role: options.role || null,
                        attempts: attempts.length,
                        fallback: index > 0
                    };

                    return response;

                } catch (caught) {

                    const error = asProviderError(caught, provider.name);

                    attempts.push({
                        provider: provider.name,
                        model: prepared.model,
                        ok: false,
                        status: error.status,
                        code: error.code
                    });

                    lastError = error;

                    if (error.code === "aborted" || (options.signal && options.signal.aborted)) {
                        error.attempts = attempts;
                        throw error;
                    }

                    if (emitted) {
                        error.attempts = attempts;
                        throw error;
                    }

                    if (!error.retryable || attempt === retries) {
                        break;
                    }

                    if (typeof options.onRetry === "function") {
                        options.onRetry({ provider: provider.name, attempt: attempt + 1, error });
                    }

                    await this.sleep(this.backoff(attempt, error));
                }
            }
        }

        if (lastError) {
            lastError.attempts = attempts;
            throw lastError;
        }

        throw new ProviderError("no provider is configured", { code: "no_provider", retryable: false });
    }


    /* OpenAI chat body in, chat.completion out. */
    chatCompletions(body = {}, options = {}) {

        return this.complete(
            {
                model: body.model,
                messages: body.messages,
                tools: body.tools,
                toolChoice: body.tool_choice,
                parallelToolCalls: body.parallel_tool_calls,
                responseFormat: body.response_format,
                maxTokens: body.max_tokens || body.max_completion_tokens,
                temperature: body.temperature,
                stream: body.stream === true
            },
            options
        );
    }


    async countTokens(request, options = {}) {

        const [spec] = this.targets(options.role);

        return this.providerFor(spec).countTokens({ ...request, model: this.modelFor(spec, request) });
    }


    /* The routing table without credentials, for doctor / the console. */
    describe() {

        const strip = spec => ({
            provider: spec.provider,
            model: spec.model,
            baseUrl: this.providerFor(spec).baseUrl,
            capabilities: this.providerFor(spec).capabilities()
        });

        const roles = {};

        for (const role of Object.keys(this.config.roles)) {
            roles[role] = this.targets(role).map(strip);
        }

        return {
            primary: this.targets(null).map(strip),
            roles
        };
    }
}


module.exports = {
    ProviderRouter
};
