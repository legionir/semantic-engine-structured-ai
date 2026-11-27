/*
|--------------------------------------------------------------------------
| Main Prompt Builder
|--------------------------------------------------------------------------
|
| The orchestrator's opening messages, moved out of agent.js
| (EXECUTION_PLAN Phase 5, گام ۲). Message order is contractual:
|
|   1. system prompt (text)
|   2. execution rules (text)
|   3. runtime_context (JSON)
|   3a. project_context (JSON — additive, only when a project is scoped)
|   3b. project_instructions (JSON — additive, only when the workspace has
|       AGENTS.md / CLAUDE.md files; see ProjectInstructionsBuilder)
|   4. available_skills (JSON)
|   5. available_personas (JSON, only when the agent may delegate)
|   6. available_agents (JSON)
|   7. task (user)
|
| Every section arrives as an injected closure so registry edits and
| text-file changes remain visible without a restart, exactly as
| before.
|--------------------------------------------------------------------------
*/

const { jsonSystem } = require("./PromptMessages");
const { matchTriggers } = require("../tools/skills/MarkdownSkills");


class MainPromptBuilder {

    constructor(deps) {

        this.deps = deps;

    }


    build(task, { project } = {}) {

        const deps = this.deps;

        const projectMessage =
            deps.projectContextBuilder.build(project);

        const instructionsMessage =
            deps.projectInstructionsBuilder
                ? deps.projectInstructionsBuilder.build()
                : null;

        const skills =
            deps.skillIndex();

        /* skills whose trigger words occur in the task (roadmap P3-02) */
        const suggested =
            matchTriggers(
                skills,
                task && task.trim() !== "" ? task : ""
            );

        return [

            {
                role: "system",
                content:
                    deps.systemPrompt()
            },

            {
                role: "system",
                content:
                    deps.executionRules()
            },

            jsonSystem({
                type:
                    "runtime_context",

                context:
                    deps.runtimeContext()
            }),

            projectMessage,

            instructionsMessage,

            jsonSystem({
                type:
                    "available_skills",

                note:
                    "Names and descriptions only. Call skill_get before doing that kind of work to read its procedure and constraints.",

                skills,

                ...(suggested.length > 0
                    ? { suggested_for_this_task: suggested }
                    : {})
            }),

            /*
            | Personas exist so an ad-hoc agent can be composed. An
            | agent that may not delegate has no use for the catalogue,
            | so it is added below only when it can.
            |
            | Discussion personas are left out on purpose: they are not
            | delegation targets, they are run by the discussion engine
            | through discussion_start, and advertising all sixteen of
            | them would tax every request for a flow the orchestrator
            | reaches with a single tool call.
            */

            deps.mayDelegate()
                ? jsonSystem({
                      type:
                          "available_personas",

                      note:
                          "For composing an ad-hoc agent when no profile fits.",

                      personas:
                          deps.PERSONAS_OF()
                              .filter(
                                  persona =>
                                      !deps.discussionPersonaNames().has(
                                          persona.name
                                      )
                              )
                              .map(
                                  persona => ({
                                      name:
                                          persona.name,

                                      description:
                                          persona.description
                                  })
                              )
                  })
                : null,

            jsonSystem({
                type:
                    "available_agents",

                agents:
                    deps.AGENTS_OF()
                        .filter(
                            agent =>
                                agent.name !==
                                    "main_agent" &&
                                !agent.name.startsWith(
                                    "discussion_"
                                )
                        )
                        .map(
                        /*
                        | What choosing a specialist needs: what it
                        | is for and what it is allowed to do. Its
                        | output contract, its skills and its tool
                        | list are the sub-agent's own business, and
                        | were 3K characters of every request.
                        */

                        agent => ({
                            name:
                                agent.name,

                            description:
                                agent.description,

                            ...deps.describeCapability(agent),

                            can_delegate:
                                Boolean(agent.delegation?.enabled)
                        })
                    )
            }),

            {
                role: "user",
                content:
                    task && task.trim() !== ""
                        ? task
                        : deps.readTask()
            }
        ].filter(Boolean);
    }

}


module.exports = MainPromptBuilder;
