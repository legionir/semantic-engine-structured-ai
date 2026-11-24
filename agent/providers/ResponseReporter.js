/* Normalize provider-specific answer and reasoning fields into runtime events. */

function createResponseReporter({ settings, events }) {
    function reasoningText(message) {
        const parts = [];
        const seen = new Set();
        const add = value => {
            if (typeof value !== "string") return;
            const text = value.trim();
            if (text !== "" && !seen.has(text)) {
                seen.add(text);
                parts.push(text);
            }
        };
        const read = value => {
            if (typeof value === "string") {
                add(value);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) read(item);
                return;
            }
            if (value && typeof value === "object") {
                for (const key of ["text", "content", "summary", "reasoning"]) {
                    if (Object.prototype.hasOwnProperty.call(value, key)) read(value[key]);
                }
            }
        };
        read(message?.reasoning_content);
        read(message?.reasoning);
        read(message?.reasoning_details);
        return parts.join("\n\n");
    }

    function modelMessageText(message) {
        if (!message || typeof message !== "object") return "";
        if (typeof message.content === "string") return message.content.trim();
        if (message.content !== undefined && message.content !== null) {
            try {
                return JSON.stringify(message.content, null, 2);
            } catch {
                return String(message.content);
            }
        }
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            try {
                return JSON.stringify({ tool_calls: message.tool_calls }, null, 2);
            } catch {
                return "";
            }
        }
        if (typeof message.refusal === "string") return message.refusal.trim();
        return "";
    }

    function reportThinking(message, scope, agent, depth, iteration) {
        const text = reasoningText(message);
        if (text === "") return null;
        const limit = settings.get("THINKING_MAX_CHARS");
        return events.emit("agent:thinking", {
            agent: agent || "main_agent",
            scope: scope || "main_agent",
            depth: depth || 0,
            iteration: iteration || null,
            content: text.length > limit ? `${text.slice(0, limit)}…` : text,
            chars: text.length
        });
    }

    function reportModelResponse(data, scope, agent, depth, iteration) {
        const message = data?.choices?.[0]?.message;
        if (!message) return null;

        const thinking = reportThinking(message, scope, agent, depth, iteration);
        const raw = modelMessageText(message);
        const maxChars = Math.max(settings.get("THINKING_MAX_CHARS"), 4000);
        const content = raw.length > maxChars ? `${raw.slice(0, maxChars)}…` : raw;
        const response = content === "" ? null : events.emit("agent:response", {
            agent: agent || "main_agent",
            scope: scope || "main_agent",
            depth: depth || 0,
            iteration: iteration || null,
            content,
            chars: raw.length,
            truncated: raw.length > maxChars,
            finish_reason: data?.choices?.[0]?.finish_reason || null,
            model: data?.model || null
        });
        return response || thinking;
    }

    return { reasoningText, modelMessageText, reportThinking, reportModelResponse };
}


module.exports = { createResponseReporter };
