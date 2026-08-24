"use strict";

const { PERSONAS, OBSERVER } = require("./personas");
const { DiscussionEngine } = require("./engine");
const { TranscriptStore } = require("./transcript");
const { PersonaRunner } = require("./personaRunner");
const { ObserverRunner } = require("./observerRunner");
const { LoopDetector } = require("./loopDetector");

/**
 * Factory for real LLM caller that reuses existing agent.js primitives
 * @param {Object} deps - { endpointFor, callAI } or custom
 */
function createLlmCaller({ callAI, endpointFor, roleForDepth, settings }) {
  // This is a wrapper that can be injected with real runtime's callAI
  return async (messages, personaDef) => {
    // If callAI provided (from agent.js), use it
    if (callAI) {
      // Build minimal agent definition for this persona
      const agentDef = {
        name: personaDef.id,
        model: null,
        temperature: 0.2
      };
      // Use role based on persona's model_role
      const role = personaDef.model_role || "L1";
      // callAI expects messages, agentDefinition, tools, role, scope
      // For discussion we don't need tools, just completion
      const data = await callAI({
        messages,
        agentDefinition: agentDef,
        tools: undefined,
        responseFormat: null,
        role,
        scope: personaDef.id
      });
      const content = data?.choices?.[0]?.message?.content || "";
      return { content: typeof content === "string" ? content : JSON.stringify(content) };
    }

    // Fallback: direct fetch to endpoint (for standalone usage)
    throw new Error("No llmCaller provided - inject callAI from agent.js");
  };
}

module.exports = {
  PERSONAS,
  OBSERVER,
  DiscussionEngine,
  TranscriptStore,
  PersonaRunner,
  ObserverRunner,
  LoopDetector,
  createLlmCaller
};
