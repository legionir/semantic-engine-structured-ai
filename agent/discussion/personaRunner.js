"use strict";

/**
 * PersonaRunner - runs a single persona for a single round
 * Reuses the same LLM calling logic as agent.js but isolated
 */

function buildFirstRoundPrompt(task, workspaceContext) {
  return `Task: ${task}

${workspaceContext ? `Workspace Context:\n${workspaceContext}\n` : ""}

You are in Round 1 — Independent opinions.

You do NOT see other personas' messages yet. Provide:
1. Your assessment of the task from your domain lens
2. Recommended approach
3. Key risks/concerns from your domain
4. Concrete suggestions (not generic)

Be specific, technical, and traceable to your domain.`;
}

function buildCrossExamPrompt(task, priorTranscript, observerInstruction, personaLens) {
  return `Task: ${task}

Prior discussion transcript (all previous rounds):
${priorTranscript}

Observer's specific instruction for you this round:
${observerInstruction || "React explicitly to other personas' proposals. Agree, disagree with reasoning, or refine your position. Do NOT restate unchanged opinion without addressing others' points."}

Your lens: ${personaLens}

Rules for this round:
- You MUST explicitly react to other personas: agree, disagree (with reasoning), or refine.
- If you disagree, state the concrete risk/trade-off.
- If you agree, say so plainly.
- Address any unaddressed concerns the Observer flagged.
- Keep focused on your domain — do not comment outside unless it creates direct risk in your domain.`;
}

class PersonaRunner {
  /**
   * @param {Object} opts
   * @param {Function} opts.llmCaller - async (messages, personaDef) => { content: string }
   * @param {number} opts.maxCharsPerMessage
   */
  constructor(opts = {}) {
    this.llmCaller = opts.llmCaller;
    this.maxCharsPerMessage = opts.maxCharsPerMessage || 6000;
  }

  async runRoundOne({ task, personaDef, workspaceContext }) {
    const prompt = buildFirstRoundPrompt(task, workspaceContext);
    const messages = [
      { role: "system", content: personaDef.system_prompt },
      { role: "user", content: prompt }
    ];

    const result = await this.llmCaller(messages, personaDef);
    return {
      persona: personaDef.id,
      persona_name: personaDef.name,
      round: 1,
      content: result.content,
      timestamp: Date.now(),
      tools_used: result.tools_used || []
    };
  }

  async runCrossExam({ task, personaDef, roundNumber, priorTranscript, observerInstruction }) {
    const prompt = buildCrossExamPrompt(task, priorTranscript, observerInstruction, personaDef.description);
    const messages = [
      { role: "system", content: personaDef.system_prompt },
      { role: "user", content: prompt }
    ];

    const result = await this.llmCaller(messages, personaDef);
    return {
      persona: personaDef.id,
      persona_name: personaDef.name,
      round: roundNumber,
      content: result.content,
      timestamp: Date.now(),
      tools_used: result.tools_used || []
    };
  }
}

module.exports = { PersonaRunner, buildFirstRoundPrompt, buildCrossExamPrompt };
