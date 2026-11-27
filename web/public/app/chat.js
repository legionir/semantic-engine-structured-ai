/*
| Conversation view: message bubbles, the per-response execution blocks,
| and the "thinking" bubble while a request is in flight.
|
| Items are keyed by position (the conversation only grows or is replaced
| wholesale) and execution blocks by their execution key, so an update
| never recreates a bubble: a reasoning block the operator folded stays
| folded, a selection survives, and an execution block keeps its state.
*/

import { html } from "./dom.js";
import { clock, eventLabel, turnSummaryText, WHO } from "./formatters.js";
import { directionOf } from "./direction.js";
import { Markdown } from "./markdown.js";
import { conversationItems, indexTurnEvents } from "./conversation-model.js";


function Stamp({ at }) {

    return at ? html`<span class="stamp">${clock(at)}</span>` : null;
}


function AgentBody({ content, rawMode, className = "message-content" }) {

    if (rawMode) {
        return html`<pre class=${`raw-message-content ${className}`.trim()}>${content}</pre>`;
    }

    return html`<${Markdown} class=${className} text=${content} />`;
}


export function Bubble({ message, rawMode = false }) {

    const kind = message.kind || "message";
    const content = String(message.content || "");
    const direction = directionOf(content);
    const className = `${`bubble ${message.role} ${kind === "message" ? "" : kind}`.trim()} ${direction}`;
    const showRaw = Boolean(rawMode && message.role === "assistant");

    if (kind === "thinking") {

        /* open by default so the agent's visible text is not hidden */
        return html`<div class=${className} dir=${direction}>
            <details open=${true}>
                <summary>${`thinking${message.agent ? ` · ${message.agent}` : ""}${
                    message.iteration ? ` · iteration ${message.iteration}` : ""}`}</summary>
                <${AgentBody} content=${content} rawMode=${showRaw} className="thinking-content message-content" />
            </details>
        </div>`;
    }

    if (kind === "model") {

        return html`<div class=${className} dir=${direction}>
            <span class="who">${`${message.agent || "agent"} · response${
                message.iteration ? ` · iteration ${message.iteration}` : ""}`}</span>
            <${AgentBody} content=${content} rawMode=${showRaw} />
            ${message.truncated ? html`<span class="truncated">response preview truncated</span>` : null}
            <${Stamp} at=${message.at} />
        </div>`;
    }

    if (kind === "git-report") {

        return html`<div class=${className} dir=${direction}>
            <span class="who">${`git${message.branch ? ` · ${message.branch}` : ""}`}</span>
            <${AgentBody} content=${content} rawMode=${showRaw} />
            <${Stamp} at=${message.at} />
        </div>`;
    }

    return html`<div class=${className} dir=${direction}>
        <span class="who">${`${WHO[message.role] || message.role}${kind === "error" ? " · failed" : ""}`}</span>
        <${AgentBody} content=${content} rawMode=${showRaw} />
        <${Stamp} at=${message.at} />
    </div>`;
}


function lineKind(event) {

    return event.type === "tool:end"
        ? (event.success === false ? "tool-fail" : "tool-ok")
        : event.type === "tool:start"
            ? "tool-ok"
            : event.type === "agent:action"
                ? "action"
                : event.type === "run:malformed" ? "malformed" : "";
}


function ExecutionBlock({ executionKey, events, open, onToggle }) {

    const turnId = executionKey.split("|")[0];

    return html`<details
        class="turn-execution"
        data-execution-key=${executionKey}
        data-turn-id=${turnId || undefined}
        open=${open}
        onToggle=${event => onToggle(executionKey, event.currentTarget.open)}
    >
        <summary>${turnSummaryText(events)}</summary>
        <div class="turn-execution-body">
            ${events.map((event, index) => {
                const kind = lineKind(event);
                return html`<div class=${`turn-execution-line${kind ? ` ${kind}` : ""}`} key=${index}>
                    ${event.type === "tool:start" || event.type === "tool:end"
                        ? html`<span class="tool-chip">${event.name || ""}</span>`
                        : null}
                    <span class="turn-line-text">${eventLabel(event)}</span>
                </div>`;
            })}
        </div>
    </details>`;
}


export function waitingText(waiting, now = Date.now()) {

    return waiting ? `${((now - waiting.since) / 1000).toFixed(1)} s` : "";
}


export function Chat({ state, onToggleExecution }) {

    const pending = state.waiting
        ? html`<div class="bubble assistant pending" key="pending">
            <span class="who">${`${state.waiting.agent} · thinking`}</span>
            <span class="text">${waitingText(state.waiting)}</span>
        </div>`
        : null;

    if (state.messages.length === 0) {
        return html`<p class="empty" key="empty">No messages yet. Describe a task to start.</p>${pending}`;
    }

    const items = conversationItems(state.messages, indexTurnEvents(state.events));
    const rawMode = Boolean(state.chatRawMode);

    return html`${items.map(item => item.type === "execution"
        ? html`<${ExecutionBlock}
            key=${`x${item.key}`}
            executionKey=${item.key}
            events=${item.events}
            open=${state.openExecutionKeys.has(item.key)}
            onToggle=${onToggleExecution}
        />`
        : html`<${Bubble} key=${item.key} message=${item.message} rawMode=${rawMode} />`)}${pending}`;
}
