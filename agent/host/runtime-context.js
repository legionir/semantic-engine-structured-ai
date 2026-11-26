"use strict";

/*
|--------------------------------------------------------------------------
| Runtime context
|--------------------------------------------------------------------------
|
| Registry validation, environment and repository detection, transcript
| summaries, memory folding and the runtime context the model sees.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const path = require("path");
const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");
const toolRuntime = require("../tools");
const settings = require("../config");
const contextKit = require("../context");
const registryValidator = require("../registry/RegistryValidator");


module.exports = function createRuntimeContextKit(host) {

    const {
        AGENTS_OF,
        CONFIGURED_RUNTIME_OF,
        PERSONAS_OF,
        POLICY_OF,
        SKILLS_OF,
        TOOLS_OF,
        TOOL_GROUPS_OF,
        effectiveProject,
        repositoryDetector
    } = host;

    /* set up by a later factory, so looked up when called */
    const currentRun = (...args) => host.currentRun(...args);
    const promptFacade = (...args) => host.promptFacade(...args);
    const sendAgentRequest = (...args) => host.sendAgentRequest(...args);

    /*
    |--------------------------------------------------------------------------
    | Registry Validation
    |--------------------------------------------------------------------------
    |
    | A typo in a profile used to be silently dropped, leaving an agent
    | running without the tool it was supposed to have. The registries are
    | now checked against each other before the first request is built.
    |--------------------------------------------------------------------------
    */

    function validateRegistries() {

        return registryValidator.validate({
            tools: TOOLS_OF(),
            groups: TOOL_GROUPS_OF(),
            skills: SKILLS_OF(),
            agents: AGENTS_OF(),
            personas: PERSONAS_OF(),
            policy: POLICY_OF(),
            hasTool: name => toolRuntime.hasTool(name),
            implementedToolNames: () => toolRuntime.implementedToolNames()
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Runtime Context
    |--------------------------------------------------------------------------
    */

    function detectEnvironment() {

        /*
        | The declared environment is overridden by what is actually running,
        | so the model never generates commands for the wrong shell.
        */

        const platform =
            process.platform;

        const os =
            platform === "win32"
                ? "windows"
                : platform === "darwin"
                    ? "macos"
                    : "linux";

        const shell =
            platform === "win32"
                ? (
                    process.env.COMSPEC
                        ? path.basename(process.env.COMSPEC)
                        : "cmd.exe"
                )
                : (
                    process.env.SHELL
                        ? path.basename(process.env.SHELL)
                        : "sh"
                );

        return {
            ...(CONFIGURED_RUNTIME_OF().environment || {}),

            os,

            shell,

            platform,

            node_version:
                process.version
        };
    }


    /*
    | The repository is discovered from the workspace rather than declared,
    | so the model is never told there is a git repository when there is
    | not, and never has to guess the branch.
    */

    /* The repository is discovered from the workspace rather than declared,
    | so the model is never told there is a git repository when there is
    | not, and never has to guess the branch. In modular mode the runtime
    | passes the calling run's project root, so a cross-root project sees
    | its own repository rather than the process workspace's.
    */

    function detectRepository(root) {

        return repositoryDetector.detect(
            root || WORKSPACE_ROOT,
            CONFIGURED_RUNTIME_OF().repository || {}
        );
    }


    async function refreshRepositoryContext() {

        const project = effectiveProject(currentRun().project);
        const root = project ? project.workspaceRoot : WORKSPACE_ROOT;

        return repositoryDetector.refresh(
            root,
            CONFIGURED_RUNTIME_OF().repository || {}
        );
    }


    /*
    | The runtime context is written once, but the numbers inside it move:
    | the plan advances, the deadline shrinks, agents are spent. The message
    | is therefore rewritten in place at the start of every iteration, so an
    | agent never reasons about a stale snapshot of its own run.
    */

    /*
    | Compaction used to run only after tool results were appended, so a run
    | that mostly delegates never compacted at all, and a run that did
    | compact only reacted once the budget was already exceeded. It is now a
    | maintenance step at the top of every iteration, triggered at a share
    | of the budget rather than at the limit.
    */

    /*
    | Asks the model to compress a slice of its own history. It is a plain
    | completion, deliberately without tools or the action schema, so a
    | failure here can never derail the run: the caller falls back to
    | mechanical compression.
    */

    async function summariseTranscript(transcript, instruction) {

        const response =
            await sendAgentRequest({
                messages: [
                    {
                        role: "system",

                        content:
                            instruction ||
                            [
                                "You compress an agent's working memory.",
                                "Write a dense digest of the tool calls below for the agent that made them.",
                                "Keep: what was inspected or changed, the paths involved, the facts learned, the errors hit, and anything still unresolved.",
                                "Drop: raw file bodies, repeated output, and anything the agent can trivially re-read.",
                                "Write plain prose, no preamble, no markdown headings."
                            ].join(" ")
                    },
                    {
                        role: "user",

                        content: transcript
                    }
                ],

                agentDefinition: {
                    name: "context_summariser",

                    /*
                    | A dedicated model when one is configured, otherwise the
                    | agent's own. Summarising is frequent and mechanical, so
                    | pointing this at a small model is usually the cheapest
                    | change available.
                    */

                    /*
                    | The model comes from the SUMMARY endpoint profile,
                    | so there is one place to configure it.
                    */

                    temperature: 0,

                    max_tokens:
                        settings.get("CONTEXT_SUMMARY_MAX_TOKENS")
                },

                tools: undefined,

                responseFormat: null,

                role: "SUMMARY",

                timeoutMs:
                    settings.get("CONTEXT_SUMMARY_MS")
            });

        const message =
            response?.choices?.[0]?.message;

        return typeof message?.content === "string"
            ? message.content
            : null;
    }


    /*
    | Moves the oldest exchanges out of the transcript and into working
    | memory, one chunk at a time, then rewrites the single memory message.
    | The newest exchanges are never touched, so the agent keeps what it
    | just read.
    */

    /*
    | One place that turns exchanges into archive records, used both when
    | history is folded into memory and when compaction drops an exchange
    | outright. Dropping is the only step that destroys material, so it must
    | never happen without a copy landing here first.
    */

    /*
    | Context / memory / archive (EXECUTION_PLAN Phase 17). Implementation
    | lives in agent/context/ and agent/persistence/; these stay as
    | compatible wrappers so the runtime loop and the existing exports keep
    | their names and signatures (law 7).
    */

    function archiveExchanges(messages, exchanges, scope) {

        return contextKit.archiveExchanges(messages, exchanges, scope);

    }


    async function foldIntoMemory(messages, scope) {

        return contextKit.foldIntoMemory(messages, scope);

    }


    function refreshMemoryMessage(messages, memory) {

        return contextKit.refreshMemoryMessage(messages, memory);

    }


    async function maintainContext(messages, scope, tools, agentDefinition) {

        return contextKit.maintainContext(messages, scope, tools, agentDefinition);

    }


    function refreshRuntimeContext(messages) {
        return promptFacade().refreshRuntimeContext(messages);
    }


    function currentPlanSummary() {

        try {

            const plan = require("../tools/planning");

            return plan._summarise(plan._loadPlan());

        } catch (error) {

            return {
                exists: false,
                error: error.message
            };
        }
    }


    function currentPlanView() {

        try {

            const planTools = require("../tools/planning");
            const plan = planTools._loadPlan();

            return {
                ...planTools._summarise(plan),
                created_at: plan.created_at,
                updated_at: plan.updated_at,
                phases: plan.phases
            };

        } catch (error) {

            return {
                exists: false,
                phases: [],
                error: error.message
            };
        }
    }


    function createRuntimeContext() {
        return promptFacade().runtimeContextMessage();
    }


    function mcpContext() {

        if (settings.get("MCP_ENABLED") === false) {
            return { enabled: false, servers: [], tools: 0 };
        }

        try {

            const status =
                toolRuntime.mcp._manager.status();

            /*
            | P4-06: the tools left out of the request's declarations, by
            | name and one line, so the model knows to load one with
            | mcp_search_tools and run it with mcp_call.
            */
            let selection = null;

            try {
                selection =
                    typeof host.mcpToolSelection === "function"
                        ? host.mcpToolSelection()
                        : null;
            } catch {
                selection = null;
            }

            const deferred =
                selection && selection.deferred.length > 0
                    ? {
                        tool_loading: selection.mode,
                        deferred_tools: selection.deferred,
                        deferred_hint:
                            "These MCP tools are not declared to save context: call mcp_search_tools " +
                            "(query or names) to read a definition, then run it with mcp_call {tool, arguments}."
                    }
                    : {};

            return {
                enabled: true,

                tools:
                    status.tool_count,

                ...deferred,

                servers:
                    status.servers
                        .filter(server => server.enabled)
                        .map(server => ({
                            name: server.name,
                            state: server.state,
                            tools: server.tool_count
                        }))
            };

        } catch {

            return { enabled: true, servers: [], tools: 0 };
        }
    }


    return {
        archiveExchanges,
        createRuntimeContext,
        currentPlanSummary,
        currentPlanView,
        detectEnvironment,
        detectRepository,
        foldIntoMemory,
        maintainContext,
        mcpContext,
        refreshMemoryMessage,
        refreshRepositoryContext,
        refreshRuntimeContext,
        summariseTranscript,
        validateRegistries
    };
};
