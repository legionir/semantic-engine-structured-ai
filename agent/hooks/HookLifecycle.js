"use strict";

const HookResult = require("./HookResult");

function declaresAncestorOf(declarations, from, target, seen = new Set()) {

    if (from === target) {
        return true;
    }

    if (seen.has(from)) {
        return false;
    }

    seen.add(from);

    const hook = declarations.find(item => item.id === from);

    if (!hook) {
        return false;
    }

    return (hook.depends_on || []).some(
        dependency => declaresAncestorOf(declarations, dependency, target, seen)
    );
}



class HookLifecycle {
    async withHookBudget(phase, callback) {

        if (this.currentRun().inHook) {
            return {
                phase,
                skipped: true,
                stopped: false,
                results: [],
                reason: "nested hooks are disabled"
            };
        }

        const previous = {
            controller: this.currentRun().controller,
            cancelled_reason: this.currentRun().cancelled_reason
        };

        this.currentRun().inHook = true;
        this.currentRun().hook_phase = phase;
        this.currentRun().hook_started_at = Date.now();
        this.currentRun().hook_deadline_at =
            this.currentRun().hook_started_at +
            this.settings.get("HOOK_TIMEOUT_MS");
        this.currentRun().controller = new AbortController();
        this.currentRun().cancelled_reason = null;

        const timeout =
            setTimeout(
                () => this.cancelRun("hook deadline"),
                this.settings.get("HOOK_TIMEOUT_MS")
            );

        try {
            return await callback();
        } finally {
            clearTimeout(timeout);

            const hookCancellation =
                this.currentRun().cancelled_reason;

            this.currentRun().inHook = false;
            this.currentRun().hook_phase = null;
            this.currentRun().hook_started_at = 0;
            this.currentRun().hook_deadline_at = null;
            this.currentRun().controller = previous.controller;
            this.currentRun().cancelled_reason = previous.cancelled_reason;

            if (
                hookCancellation &&
                hookCancellation !== "hook deadline" &&
                this.currentRun().controller &&
                !this.currentRun().controller.signal.aborted
            ) {
                this.currentRun().cancelled_reason = hookCancellation;
                this.currentRun().controller.abort();
            }
        }
    }


    /* A hook declared with on_failure: stop must gate every hook that
       follows it in declaration order, so the dependent is scheduled in
       a later wave and can actually be skipped before it is dispatched
       instead of racing the stop hook in wave one.

       The implicit edge is only safe when it cannot close a cycle: a stop
       hook may legitimately depend on a hook declared after it, because the
       scheduler resolves items by dependency and not by array order. Adding
       the reverse edge there would make the whole phase undispatchable, so
       it is skipped when the barrier already depends on that hook — which is
       also the honest answer, because a dependency of a stop hook runs
       before it and cannot be gated by its failure. The stop is still
       honoured: the verdict short-circuits every later phase. */
    withStopBarriers(declarations) {

        let barrier = null;

        return declarations.map(hook => {

            const alreadyGated =
                barrier &&
                (hook.depends_on || []).includes(barrier);

            const wouldCloseCycle =
                barrier &&
                declaresAncestorOf(declarations, barrier, hook.id);

            const scheduled =
                barrier && !alreadyGated && !wouldCloseCycle
                    ? {
                        ...hook,
                        depends_on: [
                            ...(hook.depends_on || []),
                            barrier
                        ]
                    }
                    : hook;

            if (hook.on_failure === "stop") {
                barrier = hook.id;
            }

            return scheduled;
        });
    }

    async runHooks(phase, context, mainAgentDefinition) {

        const declarations =
            this.registry.enabledHooks(phase);

        if (
            declarations.length === 0 ||
            this.currentRun().inHook
        ) {
            return {
                phase,
                skipped: true,
                stopped: false,
                stopped_by: null,
                stop_reason: null,
                results: []
            };
        }

        if (
            declarations.length > 0 &&
            this.currentRun().hooks_stopped
        ) {

            /* A stop verdict is run-scoped: once one phase stopped, every
               later phase short-circuits instead of dispatching, so a
               before_task stop is honoured by after_task too. */

            const reason =
                this.currentRun().hooks_stopped;

            this.events.emit("hook:phase:start", {
                phase,
                hooks: declarations.map(item => item.id),
                stopped: true
            });

            const stopped =
                declarations.map(hook => {

                    const skipped =
                        HookResult.stoppedResult(hook, reason);

                    this.currentRun().hook_results[hook.id] = skipped;

                    this.events.emit("hook:start", {
                        id: hook.id,
                        phase: hook.phase,
                        hook_type: hook.type,
                        depends_on: hook.depends_on,
                        on_failure: hook.on_failure
                    });

                    this.events.emit("hook:end", {
                        id: skipped.id,
                        phase: skipped.phase,
                        hook_type: skipped.type,
                        ok: skipped.ok,
                        skipped: true,
                        status: skipped.status,
                        summary: skipped.summary,
                        reason,
                        on_failure: skipped.on_failure,
                        duration_ms: 0
                    });

                    return skipped;
                });

            this.events.emit("hook:phase:end", {
                phase,
                stopped: true,
                stopped_by: this.currentRun().hooks_stopped_by,
                reason,
                ok: true,
                results: HookResult.phaseEventResult(stopped)
            });

            return HookResult.phaseResult(
                phase,
                stopped,
                false,
                true,
                this.currentRun().hooks_stopped_by,
                reason
            );
        }

        return this.withHookBudget(
            phase,
            async () => {

                this.events.emit("hook:phase:start", {
                    phase,
                    hooks: declarations.map(item => item.id)
                });

                const scheduled =
                    await this.executeDependencyGraph({
                        items: this.withStopBarriers(declarations),
                        maxParallel:
                            this.settings.get("MAX_PARALLEL_TOOLS"),
                        executor:
                            hook =>
                                this.executeOneHook(
                                    hook,
                                    context,
                                    mainAgentDefinition
                                ),

                        /* on_failure: stop is enforced before dispatch. The
                           scheduler reads the stop flag before it launches the
                           NEXT hook, and withStopBarriers forces every hook
                           that follows a stop hook into a later wave, so a
                           dependent is skipped rather than racing in wave one.
                           The verdict is run-scoped: later phases are
                           short-circuited too, and every skipped hook says why. */
                        stopReason:
                            (hook, wrapped) => {

                                const outcome = wrapped && wrapped.result;

                                return (
                                    outcome &&
                                    outcome.status === "failed" &&
                                    outcome.on_failure === "stop"
                                )
                                    ? `hook ${hook.id} failed with on_failure: stop`
                                    : null;
                            },

                        skipItem:
                            async (hook, reason) => {

                                const skipped =
                                    HookResult.stoppedResult(hook, reason);

                                this.currentRun().hook_results[hook.id] = skipped;

                                this.events.emit("hook:start", {
                                    id: hook.id,
                                    phase: hook.phase,
                                    hook_type: hook.type,
                                    depends_on: hook.depends_on,
                                    on_failure: hook.on_failure
                                });

                                this.events.emit("hook:end", {
                                    id: skipped.id,
                                    phase: skipped.phase,
                                    hook_type: skipped.type,
                                    ok: skipped.ok,
                                    skipped: true,
                                    status: skipped.status,
                                    summary: skipped.summary,
                                    reason,
                                    on_failure: skipped.on_failure,
                                    duration_ms: 0
                                });

                                return skipped;
                            }
                    });

                const results =
                    scheduled.map(item => item.result);

                const stopped =
                    results.some(
                        item =>
                            item &&
                            item.status === "failed" &&
                            item.on_failure === "stop"
                    );

                const failedStop =
                    stopped
                        ? results.find(
                            item =>
                                item &&
                                item.status === "failed" &&
                                item.on_failure === "stop"
                        )
                        : null;

                if (failedStop) {

                    /* Record the verdict on the run so later phases
                       short-circuit instead of dispatching a stopped step.
                       Both halves are stored: the reason for the report
                       text, the id for consumers that must name the hook.
                       startRun() resets them, so the verdict is this run's
                       and never the next run's. */
                    this.currentRun().hooks_stopped_by = failedStop.id;
                    this.currentRun().hooks_stopped =
                        "hook " +
                        failedStop.id +
                        " failed with on_failure: stop";
                }

                const report =
                    HookResult.phaseResult(
                        phase,
                        results,
                        false,
                        Boolean(failedStop),
                        this.currentRun().hooks_stopped_by,
                        this.currentRun().hooks_stopped
                    );

                this.events.emit("hook:phase:end", {
                    phase,
                    stopped: Boolean(failedStop),
                    stopped_by: report.stopped_by,
                    reason: report.stop_reason,
                    ok: results.every(item => item.ok || item.skipped),
                    results: HookResult.phaseEventResult(results)
                });

                return report;
            }
        );
    }



}

module.exports = HookLifecycle;
