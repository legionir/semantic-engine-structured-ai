"use strict";

/*
|--------------------------------------------------------------------------
| Capabilities and delegation
|--------------------------------------------------------------------------
|
| What an agent may do (modify files, the repository, run commands), the
| cross-project write guard, the main agent's profile and delegation hints.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const runtimeEngine = require("../runtime/engine");


module.exports = function createCapabilities(host) {

    const {
        AGENTS_OF,
        POLICY_ENGINE,
        TOOL_REGISTRY_OF,
        currentRun,
        effectiveProject,
        isMultiProjectTask,
        projectIdOf,
        promptFacade
    } = host;

    /* set up by a later factory, so looked up when called */
    const delegationProjectSwitchEnabled = (...args) => host.delegationProjectSwitchEnabled(...args);

    /*
    |--------------------------------------------------------------------------
    | Initial Main Agent Messages
    |--------------------------------------------------------------------------
    */

    /*
    | The task comes from the caller, or from AGENT_TASK for a shell that
    | finds a flag awkward. There is no checked-in prompt file any more:
    | editing a file in the repository to change what the agent should do
    | was a leftover from the first prototype, and it made the repository
    | carry one user's task.
    */

    function readTask() {

        const provided =
            process.env.AGENT_TASK;

        return typeof provided === "string"
            ? provided
            : "";
    }


    /*
    | What a profile can actually do, rather than leaving the orchestrator
    | to infer it from a list of tool names. Reading git history is not the
    | same capability as committing, and running a shell is not the same as
    | editing a file, so the two are reported separately.
    */

    const FILE_MUTATING_TOOLS = [
        "fs_write",
        "fs_edit",
        "fs_mkdir",
        "fs_move",
        "fs_delete",
        "mcp_build"
    ];

    const REPOSITORY_MUTATING_TOOLS = [
        "git_add",
        "git_commit",
        "git_checkout",
        "git_branch",
        "git_push",
        "git_worktree"
    ];

    const COMMAND_TOOLS = [
        "terminal_exec",
        "process_start",
        "process_write"
    ];


    function describeCapability(agentDefinition) {

        const tools =
            agentDefinition.tools === "*"
                ? [...TOOL_REGISTRY_OF().keys()]
                : agentDefinition.tools || [];

        return {
            can_write_files:
                tools.some(
                    name => FILE_MUTATING_TOOLS.includes(name)
                ),

            can_change_repository:
                tools.some(
                    name => REPOSITORY_MUTATING_TOOLS.includes(name)
                ),

            can_run_commands:
                tools.some(
                    name => COMMAND_TOOLS.includes(name)
                )
        };
    }


    function canModifyWorkspace(agentDefinition) {

        const capability =
            describeCapability(agentDefinition);

        return (
            capability.can_write_files ||
            capability.can_change_repository ||
            capability.can_run_commands
        );
    }


    /* Phase 12: the policy engine owns the extra approval for writes that
       leave the Sub-Agent's project or happen in a multi-project task. */
    async function enforceCrossProjectWrite(toolName, args, agent) {

        return POLICY_ENGINE.enforceCrossProjectWrite({
            toolName,
            args,
            agent,
            enabled: delegationProjectSwitchEnabled(),
            fileMutatingTools: FILE_MUTATING_TOOLS,
            currentRun,
            effectiveProject,
            projectIdOf,
            isMultiProjectTask
        });
    }

    /*
    | The root profile, as configured, without running a whole agent to ask
    | whether it may delegate.
    */

    function mainAgentProfile() {

        return (
            AGENTS_OF().find(
                agent => agent.name === "main_agent"
            ) || {
                name: "main_agent",
                delegation: { enabled: true }
            }
        );
    }


    function mayDelegate(agentDefinition) {

        return Boolean(agentDefinition?.delegation?.enabled);
    }


    /*
    | Sub-agents are the capacity this runtime has that a single loop does
    | not: each one brings its own iteration budget and its own context. A
    | real run spent 28 iterations doing implementation work alone with 15
    | agents unused, which is not prudence, it is capacity left on the table.
    |
    | Telling the model that in the prompt did not work, so the runtime says
    | it at the moment it is true: the plan has parallel work left, the
    | agent budget is untouched, and the root has been working alone for a
    | while. It is a notice, not a refusal, because forcing a delegation
    | that does not fit would be worse than not delegating at all.
    */

    function delegationHintMessage(...args) {

        return runtimeEngine.delegationHintMessage(...args);

    }


    function shouldHintDelegation(...args) {

        return runtimeEngine.shouldHintDelegation(...args);

    }


    /*
    | A final answer may declare what it did. The runtime already knows what
    | it executed, so the two can be compared, and the interesting case is
    | the claim with nothing behind it: "I updated the config" when no write
    | ever ran. The mismatch is reported, never silently corrected, because
    | the runtime cannot know which of the two is the lie.
    */

    function checkPerformedClaim(...args) {

        return runtimeEngine.checkPerformedClaim(...args);

    }


    function createMainAgentMessages(task) {
        return promptFacade().mainMessages(task, {
            project: effectiveProject(currentRun().project)
        });
    }


    return {
        FILE_MUTATING_TOOLS,
        canModifyWorkspace,
        checkPerformedClaim,
        createMainAgentMessages,
        describeCapability,
        enforceCrossProjectWrite,
        mainAgentProfile,
        mayDelegate,
        readTask
    };
};
