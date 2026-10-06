/* RTL/LTR helpers — EXECUTION_PLAN Phase 24. */

const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export function containsRtlText(value) {
  return RTL_TEXT.test(String(value || ""));
}

export function directionOf(value) {
  return containsRtlText(value) ? "rtl" : "ltr";
}

export function applyDirection(element, value) {
  if (element) element.dir = directionOf(value);
  return element;
}
