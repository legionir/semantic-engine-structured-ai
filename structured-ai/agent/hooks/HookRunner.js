"use strict";

const defaultSettings = require("../config");

const HookResult = require("./HookResult");
const HookExecution = require("./HookExecution");
const HookLifecycle = require("./HookLifecycle");


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


for (const prototype of [HookExecution.prototype, HookLifecycle.prototype]) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name !== "constructor") {
            Object.defineProperty(
                HookRunner.prototype,
                name,
                Object.getOwnPropertyDescriptor(prototype, name)
            );
        }
    }
}


module.exports = {
    HookRunner,
    dirtyPathsFromStatus
};
