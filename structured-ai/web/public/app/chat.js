/*
|--------------------------------------------------------------------------
| Console chat (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The conversation: bubbles for what was said, reasoning folded away, and the
| per-iteration execution block that ties a tool batch to the exact AI message
| that caused it.
|
| Reasoning is rendered as a dedicated expandable entry so provider
| reasoning never disappears from the conversation.
|
| `messageExecutionKey` is the same rule the server stamps events with, which is
| why a replay redraws each block instead of gluing every tool of a turn to one
| accordion. Not losing an answer or a line of reasoning across a reload or a
| modal round trip is what this file exists to keep true.
|--------------------------------------------------------------------------
*/

import { el, node } from "./dom.js";
import { WHO, eventLabel } from "./formatters.js";
import { applyBubbleDirection } from "./direction.js";
import { renderMarkdown } from "./markdown.js";
import { conversationState, eventState, executionState, runtimeState, updateWaitingElapsed } from "./store.js";

/*
| Older session files did not store turn_id on reasoning messages. Recovering
| it from the nearest preceding user message lets those sessions use the new
| per-iteration renderer too, instead of falling back to one aggregate box.
*/
export function normalizeConversationMessage(message, previous = conversationState.messages) {

    if (!message || typeof message !== "object") {
        return message;
    }

    const normalized = { ...message };

    if (
        normalized.role !== "assistant" ||
        !["model", "thinking"].includes(normalized.kind)
    ) {
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

export function renderChat() {

    const container = el("chat");

    if (!container) {
        return;
    }

    runtimeState.waitingElapsed = null;

    /* Preserve blocks the operator explicitly expanded when a newly arrived
       reasoning message causes the chat to be rebuilt. */
    for (const existing of container.querySelectorAll("details.turn-execution")) {
        const key = existing.getAttribute("data-execution-key");
        if (!key) continue;
        if (existing.open) executionState.openExecutionKeys.add(key);
        else executionState.openExecutionKeys.delete(key);
    }

    container.innerHTML = "";

    if (conversationState.messages.length === 0) {

        container.innerHTML =
            '<p class="empty">No messages yet. Describe a task to start.</p>';

    } else {

        /*
        | A single user turn can contain many model messages. Build one
        | execution block per assistant response (agent + iteration), and
        | place it immediately before the reasoning/action message that
        | produced it. The previous implementation keyed only by turn_id,
        | so every iteration was merged into one large block.
        */
        const assistantTurns = new Set(
            conversationState.messages
                .filter(message =>
                    message.role === "assistant" &&
                    ["model", "thinking"].includes(message.kind) &&
                    message.turn_id
                )
                .map(message => message.turn_id)
        );

        const renderedExecutions = new Set();

        for (const message of conversationState.messages) {

            const isExecutionMessage =
                message.role === "assistant" &&
                ["model", "thinking"].includes(message.kind);

            const key =
                isExecutionMessage
                    ? messageExecutionKey(message)
                    : null;

            if (key && !renderedExecutions.has(key)) {

                const block = turnExecutionBlock(key);

                if (block) {
                    /* The raw structured model envelope is retained in the
                       session for diagnostics, but is not a user-facing
                       bubble. The execution block belongs before reasoning
                       so each AI step reads as one unit. */
                    container.appendChild(block);
                    renderedExecutions.add(key);
                }
            }

            /* The provider's raw content is the action protocol JSON, not a
               useful chat message. Final response and thinking bubbles are
               rendered normally; model envelopes stay available in Events
               and session storage without polluting the conversation. */
            if (message.kind !== "model") {
                container.appendChild(bubble(message));
            }

            if (
                message.role === "user" &&
                message.turn_id &&
                !assistantTurns.has(message.turn_id)
            ) {

                /* Backwards compatibility for sessions written before model
                   response messages were stored: keep their tool events
                   visible under the user message until a new response arrives. */
                const fallbackKey = `${message.turn_id}|all`;

                if (!renderedExecutions.has(fallbackKey)) {
                    const block = turnExecutionBlock(fallbackKey);

                    if (block) {
                        container.appendChild(block);
                        renderedExecutions.add(fallbackKey);
                    }
                }
            }
        }
    }

    /*
    | While a request is in flight there is nothing to show yet, and a
    | two minute silence looks like a hang. The bubble is the wait
    | itself, and it disappears when the answer arrives.
    */

    if (runtimeState.waiting) {

        const pending =
            node("div", "bubble assistant pending");

        const elapsed = node("span", "text");
        runtimeState.waitingElapsed = elapsed;

        pending.append(
            node(
                "span",
                "who",
                `${runtimeState.waiting.agent} · thinking`
            ),
            elapsed
        );

        container.appendChild(pending);
        updateWaitingElapsed();
    }

    container.scrollTop = container.scrollHeight;
}

/*
| A model response is identified by the turn, the agent scope, and the
| iteration that produced it. Every tool event emitted during that action
| carries the same three correlation fields. `execution_key` is accepted
| when present so newer servers can provide an explicit stable key.
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

export function turnEventsOf(executionKey) {

    if (!executionKey) {
        return [];
    }

    const relevant = new Set([
        "agent:iteration",
        "agent:action",
        "tool:graph",
        "tool:start",
        "tool:end",
        "run:malformed"
    ]);

    const parts = executionKey.split("|");
    const isTurnFallback = parts.length === 2 && parts[1] === "all";

    return eventState.events.filter(event => {

        if (!relevant.has(event.type)) {
            return false;
        }

        if (isTurnFallback) {
            return event.turn_id === parts[0];
        }

        return messageExecutionKey(event) === executionKey;
    });
}

export function turnSummaryText(events) {

    /* Count calls by id, not lifecycle events. A tool has a start and an end,
       but it is still one call. This also remains correct for a result event
       that arrives without a start after reconnect/replay. */
    const calls = new Map();

    for (const event of events) {

        if (event.type !== "tool:start" && event.type !== "tool:end") {
            continue;
        }

        const id =
            event.id || `${event.name || "tool"}-${calls.size + 1}`;

        const call = calls.get(id) || { success: null };

        if (event.type === "tool:end") {
            call.success = event.success === true;
        }

        calls.set(id, call);
    }

    const success =
        [...calls.values()].filter(call => call.success === true).length;

    const fail =
        [...calls.values()].filter(call => call.success === false).length;

    const retried =
        events.filter(event => event.type === "run:malformed").length;

    return (
        `execution · ${calls.size} tool call(s) · ${success} success · ` +
        `${fail} fail · ${retried} retried`
    );
}

export function turnExecutionLine(event) {

    const kind =
        event.type === "tool:end"
            ? (event.success === false ? "tool-fail" : "tool-ok")
            : event.type === "tool:start"
                ? "tool-ok"
                : event.type === "agent:action"
                    ? "action"
                    : event.type === "run:malformed"
                        ? "malformed"
                        : "";

    const line = node(
        "div",
        `turn-execution-line${kind ? ` ${kind}` : ""}`
    );

    if (event.type === "tool:start" || event.type === "tool:end") {
        line.appendChild(node("span", "tool-chip", event.name || ""));
    }

    line.appendChild(node("span", "turn-line-text", eventLabel(event)));

    return line;
}

export function turnExecutionBody(events) {

    const body = node("div", "turn-execution-body");

    for (const event of events) {
        body.appendChild(turnExecutionLine(event));
    }

    return body;
}

export function turnExecutionBlock(executionKey) {

    const events = turnEventsOf(executionKey);

    if (events.length === 0) {
        return null;
    }

    const details = node("details", "turn-execution");

    details.setAttribute("data-execution-key", executionKey);

    /* Keep the old attribute for stored sessions and integrations that used
       it to locate a turn, while the new key distinguishes iterations. */
    const turnId = executionKey.split("|")[0];
    if (turnId) {
        details.setAttribute("data-turn-id", turnId);
    }

    /* Keep the block collapsible and closed by default. CSS must not impose
       a fixed height: when the user clicks the summary, the full body can
       expand normally. */
    details.open = executionState.openExecutionKeys.has(executionKey);
    details.addEventListener("toggle", () => {
        if (details.open) executionState.openExecutionKeys.add(executionKey);
        else executionState.openExecutionKeys.delete(executionKey);
    });

    details.appendChild(
        node("summary", null, turnSummaryText(events))
    );

    details.appendChild(turnExecutionBody(events));

    return details;
}

/*
| Updates only the execution block for one model response in place, instead
| of re-rendering the whole conversation. An already-open block stays open.
*/
export function refreshTurnExecution(executionKey) {

    if (!executionKey) {
        return;
    }

    const chat = el("chat");

    if (!chat) {
        return;
    }

    let existing = null;

    for (const candidate of chat.querySelectorAll("details.turn-execution")) {

        if (candidate.getAttribute("data-execution-key") === executionKey) {
            existing = candidate;
            break;
        }
    }

    if (!existing) {
        renderChat();
        return;
    }

    const events = turnEventsOf(executionKey);
    const summary = existing.querySelector("summary");
    const body = existing.querySelector(".turn-execution-body");

    if (!summary || !body) {
        renderChat();
        return;
    }

    summary.textContent = turnSummaryText(events);

    const wasOpen = existing.open;

    existing.replaceChild(turnExecutionBody(events), body);
    existing.open = wasOpen;
}

export function appendMessageContent(box, content, className = "message-content") {

    const body = node("div", className);
    renderMarkdown(body, content);
    box.appendChild(body);
    return body;
}

export function bubble(message) {

    const kind =
        message.kind || "message";

    const content = String(message.content || "");

    const box =
        node(
            "div",
            `bubble ${message.role} ${kind === "message" ? "" : kind}`.trim()
        );

    applyBubbleDirection(box, content);

    if (kind === "thinking") {

        const details = node("details");

        /* Open reasoning by default so the agent's visible text is not
           hidden behind a collapsed summary — the user reported that no AI
           text was showing, only a "thinking" label. */
        details.open = true;

        details.appendChild(
            node(
                "summary",
                null,
                `thinking${
                    message.agent
                        ? ` · ${message.agent}`
                        : ""
                }${
                    message.iteration
                        ? ` · iteration ${message.iteration}`
                        : ""
                }`
            )
        );

        appendMessageContent(box, content, "thinking-content message-content");

        /* Keep the reasoning details wrapper as the first child for the
           existing console contract; the rendered markdown sits inside it. */
        const thinkingBody = box.children[box.children.length - 1];
        details.appendChild(thinkingBody);
        box.appendChild(details);

        return box;
    }

    if (kind === "model") {

        box.appendChild(
            node(
                "span",
                "who",
                `${message.agent || "agent"} · response${
                    message.iteration
                        ? ` · iteration ${message.iteration}`
                        : ""
                }`
            )
        );

        appendMessageContent(box, content);

        if (message.truncated) {
            box.appendChild(
                node("span", "truncated", "response preview truncated")
            );
        }

        if (message.at) {
            box.appendChild(
                node(
                    "span",
                    "stamp",
                    new Date(message.at).toLocaleTimeString(
                        "en-GB",
                        { hour12: false }
                    )
                )
            );
        }

        return box;
    }

    if (kind === "git-report") {

        box.appendChild(
            node(
                "span",
                "who",
                `git${message.branch ? ` · ${message.branch}` : ""}`
            )
        );

        appendMessageContent(box, content);

        if (message.at) {

            box.appendChild(
                node(
                    "span",
                    "stamp",
                    new Date(message.at).toLocaleTimeString(
                        "en-GB",
                        { hour12: false }
                    )
                )
            );
        }

        return box;
    }

    box.appendChild(
        node(
            "span",
            "who",
            `${WHO[message.role] || message.role}${
                kind === "error"
                    ? " · failed"
                    : ""
            }`
        )
    );
    appendMessageContent(box, content);

    if (message.at) {

        box.appendChild(
            node(
                "span",
                "stamp",
                new Date(message.at).toLocaleTimeString(
                    "en-GB",
                    { hour12: false }
                )
            )
        );
    }

    return box;
}
