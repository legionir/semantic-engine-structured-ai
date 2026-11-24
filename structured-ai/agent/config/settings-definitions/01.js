"use strict";

module.exports = [
    {
        "key": "AGENT_BASE_URL",
        "group": "endpoint",
        "type": "string",
        "default": "http://localhost:4414/p/smart_routing/v1",
        "description": "Base URL of the OpenAI compatible endpoint."
    },
    {
        "key": "AGENT_API_KEY",
        "group": "endpoint",
        "type": "string",
        "default": "your-api-key",
        "secret": true,
        "description": "Bearer token sent with every request."
    },
    {
        "key": "AGENT_MODEL",
        "group": "endpoint",
        "type": "string",
        "default": "auto-switch",
        "description": "Model requested when a profile does not name one."
    },
    {
        "key": "AGENT_CONSOLE_TOKEN",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "Bearer token for the web console control plane. Empty generates a token at startup."
    },
    {
        "key": "AGENT_CONSOLE_TOKENS",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "JSON map of extra console tokens to { allowedProjects, permissions } (Phase 9). The AGENT_CONSOLE_TOKEN itself remains a master token."
    },
    {
        "key": "AGENT_TEMPERATURE",
        "group": "endpoint",
        "type": "number",
        "default": 0.2,
        "min": 0,
        "max": 2,
        "description": "Sampling temperature used when a profile does not set one."
    },
    {
        "key": "RESPONSE_FORMAT_MODE",
        "group": "endpoint",
        "type": "enum",
        "values": [
            "auto",
            "always",
            "never"
        ],
        "default": "auto",
        "description": "Whether to send response_format. auto stops sending it to an endpoint that rejected it, always keeps sending it, never leaves it out from the start."
    },
    {
        "key": "AGENT_SCHEMA",
        "group": "endpoint",
        "type": "enum",
        "values": [
            "default",
            "strict"
        ],
        "default": "default",
        "fixed": true,
        "description": "Which response schema file to send. Read once at startup."
    },
    {
        "key": "AGENT_PROVIDER",
        "group": "endpoint",
        "type": "enum",
        "values": [
            "openai-compatible",
            "openai",
            "openai-responses",
            "anthropic",
            "gemini",
            "azure-openai",
            "bedrock",
            "ollama",
            "openrouter"
        ],
        "default": "openai-compatible",
        "description": "Which LLM API the endpoint speaks (roadmap P1-1). openai-compatible keeps AGENT_BASE_URL as is; for any other provider AGENT_BASE_URL is used only when set, otherwise the vendor endpoint applies."
    },
    {
        "key": "AGENT_PROVIDER_REGION",
        "group": "endpoint",
        "type": "string",
        "default": "us-east-1",
        "description": "AWS region of the bedrock provider (bedrock-runtime.<region>.amazonaws.com)."
    },
    {
        "key": "AZURE_OPENAI_API_VERSION",
        "group": "endpoint",
        "type": "string",
        "default": "2024-10-21",
        "description": "api-version sent to Azure OpenAI deployments. Not used with a /openai/v1 base URL."
    },
    {
        "key": "BEDROCK_ACCESS_KEY_ID",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "IAM access key id for the bedrock provider (SigV4). Not needed with a Bedrock API key in AGENT_API_KEY."
    },
    {
        "key": "BEDROCK_SECRET_ACCESS_KEY",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "IAM secret access key for the bedrock provider (SigV4)."
    },
    {
        "key": "BEDROCK_SESSION_TOKEN",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "Session token for temporary IAM credentials of the bedrock provider."
    },
    {
        "key": "PROMPT_CACHING",
        "group": "endpoint",
        "type": "boolean",
        "default": true,
        "description": "Mark the stable prompt prefix (system prompt, tool list) for caching where the provider needs it marked (Anthropic, Bedrock). OpenAI and Gemini cache automatically."
    },
    {
        "key": "PROVIDER_ROLES",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "JSON map of role (planner, coder, observer, ...) to a provider spec {provider, model, baseUrl, apiKey, fallbacks} or \"provider:model\". Empty uses the primary endpoint for every role."
    },
    {
        "key": "PROVIDER_FALLBACKS",
        "group": "endpoint",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "JSON list of provider specs tried in order when the primary still fails after MAX_REQUEST_RETRIES. An entry for another provider must name its own model and key."
    },
    {
        "key": "ENDPOINT_MAIN_BASE_URL",
        "group": "endpoint.main",
        "type": "string",
        "default": "",
        "description": "Base URL for the root orchestrator. Empty inherits AGENT_BASE_URL."
    },
    {
        "key": "ENDPOINT_MAIN_API_KEY",
        "group": "endpoint.main",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "API key for the root orchestrator. Empty inherits AGENT_API_KEY."
    },
    {
        "key": "ENDPOINT_MAIN_MODEL",
        "group": "endpoint.main",
        "type": "string",
        "default": "",
        "description": "Model for the root orchestrator. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        "key": "ENDPOINT_MAIN_CONTEXT_TOKENS",
        "group": "endpoint.main",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2000000,
        "description": "Configured token context window for the main endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS."
    },
    {
        "key": "ENDPOINT_MAIN_TEMPERATURE",
        "group": "endpoint.main",
        "type": "number",
        "default": -1,
        "min": -1,
        "max": 2,
        "description": "Temperature for the root orchestrator. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        "key": "ENDPOINT_L1_BASE_URL",
        "group": "endpoint.l1",
        "type": "string",
        "default": "",
        "description": "Base URL for sub-agents at depth 1. Empty inherits AGENT_BASE_URL."
    },
    {
        "key": "ENDPOINT_L1_API_KEY",
        "group": "endpoint.l1",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "API key for sub-agents at depth 1. Empty inherits AGENT_API_KEY."
    },
    {
        "key": "ENDPOINT_L1_MODEL",
        "group": "endpoint.l1",
        "type": "string",
        "default": "",
        "description": "Model for sub-agents at depth 1. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        "key": "ENDPOINT_L1_CONTEXT_TOKENS",
        "group": "endpoint.l1",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2000000,
        "description": "Configured token context window for the l1 endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS."
    },
    {
        "key": "ENDPOINT_L1_TEMPERATURE",
        "group": "endpoint.l1",
        "type": "number",
        "default": -1,
        "min": -1,
        "max": 2,
        "description": "Temperature for sub-agents at depth 1. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        "key": "ENDPOINT_L2_BASE_URL",
        "group": "endpoint.l2",
        "type": "string",
        "default": "",
        "description": "Base URL for sub-agents at depth 2. Empty inherits AGENT_BASE_URL."
    },
    {
        "key": "ENDPOINT_L2_API_KEY",
        "group": "endpoint.l2",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "API key for sub-agents at depth 2. Empty inherits AGENT_API_KEY."
    },
    {
        "key": "ENDPOINT_L2_MODEL",
        "group": "endpoint.l2",
        "type": "string",
        "default": "",
        "description": "Model for sub-agents at depth 2. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        "key": "ENDPOINT_L2_CONTEXT_TOKENS",
        "group": "endpoint.l2",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2000000,
        "description": "Configured token context window for the l2 endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS."
    },
    {
        "key": "ENDPOINT_L2_TEMPERATURE",
        "group": "endpoint.l2",
        "type": "number",
        "default": -1,
        "min": -1,
        "max": 2,
        "description": "Temperature for sub-agents at depth 2. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        "key": "ENDPOINT_L3_BASE_URL",
        "group": "endpoint.l3",
        "type": "string",
        "default": "",
        "description": "Base URL for sub-agents at depth 3 and deeper. Empty inherits AGENT_BASE_URL."
    },
    {
        "key": "ENDPOINT_L3_API_KEY",
        "group": "endpoint.l3",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "API key for sub-agents at depth 3 and deeper. Empty inherits AGENT_API_KEY."
    },
    {
        "key": "ENDPOINT_L3_MODEL",
        "group": "endpoint.l3",
        "type": "string",
        "default": "",
        "description": "Model for sub-agents at depth 3 and deeper. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        "key": "ENDPOINT_L3_CONTEXT_TOKENS",
        "group": "endpoint.l3",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2000000,
        "description": "Configured token context window for the l3 endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS."
    },
    {
        "key": "ENDPOINT_L3_TEMPERATURE",
        "group": "endpoint.l3",
        "type": "number",
        "default": -1,
        "min": -1,
        "max": 2,
        "description": "Temperature for sub-agents at depth 3 and deeper. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        "key": "ENDPOINT_SUMMARY_BASE_URL",
        "group": "endpoint.summary",
        "type": "string",
        "default": "",
        "description": "Base URL for the context summariser. Empty inherits AGENT_BASE_URL."
    },
    {
        "key": "ENDPOINT_SUMMARY_API_KEY",
        "group": "endpoint.summary",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "API key for the context summariser. Empty inherits AGENT_API_KEY."
    },
    {
        "key": "ENDPOINT_SUMMARY_MODEL",
        "group": "endpoint.summary",
        "type": "string",
        "default": "",
        "description": "Model for the context summariser. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        "key": "ENDPOINT_SUMMARY_CONTEXT_TOKENS",
        "group": "endpoint.summary",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2000000,
        "description": "Configured token context window for the summary endpoint model; 0 inherits CONTEXT_WINDOW_TOKENS."
    },
    {
        "key": "ENDPOINT_SUMMARY_TEMPERATURE",
        "group": "endpoint.summary",
        "type": "number",
        "default": -1,
        "min": -1,
        "max": 2,
        "description": "Temperature for the context summariser. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        "key": "MAX_ITERATIONS",
        "group": "budget",
        "type": "number",
        "default": 50,
        "min": 1,
        "max": 1000,
        "description": "Iterations one agent may spend."
    },
    {
        "key": "MAX_RUN_MS",
        "group": "budget",
        "type": "number",
        "default": 600000,
        "min": 1000,
        "description": "Wall clock budget for a whole run."
    },
    {
        "key": "MAX_REQUEST_MS",
        "group": "budget",
        "type": "number",
        "default": 120000,
        "min": 1000,
        "description": "Timeout for a single model request."
    },
    {
        "key": "MAX_REQUEST_RETRIES",
        "group": "budget",
        "type": "number",
        "default": 3,
        "min": 0,
        "max": 10,
        "description": "Retries after a transient endpoint failure."
    },
    {
        "key": "RETRY_BASE_MS",
        "group": "budget",
        "type": "number",
        "default": 500,
        "min": 10,
        "description": "Base delay for the retry backoff."
    }
];
