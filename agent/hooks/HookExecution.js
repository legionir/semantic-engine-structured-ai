"use strict";

const HookResult = require("./HookResult");

class HookExecution {
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



}

module.exports = HookExecution;
