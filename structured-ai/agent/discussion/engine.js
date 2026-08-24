"use strict";

const { PERSONAS, OBSERVER } = require("./personas");
const { TranscriptStore } = require("./transcript");
const { PersonaRunner } = require("./personaRunner");
const { ObserverRunner } = require("./observerRunner");
const { LoopDetector } = require("./loopDetector");

/**
 * DiscussionEngine - orchestrates multi-agent discussion
 * 
 * Usage:
 *   const engine = new DiscussionEngine({
 *     task: "Design auth...",
 *     personas: ["security", "backend", "frontend"],
 *     maxRounds: 5,
 *     llmCaller: async (messages, personaDef) => ({ content: "..." }),
 *     workspaceContext: "Next.js app, ..."
 *   });
 *   const result = await engine.run();
 */

class DiscussionEngine {
  constructor(opts) {
    if (!opts.task) throw new Error("task is required");
    if (!opts.personas || opts.personas.length === 0) throw new Error("at least one persona required");
    if (!opts.llmCaller) throw new Error("llmCaller is required");

    this.task = opts.task;
    this.personaIds = opts.personas;
    this.maxRounds = opts.maxRounds || 5;
    this.llmCaller = opts.llmCaller;
    this.workspaceContext = opts.workspaceContext || "";
    this.onRound = opts.onRound || null; // callback(round, observerDecision)
    this.onMessage = opts.onMessage || null; // callback(message)

    // Resolve persona definitions
    this.personas = this.personaIds.map(id => {
      const found = PERSONAS.find(p => p.id === id);
      if (!found) throw new Error(`Unknown persona: ${id}. Available: ${PERSONAS.map(p => p.id).join(", ")}`);
      return found;
    });

    this.transcript = new TranscriptStore();
    this.personaRunner = new PersonaRunner({ llmCaller: this.llmCaller });
    this.observerRunner = new ObserverRunner({ llmCaller: this.llmCaller });
    this.loopDetector = new LoopDetector();

    /** @type {import('./types').ObserverDecision[]} */
    this.observerDecisions = [];
  }

  async runRound(roundNumber, observerInstructions = {}, isFirstRound = false) {
    const startedAt = Date.now();
    const messages = [];

    // For round 1, run in parallel with isolation
    // For round 2+, also parallel but each gets prior transcript + instruction
    const promises = this.personas.map(async (personaDef) => {
      const instruction = observerInstructions[personaDef.id] || observerInstructions[personaDef.name] || null;
      let msg;
      if (isFirstRound) {
        msg = await this.personaRunner.runRoundOne({
          task: this.task,
          personaDef,
          workspaceContext: this.workspaceContext
        });
      } else {
        const priorTranscript = this.transcript.formatForPersona(personaDef.id, roundNumber);
        msg = await this.personaRunner.runCrossExam({
          task: this.task,
          personaDef,
          roundNumber,
          priorTranscript,
          observerInstruction: instruction
        });
      }
      if (this.onMessage) this.onMessage(msg);
      return msg;
    });

    // Respect max parallel - for simplicity, run all in parallel with Promise.all
    // In production, chunk by settings.get("MAX_PARALLEL_AGENTS")
    const results = await Promise.all(promises);
    messages.push(...results);

    const round = {
      round: roundNumber,
      messages,
      started_at: startedAt,
      ended_at: Date.now()
    };

    this.transcript.addRound(round);
    return round;
  }

  async run() {
    // Round 1
    const round1 = await this.runRound(1, {}, true);
    if (this.onRound) this.onRound(round1, null);

    // Observer after round 1
    let observerDecision = await this.observerRunner.review({
      task: this.task,
      transcriptStore: this.transcript,
      currentRound: 1,
      maxRounds: this.maxRounds,
      previousDecisions: this.observerDecisions
    });
    this.observerDecisions.push(observerDecision);

    if (observerDecision.decision === "FINISH") {
      return {
        rounds: this.transcript.rounds,
        observer_decisions: this.observerDecisions,
        final_report: observerDecision.final_report,
        total_rounds: 1,
        hit_max_rounds: false
      };
    }

    // Rounds 2..max
    for (let r = 2; r <= this.maxRounds; r++) {
      // Check loop before next round
      if (this.loopDetector.isStuck(this.transcript.rounds) || this.loopDetector.checkUnaddressedConcerns(this.observerDecisions)) {
        const forced = await this.observerRunner.forceFinish({
          task: this.task,
          transcriptStore: this.transcript,
          previousDecisions: this.observerDecisions,
          maxRounds: this.maxRounds
        });
        this.observerDecisions.push(forced);
        return {
          rounds: this.transcript.rounds,
          observer_decisions: this.observerDecisions,
          final_report: forced.final_report,
          total_rounds: r - 1,
          hit_max_rounds: false,
          stopped_reason: "loop_detected"
        };
      }

      const round = await this.runRound(r, observerDecision.instructions || {}, false);
      if (this.onRound) this.onRound(round, observerDecision);

      // Observer review
      observerDecision = await this.observerRunner.review({
        task: this.task,
        transcriptStore: this.transcript,
        currentRound: r,
        maxRounds: this.maxRounds,
        previousDecisions: this.observerDecisions
      });
      this.observerDecisions.push(observerDecision);

      if (observerDecision.decision === "FINISH") {
        return {
          rounds: this.transcript.rounds,
          observer_decisions: this.observerDecisions,
          final_report: observerDecision.final_report,
          total_rounds: r,
          hit_max_rounds: r >= this.maxRounds
        };
      }
    }

    // If loop ended without FINISH, force finish
    const lastDecision = this.observerDecisions[this.observerDecisions.length - 1];
    if (lastDecision.decision !== "FINISH") {
      const forced = await this.observerRunner.forceFinish({
        task: this.task,
        transcriptStore: this.transcript,
        previousDecisions: this.observerDecisions,
        maxRounds: this.maxRounds
      });
      this.observerDecisions.push(forced);
      return {
        rounds: this.transcript.rounds,
        observer_decisions: this.observerDecisions,
        final_report: forced.final_report,
        total_rounds: this.maxRounds,
        hit_max_rounds: true
      };
    }

    return {
      rounds: this.transcript.rounds,
      observer_decisions: this.observerDecisions,
      final_report: lastDecision.final_report,
      total_rounds: this.maxRounds,
      hit_max_rounds: true
    };
  }
}

module.exports = { DiscussionEngine };
