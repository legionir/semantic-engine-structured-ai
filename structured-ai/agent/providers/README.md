# Provider abstraction (roadmap P1-1)

One interface, `LLMProvider`, with an adapter per API. Every adapter takes the
OpenAI-style chat request the runtime already builds and answers in the
`chat.completion` shape, so `ActionParser`, `NativeToolCallAdapter` and
`ResponseRepair` work unchanged for all of them.

| `AGENT_PROVIDER`    | API                               | auth                         | stream          | tools | vision | prompt caching            | token count |
|---------------------|-----------------------------------|------------------------------|-----------------|-------|--------|---------------------------|-------------|
| `openai-compatible` | `{AGENT_BASE_URL}/chat/completions` (default, the behaviour before P1-1) | Bearer | SSE | yes | yes | server-dependent | estimate |
| `openai`            | Chat Completions                  | Bearer                       | SSE             | yes   | yes    | automatic                 | estimate    |
| `openai-responses`  | Responses (`/responses`, `store:false`) | Bearer                 | SSE             | yes   | yes    | automatic                 | estimate    |
| `anthropic`         | Messages (`/v1/messages`)         | `x-api-key`                  | SSE             | yes   | yes    | `cache_control` on system + tools | native |
| `gemini`            | `generateContent` (v1beta)        | `x-goog-api-key`             | SSE (`alt=sse`) | yes   | yes    | implicit                  | native      |
| `azure-openai`      | deployments chat completions, or `/openai/v1` | `api-key`        | SSE             | yes   | yes    | automatic                 | estimate    |
| `bedrock`           | Converse / ConverseStream         | Bedrock API key (Bearer) or IAM SigV4 | AWS event stream | yes | base64 images | `cachePoint` (Anthropic/Nova) | estimate |
| `ollama`            | native `/api/chat`                | none (Bearer if set)         | NDJSON          | yes   | yes    | none                      | estimate    |
| `openrouter`        | OpenAI-compatible gateway         | Bearer                       | SSE             | yes   | yes    | model-dependent           | estimate    |

## Settings

All values come from the settings store (environment, CLI flags, console), never
from a project file: `AGENT_PROVIDER`, `AGENT_PROVIDER_REGION` and the secret
settings below are locked by `WorkspaceTrust`.

- `AGENT_PROVIDER`, `AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`, `AGENT_TEMPERATURE`
  - for any provider other than `openai-compatible`, `AGENT_BASE_URL` is used only when
    it was set; otherwise the vendor endpoint applies.
- `AGENT_PROVIDER_REGION` (Bedrock), `AZURE_OPENAI_API_VERSION`
- `BEDROCK_ACCESS_KEY_ID`, `BEDROCK_SECRET_ACCESS_KEY`, `BEDROCK_SESSION_TOKEN` (secret; only
  needed without a Bedrock API key)
- `PROMPT_CACHING` (default on)
- `PROVIDER_ROLES` (secret, JSON): a model per role, e.g.

  ```json
  {
    "planner":  "anthropic:claude-opus-4-1",
    "coder":    { "provider": "openai", "model": "gpt-4.1", "apiKey": "..." },
    "observer": { "provider": "ollama", "model": "qwen2.5-coder:7b",
                  "fallbacks": ["openrouter:qwen/qwen-2.5-coder-32b-instruct"] }
  }
  ```

- `PROVIDER_FALLBACKS` (secret, JSON list): tried in order when the primary still fails.
- `MAX_REQUEST_RETRIES`, `RETRY_BASE_MS`, `MAX_REQUEST_MS`: retry and timeout policy.

An entry for a provider other than the primary one never inherits the primary
endpoint or key, and it must name its own model.

## Router

`createRouter().complete(request, { role, signal, onDelta })` retries 429, 5xx,
network errors and timeouts with exponential backoff and jitter (or exactly the
server's `Retry-After`), then moves to the next fallback. Cancelled requests and
streams that already produced output are not retried. The answer carries
`routing: { provider, model, role, attempts, fallback }`.

`chatCompletions(body, options)` accepts the body `RequestBuilder` produces, so
the agent loop can switch to the router without changing its request code.

## Tests

`test/p1/p11.test.js` runs every adapter against recorded answers in
`test/fixtures/providers.json` (chat, stream, tool call, 429, 5xx, prose-wrapped
actions). `ci/provider-smoke.js` runs one fixed scenario against real providers
whose credentials are present (nightly).
