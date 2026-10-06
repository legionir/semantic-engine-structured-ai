/* Runtime state compatibility selector — EXECUTION_PLAN Phase 24. */

export function statusOf(state) {
  return state?.runtimeState?.status || "idle";
}

export function taskOf(state) {
  return state?.runtimeState?.task || null;
}
