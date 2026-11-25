"use strict";

/*
|--------------------------------------------------------------------------
| Registries and policy engine
|--------------------------------------------------------------------------
|
| Execution rules, the agent/tool/skill/persona registries (reloaded when
| their files change) and the policy engine built from them.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const fs = require("fs");
const path = require("path");
const { PolicyEngine } = require("../policy");
const events = require("../events");
const settings = require("../config");
const { createExecutionRules } = require("../prompt/ExecutionRules");
const { createAgentRegistries } = require("../registry/AgentRegistries");
const registryLoader = require("../registry/RegistryLoader");
const AgentRegistry = require("../registry/AgentRegistry");
const ToolRegistry = require("../registry/ToolRegistry");
const SkillRegistry = require("../registry/SkillRegistry");


module.exports = function createRegistries(host) {

    const {
        CONFIG_DIR,
        REGISTRY_DIR,
        RUNTIME_DIR,
        SCHEMA_DIR,
        logLine,
        readText
    } = host;

    /* set up by a later factory, so looked up when called */
    const resolveTools = (...args) => host.resolveTools(...args);

    /*
    |--------------------------------------------------------------------------
    | Registry
    |--------------------------------------------------------------------------
    */

    /*
    |--------------------------------------------------------------------------
    | Registries
    |--------------------------------------------------------------------------
    |
    | These come from files, so they are cached rather than re-read on every
    | access, but the cache is invalidated when a file changes on disk. An
    | operator editing policy.json or agents.json next to a running console
    | gets the new behaviour on the next run instead of after a restart.
    |--------------------------------------------------------------------------
    */

    /*
    | Prompt files are re-read when they change, so editing the orchestrator
    | prompt or the execution rules does not need a restart either.
    */

    const executionRuleRuntime = createExecutionRules({
        fs,
        path,
        configDir: CONFIG_DIR,
        readText,
        allTools: () => TOOLS_OF(),
        resolveTools,
        getPolicyEngine: () => POLICY_ENGINE
    });

    const {
        executionRules,
        systemPrompt,
        filterExecutionRules
    } = executionRuleRuntime;


    const POLICY_ENGINE_HOLDER = { engine: null };

    const agentRegistries = createAgentRegistries({
        path,
        settings,
        registryLoader,
        AgentRegistry,
        ToolRegistry,
        SkillRegistry,
        events,
        policyEngineHolder: POLICY_ENGINE_HOLDER,
        registryDir: REGISTRY_DIR,
        schemaDir: SCHEMA_DIR,
        runtimeDir: RUNTIME_DIR
    });

    const {
        registrySignature,
        loadRegistries,
        PERSONAS_OF,
        SKILLS_OF,
        TOOLS_OF,
        TOOL_GROUPS_OF,
        POLICY_OF,
        AGENTS_OF,
        RESPONSE_FORMAT_OF,
        CONFIGURED_RUNTIME_OF,
        PERSONA_REGISTRY_OF,
        SKILL_REGISTRY_OF,
        TOOL_REGISTRY_OF,
        AGENT_REGISTRY_OF
    } = agentRegistries;


    /*
    | The personas the discussion_* profiles point at. They exist in the
    | registries for validation and tool mapping, but the prompt catalogues
    | stay focused on delegation, so call sites that build those catalogues
    | filter them out with this set.
    */

    function discussionPersonaNames() {

        const names = new Set();

        for (const agent of AGENTS_OF()) {

            if (agent.name.startsWith("discussion_") && agent.persona) {
                names.add(agent.persona);
            }
        }

        return names;
    }


    /*
    |--------------------------------------------------------------------------
    | Policy Engine
    |--------------------------------------------------------------------------
    |
    | The Agent Profile decides which capabilities an agent has. The policy
    | engine decides whether a particular call may run, and is the only place
    | that can deny or escalate to approval.
    |--------------------------------------------------------------------------
    */

    POLICY_ENGINE_HOLDER.engine =
        new PolicyEngine({
            policy: POLICY_OF(),

            toolGroups: TOOL_GROUPS_OF(),

            onDecision: decision => {

                events.emit("policy:decision", decision);

                if (decision.decision === "allow") {
                    return;
                }

                logLine(
                    decision.agent,
                    `Policy ${decision.decision} for ${
                        decision.tool
                    }${
                        decision.approved === undefined
                            ? ""
                            : decision.approved
                                ? ` (approved, ${decision.approval_mode})`
                                : " (rejected)"
                    }: ${decision.reason}`
                );
            }
        });


    const POLICY_ENGINE =
        POLICY_ENGINE_HOLDER.engine;


    return {
        AGENTS_OF,
        AGENT_REGISTRY_OF,
        CONFIGURED_RUNTIME_OF,
        PERSONAS_OF,
        PERSONA_REGISTRY_OF,
        POLICY_ENGINE,
        POLICY_OF,
        RESPONSE_FORMAT_OF,
        SKILLS_OF,
        SKILL_REGISTRY_OF,
        TOOLS_OF,
        TOOL_GROUPS_OF,
        TOOL_REGISTRY_OF,
        discussionPersonaNames,
        executionRules,
        filterExecutionRules,
        loadRegistries,
        registrySignature,
        systemPrompt
    };
};
