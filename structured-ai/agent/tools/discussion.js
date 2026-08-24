"use strict";

const path = require("path");

/**
 * discussion_start tool
 * Allows main_agent to trigger a multi-agent discussion
 */

let engineModule = null;

function getEngine() {
  if (!engineModule) {
    engineModule = require("../discussion");
  }
  return engineModule;
}

async function discussion_start(args, context) {
  const task = args.task;
  const personas = args.personas;
  const max_rounds = args.max_rounds || 5;

  if (!task || typeof task !== "string" || task.trim() === "") {
    throw new Error("task is required and must be non-empty string");
  }

  if (!Array.isArray(personas) || personas.length === 0) {
    throw new Error("personas must be non-empty array of persona ids");
  }

  // Validate personas
  const { PERSONAS } = getEngine();
  const available = PERSONAS.map(p => p.id);
  for (const p of personas) {
    if (!available.includes(p)) {
      throw new Error(`Unknown persona "${p}". Available: ${available.join(", ")}`);
    }
  }

  if (max_rounds < 1 || max_rounds > 10) {
    throw new Error("max_rounds must be between 1 and 10");
  }

  // For tool mode, we need llmCaller from runtime
  // We'll try to get it from global agent module
  let llmCaller;
  try {
    const agentRuntime = require("../agent");
    // Use agentRuntime's callAI if available
    if (agentRuntime && typeof agentRuntime.callAI === "function") {
      // This will be bound later - for now create wrapper
      llmCaller = async (messages, personaDef) => {
        // Simplified: use fetch via agentRuntime's internal
        // In real integration, inject proper callAI
        const data = await agentRuntime.callAI({
          messages,
          agentDefinition: { name: personaDef.id, temperature: 0.2 },
          tools: undefined,
          responseFormat: null,
          role: personaDef.model_role || "L1",
          scope: personaDef.id
        });
        const content = data?.choices?.[0]?.message?.content || "";
        return { content: typeof content === "string" ? content : JSON.stringify(content) };
      };
    }
  } catch {
    // ignore
  }

  // Fallback mock for testing without LLM
  if (!llmCaller) {
    llmCaller = async (messages, personaDef) => {
      return {
        content: `[MOCK ${personaDef.id}] Analysis of task "${task.slice(0, 100)}" from ${personaDef.name} lens. This is a mock response because no LLM caller is configured. In production, this would be a real LLM call with system prompt: ${personaDef.system_prompt.slice(0, 200)}...`
      };
    };
  }

  const { DiscussionEngine } = getEngine();
  const engine = new DiscussionEngine({
    task,
    personas,
    maxRounds: max_rounds,
    llmCaller,
    workspaceContext: context?.workspace || "",
    onRound: (round, observerDecision) => {
      // Could emit events here
    }
  });

  const result = await engine.run();

  // Return final report as tool result - this is what Observer produces
  return {
    ok: true,
    task,
    personas,
    total_rounds: result.total_rounds,
    hit_max_rounds: result.hit_max_rounds,
    final_report: result.final_report,
    rounds: result.rounds.map(r => ({
      round: r.round,
      messages: r.messages.map(m => ({ persona: m.persona, persona_name: m.persona_name, content: m.content.slice(0, 2000) }))
    })),
    observer_decisions: result.observer_decisions
  };
}

module.exports = {
  discussion_start,

  // For registry
  tools: {
    discussion_start: {
      description: "Start a multi-agent discussion with selected specialist personas. Each persona reasons from different priorities (security vs speed, etc.). Observer decides when to finish and produces final synthesis.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The task description to discuss, e.g. 'Design user session storage for Next.js app with JWT'"
          },
          personas: {
            type: "array",
            items: { type: "string" },
            description: "List of persona ids to include. Available: security, backend, database, frontend, architect, performance, qa, devops, cost, accessibility, data, compliance, mobile, ml, legacy"
          },
          max_rounds: {
            type: "integer",
            description: "Maximum discussion rounds (1-10), default 5",
            minimum: 1,
            maximum: 10
          }
        },
        required: ["task", "personas"],
        additionalProperties: false
      },
      execute: discussion_start
    }
  }
};
