"use strict";

/*
|--------------------------------------------------------------------------
| Token counting (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Anthropic and Gemini expose a count endpoint, which their adapters use
| (countTokens -> { tokens, method: "native" }). Every other provider, and
| any native count that fails, falls back to this estimate: about four
| ASCII characters per token, about two for other scripts (Persian, CJK,
| ...), a small per-message overhead and a flat cost per image.
|--------------------------------------------------------------------------
*/

const { partsOf, toolCallsOf } = require("./Messages");


function estimateTokens(text) {

    const value = String(text || "");

    if (value === "") {
        return 0;
    }

    let ascii = 0;
    let other = 0;

    for (const character of value) {

        if (character.charCodeAt(0) < 128) {
            ascii++;
        } else {
            other++;
        }
    }

    return Math.ceil(ascii / 4 + other / 2);
}


function estimateRequestTokens(request) {

    const messages = Array.isArray(request && request.messages) ? request.messages : [];

    let total = 0;

    for (const message of messages) {

        total += 4;

        for (const part of partsOf(message && message.content)) {
            total += part.type === "text" ? estimateTokens(part.text) : 765;
        }

        for (const call of toolCallsOf(message)) {
            total += estimateTokens(call.name) + estimateTokens(call.arguments);
        }
    }

    if (Array.isArray(request && request.tools) && request.tools.length > 0) {
        total += estimateTokens(JSON.stringify(request.tools));
    }

    return total;
}


module.exports = {
    estimateTokens,
    estimateRequestTokens
};
