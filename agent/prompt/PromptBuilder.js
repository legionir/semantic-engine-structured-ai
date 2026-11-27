/*
|--------------------------------------------------------------------------
| Prompt Builder (facade)
|--------------------------------------------------------------------------
|
| One narrow surface for everything the runtime asks about prompts:
| main and sub-agent opening messages, the dynamic runtime context and
| its per-iteration refresh, the additive project message, and the
| model request body. Composes the specialised builders; knows neither
| agent.js globals nor how its dependencies fetch live state — those
| closures are supplied by whoever creates it (the engine wires them to
| its own live views).
|
| This is the sole prompt assembly path after the canonical rollout; its
| dependencies remain injected so the boundary stays independently testable.
|--------------------------------------------------------------------------
*/

class PromptBuilder {

    constructor({
        mainPromptBuilder,
        subAgentPromptBuilder,
        runtimeContextBuilder,
        projectContextBuilder,
        requestBuilder
    }) {

        this.main = mainPromptBuilder;

        this.subAgent = subAgentPromptBuilder;

        this.runtimeContext = runtimeContextBuilder;

        this.projectContext = projectContextBuilder;

        this.requests = requestBuilder;

    }


    mainMessages(task, { project, omitSkillIndex } = {}) {

        return this.main.build(task, { project, omitSkillIndex });

    }


    skillIndexMessage(task) {

        return this.main.skillIndexMessage(task);

    }


    subAgentMessages(
        agentDefinition,
        task,
        context,
        { project } = {}
    ) {

        return this.subAgent.build(
            agentDefinition,
            task,
            context,
            { project }
        );

    }


    subAgentSystemPrompt(agentDefinition) {

        return this.subAgent.buildSystemPrompt(agentDefinition);

    }


    runtimeContextMessage() {

        return this.runtimeContext.build();

    }


    refreshRuntimeContext(messages) {

        return this.runtimeContext.refresh(messages);

    }


    projectMessage(project) {

        return this.projectContext.build(project);

    }


    request(args) {

        return this.requests.build(args);

    }

}


module.exports = PromptBuilder;
