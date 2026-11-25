/*
| Conversation helpers: message normalisation and the correlation between
| a model response and the tool events it caused. Pure — no DOM.
*/

/*
| A model response is identified by the turn, the agent scope and the
| iteration that produced it; every tool event emitted during that action
| carries the same three fields. `execution_key` is accepted when present
| so newer servers can provide an explicit stable key.
*/
export function messageExecutionKey(value) {

    if (value.execution_key || value.ai_message_id) {
        return value.execution_key || value.ai_message_id;
    }

    if (!value.turn_id) {
        return null;
    }

    return [
        value.turn_id,
        value.scope || value.agent || "main_agent",
        value.iteration ?? "all"
    ].join("|");
}


/*
| Older session files did not store turn_id on reasoning messages.
| Recovering it from the nearest preceding user message lets those
| sessions use the per-iteration renderer too.
*/
export function normalizeConversationMessage(message, previous = []) {

    if (!message || typeof message !== "object") {
        return message;
    }

    const normalized = { ...message };

    if (normalized.role !== "assistant" || !["model", "thinking"].includes(normalized.kind)) {
        return normalized;
    }

    if (!normalized.turn_id && normalized.execution_key) {
        normalized.turn_id = String(normalized.execution_key).split("|")[0];
    }

    if (!normalized.turn_id) {

        for (let index = previous.length - 1; index >= 0; index--) {

            const candidate = previous[index];

            if (candidate.role === "user" && candidate.turn_id) {
                normalized.turn_id = candidate.turn_id;
                break;
            }
        }
    }

    if (normalized.turn_id && !normalized.execution_key) {
        normalized.execution_key = messageExecutionKey(normalized);
    }

    return normalized;
}


export function normalizeConversationMessages(messages) {

    const normalized = [];

    for (const message of Array.isArray(messages) ? messages : []) {
        normalized.push(normalizeConversationMessage(message, normalized));
    }

    return normalized;
}


const TURN_EVENT_TYPES = new Set([
    "agent:iteration",
    "agent:action",
    "tool:graph",
    "tool:start",
    "tool:end",
    "run:malformed"
]);


export const TURN_REFRESH_TYPES = new Set([
    "agent:iteration",
    "agent:action",
    "tool:start",
    "tool:end",
    "run:malformed"
]);


/*
| Groups the relevant events by execution key in one pass, so drawing a
| conversation is linear in the number of events instead of scanning the
| whole list once per message. A "turn|all" fallback key collects every
| relevant event of the turn (sessions written before model messages
| were stored).
*/
export function indexTurnEvents(events) {

    const byKey = new Map();
    const byTurn = new Map();

    for (const event of events) {

        if (!TURN_EVENT_TYPES.has(event.type)) continue;

        const key = messageExecutionKey(event);

        if (key) {
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(event);
        }

        if (event.turn_id) {
            if (!byTurn.has(event.turn_id)) byTurn.set(event.turn_id, []);
            byTurn.get(event.turn_id).push(event);
        }
    }

    return executionKey => {

        if (!executionKey) return [];

        const parts = executionKey.split("|");

        if (parts.length === 2 && parts[1] === "all") {
            return byTurn.get(parts[0]) || [];
        }

        return byKey.get(executionKey) || [];
    };
}


/*
| The conversation as a list of items to draw: one execution block per
| model response, placed before the reasoning that produced it; every
| message except raw model envelopes; and, for old sessions, a turn-wide
| block under a user message whose turn has no stored model response.
*/
export function conversationItems(messages, eventsOf) {

    const items = [];

    const assistantTurns = new Set(
        messages
            .filter(message =>
                message.role === "assistant" &&
                ["model", "thinking"].includes(message.kind) &&
                message.turn_id)
            .map(message => message.turn_id)
    );

    const rendered = new Set();

    const block = key => {

        if (rendered.has(key)) return;

        const events = eventsOf(key);

        if (events.length > 0) {
            items.push({ type: "execution", key, events });
            rendered.add(key);
        }
    };

    messages.forEach((message, index) => {

        const isExecution =
            message.role === "assistant" && ["model", "thinking"].includes(message.kind);

        if (isExecution) {
            const key = messageExecutionKey(message);
            if (key) block(key);
        }

        if (message.kind !== "model") {
            items.push({ type: "message", key: `m${index}`, message });
        }

        if (message.role === "user" && message.turn_id && !assistantTurns.has(message.turn_id)) {
            block(`${message.turn_id}|all`);
        }
    });

    return items;
}
