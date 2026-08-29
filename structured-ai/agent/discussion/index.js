"use strict";

const { PERSONAS, OBSERVER } = require("./personas");
const { DiscussionEngine } = require("./engine");
const { TranscriptStore } = require("./transcript");
const { TranscriptRepository, transcriptRepository } = require("./TranscriptRepository");
const { DiscussionService } = require("./DiscussionService");
const DiscussionContext = require("./DiscussionContext");
const { PersonaRunner } = require("./personaRunner");
const { ObserverRunner } = require("./observerRunner");
const { LoopDetector } = require("./loopDetector");

/**
 * Factory for an LLM caller that speaks the discussion protocol:
 *
 *   async (messages, personaDef) => { content: string }
 *
 * Two backends, in order of preference:
 *
 * 1. callAI   — the agent runtime's request path (agent.js). Preferred
 *               because it carries the role-based endpoint resolution
 *               (ENDPOINT_L1/L2/...), retries and the run budget.
 *
 * 2. endpointFor — a direct fetch to the resolved chat/completions
 *               endpoint, for standalone use (tests, scripts, the CLI
 *               discussion mode) where the full runtime is not loaded.
 */
function createLlmCaller({ callAI, endpointFor } = {}) {

    if (typeof callAI === "function") {

        return async (messages, personaDef) => {

            const data = await callAI({
                messages,
                agentDefinition: {
                    name: personaDef.id,
                    temperature: 0.2
                },
                tools: undefined,
                responseFormat: null,
                role: personaDef.model_role || "L1",
                scope: personaDef.id
            });

            const content =
                data?.choices?.[0]?.message?.content || "";

            return {
                content:
                    typeof content === "string"
                        ? content
                        : JSON.stringify(content)
            };
        };
    }

    if (typeof endpointFor === "function") {

        return async (messages, personaDef) => {

            const profile =
                endpointFor(personaDef.model_role || "L1", null);

            const response =
                await fetch(profile.endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${profile.api_key}`
                    },
                    body: JSON.stringify({
                        model: profile.model,
                        messages,
                        temperature: 0.2
                    })
                });

            const text = await response.text();

            if (!response.ok) {
                throw new Error(
                    `Model request failed (${response.status}): ${text.slice(0, 300)}`
                );
            }

            const data = JSON.parse(text);

            const content =
                data?.choices?.[0]?.message?.content || "";

            return {
                content:
                    typeof content === "string"
                        ? content
                        : JSON.stringify(content)
            };
        };
    }

    throw new Error(
        "createLlmCaller needs a callAI function (agent runtime) or an endpointFor function (standalone)"
    );
}

/**
 * The 15 selectable specialist personas, in registry order.
 */
function listPersonas() {

    return PERSONAS.map(persona => ({
        id: persona.id,
        name: persona.name,
        description: persona.description,
        model_role: persona.model_role
    }));
}

module.exports = {
    PERSONAS,
    OBSERVER,
    DiscussionEngine,
    TranscriptStore,
    TranscriptRepository,
    transcriptRepository,
    DiscussionService,
    DiscussionContext,
    PersonaRunner,
    ObserverRunner,
    LoopDetector,
    createLlmCaller,
    listPersonas
};
