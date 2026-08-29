/* Conversation view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";
import { applyDirection } from "./direction.js";

export function renderMessage(message, container = byId("chat")) {
  if (!container) return null;
  const box = create("div", `message ${message.role || "assistant"}`);
  const content = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content ?? "");
  box.textContent = content;
  applyDirection(box, content);
  container.appendChild(box);
  return box;
}

export function renderConversation(messages, container = byId("chat")) {
  if (!container) return;
  clear(container);
  (messages || []).forEach(message => renderMessage(message, container));
}
