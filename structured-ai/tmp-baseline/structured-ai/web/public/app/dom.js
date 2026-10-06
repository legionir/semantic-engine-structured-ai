/* DOM helpers — EXECUTION_PLAN Phase 24. */

export const byId = id => document.getElementById(id);

export function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

export function clear(element) {
  if (element) element.replaceChildren();
  return element;
}

export function on(element, event, handler, options) {
  if (element) element.addEventListener(event, handler, options);
  return handler;
}
