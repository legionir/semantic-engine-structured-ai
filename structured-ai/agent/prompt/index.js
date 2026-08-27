/*
|--------------------------------------------------------------------------
| Prompt Kit
|--------------------------------------------------------------------------
|
| Phase 5 of EXECUTION_PLAN: the prompt-building modules, gated by the
| PROMPT_BUILDER_MODE setting ('legacy' default, 'modular' for the
| injected builders). Anything above an empty/unknown value behaves as
| legacy, so a misspelled flag can never silently fork the engine.
|
| createPromptBuilder(deps) assembles the facade from injected closures;
| the resolvers are exported separately because the engine also uses
| them directly (tools list of a profile, rules filtering).
|--------------------------------------------------------------------------
*/

const settings = require("../lib/storage");

const PromptBuilder = require("./PromptBuilder");
const MainPromptBuilder = require("./MainPromptBuilder");
const SubAgentPromptBuilder = require("./SubAgentPromptBuilder");
const RuntimeContextBuilder = require("./RuntimeContextBuilder");
const ProjectContextBuilder = require("./ProjectContextBuilder");
const RequestBuilder = require("./RequestBuilder");
const PromptMessages = require("./PromptMessages");
const { createToolResolver } = require("./ToolResolver");
const { createSkillResolver } = require("./SkillResolver");


function promptBuilderMode() {

    return (
        settings.get("PROMPT_BUILDER_MODE") === "modular"
            ? "modular"
            : "legacy"
    );

}


function createPromptBuilder(deps) {

    const projectContextBuilder =
        new ProjectContextBuilder({
            listProjects: deps.listProjects
        });

    const runtimeContextBuilder =
        new RuntimeContextBuilder(deps.runtimeContext);

    const sharedRuntimeContext =
        () => runtimeContextBuilder.build();

    return new PromptBuilder({
        mainPromptBuilder:
            new MainPromptBuilder({
                ...deps.main,
                runtimeContext: sharedRuntimeContext,
                projectContextBuilder
            }),
        subAgentPromptBuilder:
            new SubAgentPromptBuilder({
                ...deps.subAgent,
                runtimeContext: sharedRuntimeContext,
                projectContextBuilder
            }),
        runtimeContextBuilder,
        projectContextBuilder,
        requestBuilder:
            new RequestBuilder(deps.request)
    });

}


module.exports = {
    createPromptBuilder,
    createToolResolver,
    createSkillResolver,
    promptBuilderMode,
    PromptBuilder,
    MainPromptBuilder,
    SubAgentPromptBuilder,
    RuntimeContextBuilder,
    ProjectContextBuilder,
    RequestBuilder,
    PromptMessages
};
