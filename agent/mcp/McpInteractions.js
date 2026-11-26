"use strict";

/*
|--------------------------------------------------------------------------
| Server-to-client MCP requests (roadmap P4-10)
|--------------------------------------------------------------------------
|
|   elicitation/create      a server asks the user something mid-call. The
|                           question waits in the console (event
|                           mcp:elicitation, GET /api/mcp/elicitations) until
|                           it is answered accept / decline / cancel, or
|                           MCP_ELICITATION_TIMEOUT_MS passes (cancel). An
|                           accepted answer is checked against the server's
|                           requestedSchema first.
|
|   sampling/createMessage  a server asks this runtime's model for a
|                           completion. Only when MCP_SAMPLING_ENABLED is on
|                           and the server's definition says sampling: true;
|                           each answer is capped at MCP_SAMPLING_MAX_TOKENS
|                           and each server at MCP_SAMPLING_BUDGET_TOKENS for
|                           the life of the process.
|
|   notifications/progress  becomes the event mcp:progress, which the
|                           console shows on the running call.
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");

const settings = require("../config");


function emit(type, payload) {

    try {
        require("../events").emit(type, payload);
    } catch {
        /* events are best-effort */
    }
}


/* ------------------------------------------------------------ elicitation */

const pendingElicitations = new Map();

/* set by the console when it starts: without one, nobody could answer */
let interactive = false;


function setInteractive(value) {

    interactive = value === true;
}


function pending() {

    return [...pendingElicitations.values()].map(item => item.view);
}


const PRIMITIVES = new Set(["string", "number", "integer", "boolean"]);


/* the flat form the specification allows: primitive properties only */
function checkSchema(schema) {

    if (!schema || typeof schema !== "object" || schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
        throw Object.assign(new Error("requestedSchema must be an object schema with properties"), { code: -32602 });
    }

    for (const [key, property] of Object.entries(schema.properties)) {
        if (!property || !PRIMITIVES.has(property.type)) {
            throw Object.assign(new Error(`requestedSchema.${key} must be a string, number, integer or boolean`), { code: -32602 });
        }
    }

    return schema;
}


function validateContent(schema, content) {

    if (!content || typeof content !== "object" || Array.isArray(content)) {
        throw Object.assign(new Error("an accepted answer needs content: an object of the requested fields"), { status: 400 });
    }

    const out = {};

    for (const [key, property] of Object.entries(schema.properties)) {

        let value = content[key];

        if (value === undefined || value === null || value === "") {
            if ((schema.required || []).includes(key)) {
                throw Object.assign(new Error(`"${property.title || key}" is required`), { status: 400 });
            }
            continue;
        }

        if ((property.type === "number" || property.type === "integer") && typeof value === "string") value = Number(value);
        if (property.type === "boolean" && typeof value === "string") value = value === "true";

        if (property.type === "string" && typeof value !== "string") throw Object.assign(new Error(`"${key}" must be text`), { status: 400 });
        if ((property.type === "number" || property.type === "integer") && !Number.isFinite(value)) throw Object.assign(new Error(`"${key}" must be a number`), { status: 400 });
        if (property.type === "integer" && !Number.isInteger(value)) throw Object.assign(new Error(`"${key}" must be a whole number`), { status: 400 });
        if (property.type === "boolean" && typeof value !== "boolean") throw Object.assign(new Error(`"${key}" must be true or false`), { status: 400 });
        if (Array.isArray(property.enum) && !property.enum.includes(value)) throw Object.assign(new Error(`"${key}" must be one of ${property.enum.join(", ")}`), { status: 400 });
        if (typeof value === "string" && Number.isFinite(property.minLength) && value.length < property.minLength) throw Object.assign(new Error(`"${key}" is shorter than ${property.minLength}`), { status: 400 });
        if (typeof value === "string" && Number.isFinite(property.maxLength) && value.length > property.maxLength) throw Object.assign(new Error(`"${key}" is longer than ${property.maxLength}`), { status: 400 });
        if (typeof value === "number" && Number.isFinite(property.minimum) && value < property.minimum) throw Object.assign(new Error(`"${key}" is below ${property.minimum}`), { status: 400 });
        if (typeof value === "number" && Number.isFinite(property.maximum) && value > property.maximum) throw Object.assign(new Error(`"${key}" is above ${property.maximum}`), { status: 400 });

        out[key] = value;
    }

    return out;
}


function currentProjectId() {

    try {
        return require("../runtime/ProjectOverride").effectiveProjectId() || null;
    } catch {
        return null;
    }
}


function elicit(serverName, params = {}, options = {}) {

    const schema = checkSchema(params.requestedSchema);

    if (!interactive && options.interactive !== true) {
        emit("mcp:elicitation_resolved", { id: null, server: serverName, action: "cancel", reason: "no console is attached to answer" });
        return Promise.resolve({ action: "cancel" });
    }

    const id = `elicit_${crypto.randomBytes(8).toString("hex")}`;
    const timeoutMs = options.timeoutMs || settings.get("MCP_ELICITATION_TIMEOUT_MS") || 300000;

    const view = {
        id,
        server: serverName,
        message: String(params.message || "").slice(0, 4000),
        schema,
        project_id: options.projectId === undefined ? currentProjectId() : options.projectId,
        created_at: Date.now(),
        expires_at: Date.now() + timeoutMs
    };

    return new Promise(resolve => {

        const timer = setTimeout(() => settle(id, { action: "cancel" }, "timeout"), timeoutMs);

        if (typeof timer.unref === "function") timer.unref();

        pendingElicitations.set(id, { view, resolve, timer });

        emit("mcp:elicitation", view);
    });
}


function settle(id, answer, reason = "answered") {

    const item = pendingElicitations.get(id);

    if (!item) return false;

    pendingElicitations.delete(id);
    clearTimeout(item.timer);
    item.resolve(answer);

    emit("mcp:elicitation_resolved", { id, server: item.view.server, action: answer.action, reason, project_id: item.view.project_id });

    return true;
}


/* the console's answer; accept carries content checked against the schema */
function answer(id, { action, content } = {}) {

    const item = pendingElicitations.get(id);

    if (!item) {
        throw Object.assign(new Error("that question is no longer waiting (answered, cancelled or timed out)"), { status: 404 });
    }

    if (!["accept", "decline", "cancel"].includes(action)) {
        throw Object.assign(new Error("action must be accept, decline or cancel"), { status: 400 });
    }

    const result =
        action === "accept"
            ? { action, content: validateContent(item.view.schema, content) }
            : { action };

    settle(id, result);

    return { id, action };
}


/* a server that goes away takes its questions with it */
function cancelFor(serverName) {

    for (const [id, item] of [...pendingElicitations.entries()]) {
        if (item.view.server === serverName) settle(id, { action: "cancel" }, "server closed");
    }
}


/* --------------------------------------------------------------- sampling */

const samplingUsage = new Map();

let modelCaller = null;


function setModelCaller(fn) {

    modelCaller = typeof fn === "function" ? fn : null;
}


function callModel(request) {

    if (modelCaller) return modelCaller(request);

    return require("../agent").callAI(request);
}


function samplingAllowed(config) {

    return settings.get("MCP_SAMPLING_ENABLED") === true && Boolean(config && config.sampling === true);
}


function estimateTokens(text) {

    return Math.ceil(String(text || "").length / 4);
}


function messageText(content) {

    if (!content) return "";
    if (Array.isArray(content)) return content.map(messageText).join("\n");
    if (content.type === "text") return String(content.text || "");

    return `[${content.type || "content"} omitted]`;
}


function usage(serverName) {

    const used = samplingUsage.get(serverName) || 0;
    const budget = settings.get("MCP_SAMPLING_BUDGET_TOKENS");

    return { server: serverName, used_tokens: used, budget_tokens: budget, remaining_tokens: Math.max(0, budget - used) };
}


async function sample(serverName, config, params = {}) {

    if (!samplingAllowed(config)) {
        throw Object.assign(
            new Error(`sampling is not allowed for "${serverName}" (MCP_SAMPLING_ENABLED and the server's sampling: true are both needed)`),
            { code: -32600 }
        );
    }

    const messages = (Array.isArray(params.messages) ? params.messages : []).map(message => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: messageText(message.content)
    }));

    if (messages.length === 0) {
        throw Object.assign(new Error("sampling/createMessage needs messages"), { code: -32602 });
    }

    if (params.systemPrompt) {
        messages.unshift({ role: "system", content: String(params.systemPrompt).slice(0, 20000) });
    }

    const cap = settings.get("MCP_SAMPLING_MAX_TOKENS");
    const maxTokens = Math.max(1, Math.min(Number(params.maxTokens) || cap, cap));
    const prompt = estimateTokens(messages.map(message => message.content).join("\n"));
    const { used_tokens: used, budget_tokens: budget } = usage(serverName);

    if (used + prompt + maxTokens > budget) {
        emit("mcp:sampling", { server: serverName, ok: false, reason: "budget", used_tokens: used, budget_tokens: budget });
        throw Object.assign(
            new Error(`the sampling budget of "${serverName}" is spent (${used} of ${budget} tokens used; this request needs up to ${prompt + maxTokens})`),
            { code: -32600 }
        );
    }

    const response = await callModel({
        messages,
        agentDefinition: {
            name: `mcp_sampling_${serverName}`,
            temperature: Number.isFinite(params.temperature) ? params.temperature : 0.2,
            max_tokens: maxTokens
        },
        tools: undefined,
        responseFormat: null,
        role: "L1",
        scope: `mcp:${serverName}`
    });

    const choice = response && response.choices && response.choices[0];
    const text = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "";
    const spent =
        response && response.usage && Number.isFinite(response.usage.total_tokens)
            ? response.usage.total_tokens
            : prompt + estimateTokens(text);

    samplingUsage.set(serverName, used + spent);

    emit("mcp:sampling", { server: serverName, ok: true, tokens: spent, used_tokens: used + spent, budget_tokens: budget });

    return {
        role: "assistant",
        content: { type: "text", text },
        model: (response && response.model) || "structured-ai",
        stopReason: choice && choice.finish_reason === "length" ? "maxTokens" : "endTurn"
    };
}


function resetSampling(serverName) {

    if (serverName) samplingUsage.delete(serverName);
    else samplingUsage.clear();
}


/* --------------------------------------------------------------- progress */

function progress(serverName, params = {}) {

    emit("mcp:progress", {
        server: serverName,
        token: params.progressToken,
        progress: Number(params.progress) || 0,
        total: Number.isFinite(Number(params.total)) ? Number(params.total) : null,
        message: params.message ? String(params.message).slice(0, 500) : null,
        project_id: currentProjectId()
    });
}


module.exports = {
    setInteractive,
    pending,
    checkSchema,
    validateContent,
    elicit,
    answer,
    cancelFor,
    setModelCaller,
    samplingAllowed,
    sample,
    usage,
    resetSampling,
    progress
};
