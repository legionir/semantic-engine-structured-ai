"use strict";

/*
|--------------------------------------------------------------------------
| Model prices (roadmap P3-05)
|--------------------------------------------------------------------------
|
| Dollars per million tokens, used to turn the usage an endpoint reports
| into a cost. The built-in table holds list prices of common hosted
| models and is necessarily approximate: providers change prices, and a
| proxy or a negotiated contract bills differently. MODEL_PRICES (a JSON
| object) adds or corrects entries and wins over the table.
|
| A model is matched by its exact name, then by the longest table key it
| starts with, after dropping a "provider/" prefix (openrouter style), so
| "gpt-4o-mini-2024-07-18" finds "gpt-4o-mini". A model nobody priced has
| no cost (null) rather than a guessed one; local models are free only
| when MODEL_PRICES says so.
|
| When the endpoint itself reports the cost (usage.cost, as OpenRouter
| does) that number is used instead of the table.
|--------------------------------------------------------------------------
*/

const settings = require("../config");
const { logs } = require("../runtime/LogStore");

/* input / output (and cached input where it is billed differently), $ per 1M tokens */
const BUILT_IN_PRICES = Object.freeze({
    "gpt-5": { input: 1.25, output: 10, cached_input: 0.125 },
    "gpt-5-mini": { input: 0.25, output: 2, cached_input: 0.025 },
    "gpt-5-nano": { input: 0.05, output: 0.4, cached_input: 0.005 },
    "gpt-4.1": { input: 2, output: 8, cached_input: 0.5 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6, cached_input: 0.1 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4, cached_input: 0.025 },
    "gpt-4o": { input: 2.5, output: 10, cached_input: 1.25 },
    "gpt-4o-mini": { input: 0.15, output: 0.6, cached_input: 0.075 },
    "o3": { input: 2, output: 8, cached_input: 0.5 },
    "o4-mini": { input: 1.1, output: 4.4, cached_input: 0.275 },
    "claude-opus-4": { input: 15, output: 75, cached_input: 1.5 },
    "claude-opus-4-5": { input: 5, output: 25, cached_input: 0.5 },
    "claude-sonnet-4": { input: 3, output: 15, cached_input: 0.3 },
    "claude-haiku-4": { input: 1, output: 5, cached_input: 0.1 },
    "claude-3-5-haiku": { input: 0.8, output: 4, cached_input: 0.08 },
    "gemini-2.5-pro": { input: 1.25, output: 10, cached_input: 0.31 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5, cached_input: 0.075 },
    "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cached_input: 0.025 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4, cached_input: 0.025 },
    "deepseek-chat": { input: 0.27, output: 1.1, cached_input: 0.07 },
    "deepseek-reasoner": { input: 0.55, output: 2.19, cached_input: 0.14 },
    "grok-4": { input: 3, output: 15, cached_input: 0.75 },
    "grok-3-mini": { input: 0.3, output: 0.5, cached_input: 0.075 },
    "mistral-large": { input: 2, output: 6 },
    "mistral-small": { input: 0.1, output: 0.3 }
});

let overrideSource = null;
let overrideTable = {};


function validPrice(value) {

    return value &&
        typeof value === "object" &&
        Number.isFinite(Number(value.input)) &&
        Number.isFinite(Number(value.output)) &&
        Number(value.input) >= 0 &&
        Number(value.output) >= 0;
}


function overrides() {

    const raw = String(settings.get("MODEL_PRICES") || "").trim();

    if (raw === overrideSource) {
        return overrideTable;
    }

    overrideSource = raw;
    overrideTable = {};

    if (raw === "") {
        return overrideTable;
    }

    try {

        const parsed = JSON.parse(raw);

        for (const [name, price] of Object.entries(parsed || {})) {
            if (validPrice(price)) {
                overrideTable[name.toLowerCase()] = {
                    input: Number(price.input),
                    output: Number(price.output),
                    ...(Number.isFinite(Number(price.cached_input)) ? { cached_input: Number(price.cached_input) } : {})
                };
            }
        }

    } catch (error) {
        logs.warn("settings", `MODEL_PRICES is not valid JSON and is ignored: ${error.message}`);
    }

    return overrideTable;
}


function lookup(table, name) {

    if (table[name]) {
        return table[name];
    }

    let best = null;

    for (const key of Object.keys(table)) {
        if (name.startsWith(key) && (!best || key.length > best.length)) {
            best = key;
        }
    }

    return best ? table[best] : null;
}


/* { input, output, cached_input? } in $ per 1M tokens, or null */
function priceOf(model) {

    if (typeof model !== "string" || model.trim() === "") {
        return null;
    }

    const full = model.trim().toLowerCase();
    const bare = full.includes("/") ? full.slice(full.lastIndexOf("/") + 1) : full;
    const extra = overrides();

    return lookup(extra, full) || lookup(extra, bare) || lookup(BUILT_IN_PRICES, bare) || null;
}


function count(value) {

    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number : 0;
}


/*
| { prompt_tokens, completion_tokens, cached_tokens, cost_usd, priced }
| for one response's usage (OpenAI shape, or Anthropic's input/output names).
*/
function costOf(model, usage) {

    const prompt = count(usage?.prompt_tokens ?? usage?.input_tokens);
    const completion = count(usage?.completion_tokens ?? usage?.output_tokens);
    const cached = Math.min(prompt, count(usage?.prompt_tokens_details?.cached_tokens ?? usage?.cache_read_input_tokens));
    const reported = Number(usage?.cost);

    const base = { prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached };

    if (Number.isFinite(reported) && reported >= 0 && usage?.cost !== undefined && usage?.cost !== null) {
        return { ...base, cost_usd: reported, priced: true, source: "endpoint" };
    }

    const price = priceOf(model);

    if (!price) {
        return { ...base, cost_usd: null, priced: false, source: null };
    }

    const cachedRate = Number.isFinite(price.cached_input) ? price.cached_input : price.input;
    const cost =
        ((prompt - cached) * price.input + cached * cachedRate + completion * price.output) / 1e6;

    return { ...base, cost_usd: cost, priced: true, source: "price table" };
}


module.exports = {
    BUILT_IN_PRICES,
    priceOf,
    costOf
};
