/* Approval state selector — EXECUTION_PLAN Phase 24. */

export function pendingApprovals(state) {
  return Object.values(state?.approvalState?.pending || {});
}

export function pendingCount(state) {
  return pendingApprovals(state).length;
}
