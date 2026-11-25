/*
|--------------------------------------------------------------------------
| Runtime Context Builder
|--------------------------------------------------------------------------
|
| The dynamic runtime_context message: workspace, repository, plan,
| memory, archive, policy, endpoints, budget and MCP state. Everything
| volatile arrives through injected closures, so one instance serves
| every run and every iteration, and the module itself imports nothing
| from agent.js (EXECUTION_PLAN Phase 5, گام ۳).
|
| The built object reproduces the historical createRuntimeContext()
| field for field; only the budget/root reads are re-routed through the
| injected callbacks, which in modular mode answer for the calling run
| and its project.
|--------------------------------------------------------------------------
*/

const settings = require("../config");


class RuntimeContextBuilder {

    constructor(deps) {

        this.deps = deps;

    }


    build() {

        const deps = this.deps;

        return {
            ...deps.CONFIGURED_RUNTIME_OF(),

            environment:
                deps.detectEnvironment(),

            repository:
                deps.detectRepository(),

            workspace: {
                ...(deps.CONFIGURED_RUNTIME_OF().workspace || {}),

                root:
                    deps.workspaceRoot()
            },

            /*
            | The group catalogue used to travel here as well: 2.7K
            | characters describing tools whose full schemas are already
            | in the request. Groups are how the policy reasons, not how
            | the agent calls anything, so what the agent needs is the
            | policy summary below, not the taxonomy behind it.
            */

            plan:
                deps.planSummary(),

            memory: {
                enabled:
                    settings.get("MEMORY_ENABLED") === true,

                size_chars:
                    deps.memorySizeChars(),

                chunk_chars:
                    settings.get("MEMORY_CHUNK_CHARS"),

                max_summary_calls:
                    settings.get("MEMORY_MAX_SUMMARY_CALLS"),

                summary_parallelism:
                    settings.get("MEMORY_SUMMARY_PARALLELISM")
            },

            /*
            | The agent is told how much history is retrievable,
            | otherwise it has no reason to search an archive it cannot
            | see.
            */

            archive:
                deps.archiveStats(),

            policy:
                deps.policySummary(),

            endpoints:
                deps.endpointOverview(),

            runtime: {
                workspace_root:
                    deps.workspaceRoot(),

                max_iterations:
                    settings.get("MAX_ITERATIONS"),

                max_agent_depth:
                    settings.get("MAX_AGENT_DEPTH"),

                max_parallel_tools:
                    settings.get("MAX_PARALLEL_TOOLS"),

                max_parallel_agents:
                    settings.get("MAX_PARALLEL_AGENTS"),

                max_total_agents:
                    settings.get("MAX_TOTAL_AGENTS"),

                agents_spawned:
                    deps.agentsSpawned(),

                agents_remaining:
                    Math.max(
                        0,
                        settings.get("MAX_TOTAL_AGENTS") - deps.agentsSpawned()
                    ),

                iterations_per_agent:
                    settings.get("MAX_ITERATIONS"),

                max_run_ms:
                    settings.get("MAX_RUN_MS"),

                max_request_ms:
                    settings.get("MAX_REQUEST_MS"),

                max_context_chars:
                    settings.get("MAX_CONTEXT_CHARS"),

                context_window_tokens:
                    settings.get("CONTEXT_WINDOW_TOKENS") || null,

                context_window_safety_fraction:
                    settings.get("CONTEXT_WINDOW_SAFETY_FRACTION"),

                run_remaining_ms:
                    deps.runStartedAt()
                        ? Math.max(0, deps.runRemainingMs())
                        : settings.get("MAX_RUN_MS")
            },

            /*
            | Which external servers this run can reach. Named rather
            | than counted, because an agent that knows a "github"
            | server exists asks it something; one told there are two
            | servers does not.
            */

            mcp:
                deps.mcpContext()
        };

    }


    /* Rewrites the runtime_context system message of an in-flight
       conversation in place, so every iteration sees fresh limits,
       budget and MCP state. Returns whether a message was refreshed. */
    refresh(messages) {

        for (const message of messages) {

            if (
                message.role !== "system" ||
                typeof message.content !== "string" ||
                !message.content.startsWith("{")
            ) {
                continue;
            }

            let parsed;

            try {

                parsed = JSON.parse(message.content);

            } catch {

                continue;
            }

            if (parsed.type !== "runtime_context") {
                continue;
            }

            message.content =
                JSON.stringify({
                    type: "runtime_context",

                    context: this.build()
                });

            return true;
        }

        return false;
    }

}


module.exports = RuntimeContextBuilder;
