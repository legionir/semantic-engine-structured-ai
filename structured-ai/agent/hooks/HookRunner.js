/*
|--------------------------------------------------------------------------\
| Hook runner
|--------------------------------------------------------------------------\
|
| Hooks are policy owned by the runtime, not plan steps owned by a model, so
| the runner sends every hook through the ordinary executors: a tool hook
| through the tool graph (so policy, budget, cancellation and telemetry all
| still apply), an agent hook through delegation, a commit hook through the git
| tools. There is no privileged path for a hook to reach the workspace.
|
| `on_failure: "stop"` is evaluated over the finished phase, not per hook: the
| remaining hooks still run and still report, and the phase result is what
| marks the run stopped. `before_task` and `after_task` never nest — a hook
| that could enqueue hooks would recurse forever, hence the `inHook` guard and
| the per-phase deadline in `withHookBudget`.
|
| Anything live comes from `bind()`, the same rule as the phase-16 engine
| modules: importing this directory must not pull in `agent.js`, or every test
| of a hook would boot the runtime to get one closure.
|--------------------------------------------------------------------------*/

const settings = require("../lib/storage");
const events = require("../lib/events");

const { render, evaluateWhen, enabledHooks } = require("./HookRegistry");
const { hookResultSummary, endEvent } = require("./HookResult");


/* The runtime bindings, installed once by agent.js after its closures exist. */

const state = {
    host: null
};


function bind(host) {

    state.host = host;
}


function host() {

    if (!state.host) {

        throw new Error("hooks runner is not bound");
    }

    return state.host;
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


async function executeHookTool(hook, context) {

    const args =
        render(hook.arguments || {}, context);

    const results =
        await host().executeToolGraph(
            [
                {
                    id: `hook_${hook.id}`,
                    name: hook.tool,
                    arguments: args,
                    depends_on: []
                }
            ],
            new Set(host().TOOL_REGISTRY_OF().keys()),
            "main_agent",
            { hook: hook.id }
        );

    const result = results[0];
    const exitCode = result?.result?.exit_code;

    if (!result?.success || (Number.isInteger(exitCode) && exitCode !== 0)) {

        throw new Error(
            result?.error?.message ||
            `Hook tool "${hook.tool}" exited with code ${exitCode}.`
        );
    }

    return result.result;
}


async function executeGitCommitHook(hook, context) {

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
            : render(hook.paths, context);

    if (typeof paths === "string") {
        paths = paths.split(",").map(item => item.trim()).filter(Boolean);
    }

    if (!Array.isArray(paths)) {
        paths = [];
    }

    /* A before_task safety commit explicitly snapshots the dirty tree. */
    if (hook.phase === "before_task" && paths.length === 0) {

        const status =
            await executeHookTool(
                {
                    id: `${hook.id}_status`,
                    type: "tool",
                    tool: "git_status",
                    arguments: { cwd: "." }
                },
                context
            );

        paths = host().toolRuntime.telemetry.dirtyFiles();

        if (paths.length === 0) {
            paths = dirtyPathsFromStatus(status.stdout);
        }
    }

    paths = [...new Set(paths.filter(item => typeof item === "string" && item !== ""))];

    if (paths.length === 0) {
        throw new Error("No safely attributable paths are available for this commit hook.");
    }

    const message =
        render(hook.message, context);

    const results =
        await host().executeToolGraph(
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
            new Set(host().TOOL_REGISTRY_OF().keys()),
            "main_agent",
            { hook: hook.id }
        );

    const failed = results.find(result => !result.success);

    if (failed) {
        throw new Error(failed.error?.message || "Git commit hook failed.");
    }

    return {
        paths,
        commit: results[1].result
    };
}


async function executeAgentHook(hook, context, mainAgentDefinition) {

    const task =
        render(hook.task, context);

    const results =
        await host().executeDelegations(
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
            Math.max(0, host().resolveDepthBudget(
                mainAgentDefinition,
                settings.get("MAX_AGENT_DEPTH")
            ) - 1),
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


async function executeOneHook(hook, baseContext, mainAgentDefinition) {

    const startedAt = Date.now();
    const context = {
        ...baseContext,
        hooks: host().currentRun().hook_results
    };

    events.emit("hook:start", {
        id: hook.id,
        phase: hook.phase,
        hook_type: hook.type,
        depends_on: hook.depends_on,
        on_failure: hook.on_failure
    });

    if (!evaluateWhen(hook.when, context)) {

        const skipped = {
            id: hook.id,
            type: hook.type,
            phase: hook.phase,
            ok: false,
            skipped: true,
            status: "skipped",
            summary: `condition was false: ${hook.when}`,
            on_failure: hook.on_failure,
            duration_ms: Date.now() - startedAt
        };

        host().currentRun().hook_results[hook.id] = skipped;
        events.emit("hook:end", endEvent(skipped));

        return skipped;
    }

    try {

        host().assertRunActive(`hook ${hook.id}`);

        const result =
            hook.type === "tool"
                ? await executeHookTool(hook, context)
                : hook.type === "agent"
                    ? await executeAgentHook(hook, context, mainAgentDefinition)
                    : await executeGitCommitHook(hook, context);

        host().assertRunActive(`hook ${hook.id} completion`);

        const completed = {
            id: hook.id,
            type: hook.type,
            phase: hook.phase,
            ok: true,
            skipped: false,
            status: "done",
            summary: hookResultSummary(result),
            result,
            on_failure: hook.on_failure,
            duration_ms: Date.now() - startedAt
        };

        host().currentRun().hook_results[hook.id] = completed;
        events.emit("hook:end", endEvent(completed));

        return completed;

    } catch (error) {

        const failed = {
            id: hook.id,
            type: hook.type,
            phase: hook.phase,
            ok: false,
            skipped: false,
            status: "failed",
            summary: error.message,
            error: error.message,
            on_failure: hook.on_failure,
            duration_ms: Date.now() - startedAt
        };

        host().currentRun().hook_results[hook.id] = failed;
        events.emit("hook:end", endEvent(failed));

        return failed;
    }
}


async function withHookBudget(phase, callback) {

    if (host().currentRun().inHook) {
        return {
            phase,
            skipped: true,
            stopped: false,
            results: [],
            reason: "nested hooks are disabled"
        };
    }

    const previous = {
        controller: host().currentRun().controller,
        cancelled_reason: host().currentRun().cancelled_reason
    };

    host().currentRun().inHook = true;
    host().currentRun().hook_phase = phase;
    host().currentRun().hook_started_at = Date.now();
    host().currentRun().hook_deadline_at = host().currentRun().hook_started_at + settings.get("HOOK_TIMEOUT_MS");
    host().currentRun().controller = new AbortController();
    host().currentRun().cancelled_reason = null;

    const timeout =
        setTimeout(
            () => host().cancelRun("hook deadline"),
            settings.get("HOOK_TIMEOUT_MS")
        );

    try {
        return await callback();
    } finally {
        clearTimeout(timeout);

        const hookCancellation =
            host().currentRun().cancelled_reason;

        host().currentRun().inHook = false;
        host().currentRun().hook_phase = null;
        host().currentRun().hook_started_at = 0;
        host().currentRun().hook_deadline_at = null;
        host().currentRun().controller = previous.controller;
        host().currentRun().cancelled_reason = previous.cancelled_reason;

        if (
            hookCancellation &&
            hookCancellation !== "hook deadline" &&
            host().currentRun().controller &&
            !host().currentRun().controller.signal.aborted
        ) {
            host().currentRun().cancelled_reason = hookCancellation;
            host().currentRun().controller.abort();
        }
    }
}


async function runHooks(phase, context, mainAgentDefinition) {

    const declarations = enabledHooks(phase);

    if (declarations.length === 0 || host().currentRun().inHook) {

        return {
            phase,
            skipped: true,
            stopped: false,
            results: []
        };
    }

    return withHookBudget(
        phase,
        async () => {

            events.emit("hook:phase:start", {
                phase,
                hooks: declarations.map(item => item.id)
            });

            const scheduled =
                await host().executeDependencyGraph({
                    items: declarations,
                    maxParallel: settings.get("MAX_PARALLEL_TOOLS"),
                    executor:
                        hook => executeOneHook(
                            hook,
                            context,
                            mainAgentDefinition
                        )
                });

            const results = scheduled.map(item => item.result);
            const stopped =
                results.some(
                    item =>
                        item &&
                        item.status === "failed" &&
                        item.on_failure === "stop"
                );

            const report = {
                phase,
                skipped: false,
                stopped,
                results
            };

            events.emit("hook:phase:end", {
                phase,
                stopped,
                ok: results.every(item => item.ok || item.skipped),
                results: results.map(item => ({
                    id: item.id,
                    status: item.status,
                    ok: item.ok,
                    summary: item.summary
                }))
            });

            return report;
        }
    );
}


module.exports = {
    bind,
    runHooks,
    executeOneHook,
    executeHookTool,
    executeGitCommitHook,
    executeAgentHook,
    withHookBudget,
    dirtyPathsFromStatus
};
