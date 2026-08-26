/* Modal adapter — EXECUTION_PLAN Phase 24. */

export function modalService() {
  return globalThis.Modal || null;
}

export function openModal(options) {
  const modal = modalService();
  return modal ? modal.open(options) : null;
}

export function closeTop(reason) {
  const modal = modalService();
  return modal ? modal.closeTop(reason) : false;
}
