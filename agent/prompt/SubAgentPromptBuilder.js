/*
|--------------------------------------------------------------------------
| Sub-Agent Prompt Builder
|--------------------------------------------------------------------------
|
| A specialist's opening messages, moved out of agent.js
| (EXECUTION_PLAN Phase 5, گام ۲):
|
|   0. system text — persona, filtered execution rules, agent runtime
|      rules, skills, output contract and delegation policy joined by
|      blank lines (buildSystemPrompt)
|   1. runtime_context (JSON)
|   2. agent_profile (JSON)
|   2a. project_context (JSON — additive, inherited from the parent run)
|   2b. project_instructions (JSON — additive, AGENTS.md / CLAUDE.md)
|   3. available_tools (JSON — names only; schemas ride the request)
|   4. task + parent context (user JSON)
|
|--------------------------------------------------------------------------
*/

const settings = require("../config");

const { jsonSystem, joinSections } = require("./PromptMessages");


class SubAgentPromptBuilder {

    constructor(deps) {

        this.deps = deps;

    }


    /* The historical buildAgentSystemPrompt, verbatim. */
    buildSystemPrompt(agentDefinition) {

        const capabilities =
            this.deps.resolveAgentCapabilities(
                agentDefinition
            );

        const personaText =
            capabilities.persona?.system_prompt ||
            "";

        return joinSections([
            personaText,

            this.deps.executionRules(agentDefinition),

            {
                type: "agent_runtime_rules",

                rules: [
                    "You are an Agent inside a hierarchical Agent Runtime.",
                    "You were given one task by a parent agent; complete that task and report back.",
                    "Use only the tools provided by the runtime.",
                    "Use only the skills assigned to your Agent Profile.",
                    "Return your findings with the final action; the parent agent sees only that response.",
                    "Never fabricate tool results.",
                    "Never claim an operation succeeded unless runtime results confirm it."
                ]
            },

            /*
            | A specialist's own skills are its job, so they are in its
            | prompt by default: two to five of them, and one skipped
            | skill_get would cost it the expertise it was created for.
            | SKILLS_INLINE_FOR_SUBAGENTS trades that for the index when
            | the tokens matter more.
            */

            {
                type: "skills",

                note:
                    settings.get("SKILLS_INLINE_FOR_SUBAGENTS") === true
                        ? undefined
                        : "Names only. Read one with skill_get before doing that kind of work.",

                skills:
                    settings.get("SKILLS_INLINE_FOR_SUBAGENTS") === true
                        ? capabilities.skills
                        : capabilities.skills.map(
                            skill => ({
                                name: skill.name,
                                description: skill.description
                            })
                        )
            },

            {
                type: "output_contract",

                output_contract:
                    agentDefinition.output_contract ||
                    [
                        "Report only results confirmed by runtime execution."
                    ]
            },

            {
                type: "delegation_policy",
                delegation:
                    agentDefinition.delegation ||
                    {
                        enabled: false,
                        max_depth: 0,
                        max_children: 0
                    }
            }
        ]);
    }


    build(agentDefinition, task, context, { project } = {}) {

        const systemPrompt =
            this.buildSystemPrompt(
                agentDefinition
            );

        const capabilities =
            this.deps.resolveAgentCapabilities(
                agentDefinition
            );

        const projectMessage =
            this.deps.projectContextBuilder.build(project);

        const instructionsMessage =
            this.deps.projectInstructionsBuilder
                ? this.deps.projectInstructionsBuilder.build()
                : null;

        return [

            {
                role: "system",

                content:
                    systemPrompt
            },

            jsonSystem({
                type:
                    "runtime_context",

                context:
                    this.deps.runtimeContext()
            }),

            /*
            | The profile used to travel whole: its persona, its skills,
            | its output contract and its tool list, every one of which
            | is already in the system prompt above or in the request's
            | tools. What is left is what the agent cannot see anywhere
            | else.
            */

            jsonSystem({
                type:
                    "agent_profile",

                name:
                    agentDefinition.name,

                description:
                    agentDefinition.description,

                may_delegate:
                    this.deps.mayDelegate(agentDefinition)
            }),

            projectMessage,

            instructionsMessage,

            jsonSystem({
                type:
                    "available_tools",

                note:
                    "Full parameter schemas travel in the request's tools field.",

                tools:
                    capabilities.tools.map(
                        tool => tool.function.name
                    )
            }),

            {
                role: "user",

                content:
                    JSON.stringify({
                        task,
                        context:
                            context ?? null
                    })
            }
        ].filter(Boolean);
    }

}


module.exports = SubAgentPromptBuilder;
