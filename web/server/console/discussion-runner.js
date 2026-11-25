"use strict";

/*
|--------------------------------------------------------------------------
| Discussion runner
|--------------------------------------------------------------------------
|
| Starting a discussion between agents and streaming it as messages.
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/

const path = require("path");
const { DiscussionService } = require("../../../agent/discussion/DiscussionService");


module.exports = function createDiscussionRunner(shared) {

    const {
        addMessage,
        runtime,
        state
    } = shared;

    /*
    | A discussion is its own run: it does not go through the
    | delegation tree, so it keeps a separate status in state while
    | the conversation still records what was asked and what the
    | observer concluded. Rounds stream to the browser through the
    | same event bus the delegation tree uses, which is what makes
    | the live panel possible.
    */

    const DISCUSSION_MODULE =
        require(
            path.join(
                path.resolve(__dirname, "..", "..", ".."),
                "agent",
                "discussion"
            )
        );

    const discussionService =
        new DiscussionService({ runtime });


    async function startDiscussion({
        task,
        personas,
        maxRounds,
        projectId = null,
        projectContext = null,
        reasoningEffort = null
    }) {

        const {
            createLlmCaller,
            PERSONAS
        } = DISCUSSION_MODULE;

        const available = PERSONAS.map(persona => persona.id);
        const unknown = personas.filter(id => !available.includes(id));

        if (unknown.length > 0) {
            throw Object.assign(
                new Error(
                    `unknown persona: ${unknown[0]}; available: ${available.join(", ")}`
                ),
                { status: 400 }
            );
        }

        const caller =
            typeof runtime.callAI === "function"
                ? createLlmCaller({ callAI: runtime.callAI, reasoningEffort })
                : createLlmCaller({ endpointFor: runtime.endpointFor, reasoningEffort });

        const started =
            discussionService.start({
                task,
                personas,
                maxRounds,
                projectId,
                projectContext,
                llmCaller: caller,
                maxParallel: runtime.settings.get("MAX_PARALLEL_AGENTS"),
                persist: true,
                defer: true,
                onFinish: (result, discussion) => {
                    if (result.final_report?.summary) {
                        addMessage({
                            role: "assistant",
                            kind: "discussion-report",
                            content: result.final_report.summary
                        });
                    }

                    discussion.rounds = discussion.rounds || [];
                },
                onError: (error, discussion) => {
                    addMessage({
                        role: "assistant",
                        kind: "error",
                        content: `discussion failed: ${error.message}`
                    });
                    discussion.status = "failed";
                }
            });

        state.discussion = started.record;
        state.projectId = projectId || null;

        addMessage({
            role: "user",
            kind: "discussion-request",
            content: task,
            personas
        });

        return started.promise;
    }

    return {
        DISCUSSION_MODULE,
        discussionService,
        startDiscussion
    };
};
