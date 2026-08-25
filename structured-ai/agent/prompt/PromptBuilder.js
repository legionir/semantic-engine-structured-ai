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
| Reached through PROMPT_BUILDER_MODE=modular; the legacy code paths
| stay untouched beside it until the parity evidence of this phase and
| the final cleanup phase remove them.
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


    mainMessages(task, { project } = {}) {

        return this.main.build(task, { project });

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
