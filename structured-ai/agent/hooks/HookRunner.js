"use strict";

const defaultSettings = require("../config");

const HookResult = require("./HookResult");


/*
|--------------------------------------------------------------------------
| Hook runner — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| Hook declarations are intentionally executed through the existing tool,
| delegation and event paths. This runner owns orchestration and lifecycle,
| but never bypasses policy, telemetry, project context or cancellation.
| Dependencies are injected by agent.js to keep the hook boundary explicit
| and independent from the application entry point.
|--------------------------------------------------------------------------
*/

function required(name) {

    return () => {
        throw new Error(`hook runner dependency is not bound: ${name}`);
    };
}


function dirtyPathsFromStatus(stdout) {

    return String(stdout || "")
        .split(/\r?\n/)
        .filter(line => line && !line.startsWith("## "))
        .flatMap(line => {

            const path = line.slice(3).trim();

            if (!path.includes(" -> ")) {
                return [path];
            }

            return path.split(" -> ").map(item => item.trim());
        })
        .filter(
            item =>
                item &&
                item !== ".agent" &&
                !item.startsWith(".agent/")
        );
}


/* True when `from` already reaches `target` through declared dependencies,
   i.e. target is an ancestor of from. Cycles in the declaration are handled
   by the seen set, never by infinite recursion. */
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


class HookRunner {

    constructor({
        settings,
        registry,
        events,
        currentRun,
        assertRunActive,
        cancelRun,
        currentPlanSummary,
        detectRepository,
        toolRuntime,
        executeToolGraph,
        executeDependencyGraph,
        executeDelegations,
        resolveDepthBudget,
        toolRegistryOf,
        mainAgentProfile
    } = {}) {

        this.settings = settings || defaultSettings;
        this.registry = registry || require("./HookRegistry");
        this.events = events || { emit() {} };
        this.currentRun = currentRun || required("currentRun");
        this.assertRunActive = assertRunActive || required("assertRunActive");
        this.cancelRun = cancelRun || required("cancelRun");
        this.currentPlanSummary =
            currentPlanSummary || required("currentPlanSummary");
        this.detectRepository =
            detectRepository || required("detectRepository");
        this.toolRuntime = toolRuntime || {};
        this.executeToolGraph =
            executeToolGraph || required("executeToolGraph");
        this.executeDependencyGraph =
            executeDependencyGraph || required("executeDependencyGraph");
        this.executeDelegations =
            executeDelegations || required("executeDelegations");
        this.resolveDepthBudget =
            resolveDepthBudget || required("resolveDepthBudget");
        this.toolRegistryOf =
            toolRegistryOf || (() => new Map());
        this.mainAgentProfile =
            mainAgentProfile || required("mainAgentProfile");
    }


    executionContext(extra = {}) {

        const plan =
            this.currentPlanSummary();

        const runId = this.currentRun()?.id || null;

        return {
            task: this.currentRun().task,
            objective: plan.objective || this.currentRun().task,
            repository: this.detectRepository(),
            files_changed:
                this.toolRuntime.telemetry.changedFiles(runId),
            file_tracking_complete:
                this.toolRuntime.telemetry.changeTrackingComplete(runId),
            plan,
            hooks: this.currentRun().hook_results,
            ...extra
        };
    }


    async executeHookTool(hook, context) {

        const args =
            this.registry.render(hook.arguments || {}, context);

        const results =
            await this.executeToolGraph(
                [
                    {
                        id: `hook_${hook.id}`,
                        name: hook.tool,
                        arguments: args,
                        depends_on: []
                    }
                ],
                new Set(this.toolRegistryOf().keys()),
                "main_agent",
                { hook: hook.id }
            );

        const result = results[0];
        const exitCode = result?.result?.exit_code;

        if (
            !result?.success ||
            (Number.isInteger(exitCode) && exitCode !== 0)
        ) {
            throw new Error(
                result?.error?.message ||
                `Hook tool "${hook.tool}" exited with code ${exitCode}.`
            );
        }

        return result.result;
    }


    async executeGitCommitHook(hook, context) {

        if (
            hook.phase === "after_task" &&
            context.file_tracking_complete !== true
        ) {
            throw new Error(
                "The runtime cannot prove the complete set of files changed by this run, so it refused to commit. A shell or background process may have modified an already-dirty path."
            );
        }

        let paths =
            hook.paths === undefined
                ? context.files_changed
                : this.registry.render(hook.paths, context);

        if (typeof paths === "string") {
            paths = paths
                .split(",")
                .map(item => item.trim())
                .filter(Boolean);
        }

        if (!Array.isArray(paths)) {
            paths = [];
        }

        /* A before_task safety commit explicitly snapshots the dirty tree. */
        if (hook.phase === "before_task" && paths.length === 0) {

            const status =
                await this.executeHookTool(
                    {
                        id: `${hook.id}_status`,
                        type: "tool",
                        tool: "git_status",
                        arguments: { cwd: "." }
                    },
                    context
                );

            paths =
                this.toolRuntime.telemetry.dirtyFiles(this.currentRun()?.id || null);

            if (paths.length === 0) {
                paths = dirtyPathsFromStatus(status.stdout);
            }
        }

        paths = [
            ...new Set(
                paths.filter(
                    item =>
                        typeof item === "string" &&
                        item !== ""
                )
            )
        ];

        if (paths.length === 0) {
            throw new Error(
                "No safely attributable paths are available for this commit hook."
            );
        }

        const message =
            this.registry.render(hook.message, context);

        const results =
            await this.executeToolGraph(
                [
                    {
                        id: `hook_${hook.id}_add`,
                        name: "git_add",
                        arguments: { cwd: ".", paths },
                        depends_on: []
                    },
                    {
                        id: `hook_${hook.id}_commit`,
                        name: "git_commit",
                        arguments: { cwd: ".", message, paths },
                        depends_on: [`hook_${hook.id}_add`]
                    }
                ],
                new Set(this.toolRegistryOf().keys()),
                "main_agent",
                { hook: hook.id }
            );

        const failed =
            results.find(result => !result.success);

        if (failed) {
            throw new Error(
                failed.error?.message ||
                "Git commit hook failed."
            );
        }

        return {
            paths,
            commit: results[1].result
        };
    }


    async executeAgentHook(hook, context, mainAgentDefinition) {

        const task =
            this.registry.render(hook.task, context);

        const results =
            await this.executeDelegations(
                [
                    {
                        id: `hook_${hook.id}`,
                        agent: hook.agent,
                        persona: null,
                        skills: null,
                        tools: null,
                        task,
                        hook: hook.id,
                        depends_on: []
                    }
                ],
                1,
                mainAgentDefinition,
                Math.max(
                    0,
                    this.resolveDepthBudget(
                        mainAgentDefinition,
                        this.settings.get("MAX_AGENT_DEPTH")
                    ) - 1
                ),
                "main_agent"
            );

        const delegated = results[0];
        const report = delegated?.result;

        if (!delegated?.success || !report?.success || report?.error) {
            throw new Error(
                delegated?.error?.message ||
                report?.error?.message ||
                `Agent hook "${hook.id}" failed.`
            );
        }

        if (
            (report.performed?.tools || 0) +
            (report.performed?.delegations || 0) === 0
        ) {
            throw new Error(
                `Agent hook "${hook.id}" returned without executing a tool or delegation, so its report is not runtime evidence.`
            );
        }

        return report;
    }


    async executeOneHook(hook, baseContext, mainAgentDefinition) {

        const startedAt = Date.now();
        const context = {
            ...baseContext,
            hooks: this.currentRun().hook_results
        };

        this.events.emit("hook:start", {
            id: hook.id,
            phase: hook.phase,
            hook_type: hook.type,
            depends_on: hook.depends_on,
            on_failure: hook.on_failure
        });

        if (!this.registry.evaluateWhen(hook.when, context)) {

            const skipped =
                HookResult.skippedResult(
                    hook,
                    Date.now() - startedAt
                );

            this.currentRun().hook_results[hook.id] = skipped;
            this.events.emit("hook:end", {
                id: skipped.id,
                phase: skipped.phase,
                hook_type: skipped.type,
                ok: skipped.ok,
                skipped: skipped.skipped,
                status: skipped.status,
                summary: skipped.summary,
                error: skipped.error,
                on_failure: skipped.on_failure,
                duration_ms: skipped.duration_ms
            });

            return skipped;
        }

        try {

            this.assertRunActive(`hook ${hook.id}`);

            const result =
                hook.type === "tool"
                    ? await this.executeHookTool(hook, context)
                    : hook.type === "agent"
                        ? await this.executeAgentHook(
                            hook,
                            context,
                            mainAgentDefinition
                        )
                        : await this.executeGitCommitHook(
                            hook,
                            context
                        );

            this.assertRunActive(`hook ${hook.id} completion`);

            const completed =
                HookResult.completedResult(
                    hook,
                    result,
                    Date.now() - startedAt
                );

            this.currentRun().hook_results[hook.id] = completed;
            this.events.emit("hook:end", {
                id: completed.id,
                phase: completed.phase,
                hook_type: completed.type,
                ok: completed.ok,
                skipped: completed.skipped,
                status: completed.status,
                summary: completed.summary,
                error: completed.error,
                on_failure: completed.on_failure,
                duration_ms: completed.duration_ms
            });

            return completed;

        } catch (error) {

            const failed =
                HookResult.failedResult(
                    hook,
                    error,
                    Date.now() - startedAt
                );

            this.currentRun().hook_results[hook.id] = failed;
            this.events.emit("hook:end", {
                id: failed.id,
                phase: failed.phase,
                hook_type: failed.type,
                ok: failed.ok,
                skipped: failed.skipped,
                status: failed.status,
                summary: failed.summary,
                error: failed.error,
                on_failure: failed.on_failure,
                duration_ms: failed.duration_ms
            });

            return failed;
        }
    }


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


    hookReportText(report) {
        return HookResult.hookReportText(report);
    }


    async applyAfterTaskHooks(action, runError) {

        if (this.currentRun().after_hooks_ran) {
            return { action, report: null };
        }

        const context =
            this.executionContext({
                action: action || null,
                run_error:
                    runError
                        ? { message: runError.message }
                        : action?.error || null
            });

        /* Freeze provenance before test/review hooks run their own commands. */
        context.files_changed = [...context.files_changed];
        context.file_tracking_complete =
            context.file_tracking_complete === true;

        const report =
            await this.runHooks(
                "after_task",
                context,
                this.currentRun().main_agent_definition ||
                    this.mainAgentProfile()
            );

        this.currentRun().after_hooks_ran = true;

        const combinedReport = {
            ...report,
            results:
                Object.values(this.currentRun().hook_results)
        };

        if (!action) {
            return { action: null, report: combinedReport };
        }

        const text =
            this.hookReportText(combinedReport);

        const next = {
            ...action,
            response: action.response
                ? { ...action.response }
                : {
                    type: "text",
                    content:
                        runError?.message ||
                        "The run did not complete."
                }
        };

        if (text) {
            next.response.content =
                `${next.response.content}\n\nAutomated routine:\n${text}`;
        }

        if (report.stopped && !next.error) {

            /* Search the combined report: the hook that stopped the run may
               have failed in an earlier phase, so it is not in this phase's
               results. When nothing failed with stop — a phase that only
               short-circuited — the report's own verdict is the message, so
               a stopped run never surfaces as an undefined dereference. */
            const failed =
                combinedReport.results.find(
                    item =>
                        item &&
                        item.status === "failed" &&
                        item.on_failure === "stop"
                ) || null;

            next.error = {
                code: "HOOK_FAILED",
                message: failed
                    ? `Required ${failed.phase || "after_task"} hook "${failed.id}" failed: ${failed.summary}`
                    : `after_task hooks were stopped: ${report.stop_reason || report.stopped_by || "unknown stop"}`,
                retryable: true
            };
        }

        return { action: next, report: combinedReport };
    }
}


module.exports = {
    HookRunner,
    dirtyPathsFromStatus
};
