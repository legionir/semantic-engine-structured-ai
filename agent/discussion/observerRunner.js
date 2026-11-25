"use strict";

const { OBSERVER } = require("./personas");

function buildObserverPrompt(task, transcriptFormatted, currentRound, maxRounds, previousDecisions) {
  const prev = previousDecisions.length > 0
    ? `Previous Observer decisions:\n${JSON.stringify(previousDecisions.slice(-2), null, 2)}\n`
    : "";

  return `Task: ${task}
Current Round: ${currentRound} / ${maxRounds} (hard stop)
${prev}
Full discussion transcript so far:
${transcriptFormatted}

Your job:
1. Identify agreements, unresolved disagreements (which agents, why), and unaddressed concerns.
2. Decide CONTINUE or FINISH.
   - CONTINUE only if genuine unresolved disagreement or missing info remains that another round could plausibly resolve, AND round limit not reached.
   - FINISH if: workable consensus reached, OR disagreement is irreducible, OR max rounds reached, OR agents are politely restating same points.

If CONTINUE:
- Summarize current state concisely (agreements + open points)
- Give each participating agent a specific, targeted instruction on exactly what unresolved point they must address next.

If FINISH:
- Produce final report:
  - one-paragraph plain-language summary of recommended approach
  - short list of points every agent agreed on
  - any unresolved disagreement explicitly with each side's reasoning (do not silently pick winner)
  - concrete, actionable next step ordered by layer

Output MUST be valid JSON matching the schema described in your system prompt. No markdown fence, just JSON.`;
}

/*
 * A FINISH without a report is a protocol violation: the report is the
 * only output the user sees, so every path that ends the discussion
 * must guarantee one, even if the model disobeyed the shape.
 */
function ensureFinalReport(parsed) {
  if (parsed.final_report && typeof parsed.final_report === "object") {
    return parsed.final_report;
  }

  return {
    summary:
      (parsed.final_report && typeof parsed.final_report.summary === "string")
        ? parsed.final_report.summary
        : "The observer finished the discussion; its report was malformed, so this is the recovered summary of the agreements and open points.",
    agreed_points: parsed.agreements || [],
    unresolved: (parsed.open_points || []).map(op => ({
      topic: op.topic || "(topic)",
      sides: op.disagreeing
        ? op.disagreeing.map(d => ({ persona: d, reasoning: op.why || "" }))
        : []
    })),
    next_steps: [{ order: 1, layer: "user", action: "Review the unresolved points and decide" }]
  };
}

class ObserverRunner {
  constructor(opts = {}) {
    this.llmCaller = opts.llmCaller;
  }

  async review({ task, transcriptStore, currentRound, maxRounds, previousDecisions }) {
    const transcriptFormatted = transcriptStore.formatForPrompt();
    const prompt = buildObserverPrompt(task, transcriptFormatted, currentRound, maxRounds, previousDecisions);

    const messages = [
      { role: "system", content: OBSERVER.system_prompt },
      { role: "user", content: prompt }
    ];

    const result = await this.llmCaller(messages, OBSERVER);

    let parsed;
    try {
      // Try to parse JSON, handle code fence
      let content = result.content.trim();
      const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(content);
      if (fenceMatch) content = fenceMatch[1];
      parsed = JSON.parse(content);
    } catch (e) {
      // If parsing fails, treat as FINISH with raw content as summary
      return {
        decision: "FINISH",
        agreements: [],
        open_points: [],
        unaddressed: [],
        instructions: {},
        final_report: {
          summary: result.content.slice(0, 2000),
          agreed_points: [],
          unresolved: [{ topic: "Observer output was not valid JSON", sides: [{ persona: "observer", reasoning: e.message }] }],
          next_steps: [{ order: 1, layer: "observer", action: "Re-run observer with stricter JSON instruction" }]
        },
        _raw: result.content,
        _parse_error: e.message
      };
    }

    // Validate decision
    if (!["CONTINUE", "FINISH"].includes(parsed.decision)) {
      parsed.decision = currentRound >= maxRounds ? "FINISH" : "CONTINUE";
    }

    // Hard stop enforcement
    if (currentRound >= maxRounds && parsed.decision !== "FINISH") {
      parsed.decision = "FINISH";
    }

    if (parsed.decision === "FINISH") {
      parsed.final_report = ensureFinalReport(parsed);
    }

    return parsed;
  }

  async forceFinish({ task, transcriptStore, previousDecisions, maxRounds }) {
    const transcriptFormatted = transcriptStore.formatForPrompt();
    const prompt = `Task: ${task}
Transcript:
${transcriptFormatted}

The discussion has hit max rounds (${maxRounds}) or is stuck in repetition. You MUST produce a final report NOW.

Previous decisions:
${JSON.stringify(previousDecisions.slice(-2), null, 2)}

Produce JSON with decision=FINISH and final_report containing summary, agreed_points, unresolved (explicit), next_steps. Flag unresolved as open decisions for user.`;

    const messages = [
      { role: "system", content: OBSERVER.system_prompt },
      { role: "user", content: prompt }
    ];

    const result = await this.llmCaller(messages, OBSERVER);
    try {
      let content = result.content.trim();
      const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(content);
      if (fenceMatch) content = fenceMatch[1];
      const parsed = JSON.parse(content);
      parsed.decision = "FINISH";
      parsed.final_report = ensureFinalReport(parsed);
      return parsed;
    } catch {
      return {
        decision: "FINISH",
        agreements: [],
        open_points: [],
        unaddressed: [],
        instructions: {},
        final_report: {
          summary: result.content.slice(0, 2000),
          agreed_points: [],
          unresolved: [],
          next_steps: [{ order: 1, layer: "user", action: "Review transcript manually" }]
        },
        _raw: result.content
      };
    }
  }
}

module.exports = { ObserverRunner, buildObserverPrompt };
