"use strict";

const { PERSONAS, OBSERVER } = require("./personas");
const { TranscriptStore, transcriptRepository } = require("./transcript");
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

/*
 * Runs fn over items with at most limit in flight, preserving order in
 * the results. The discussion borrows the runtime's MAX_PARALLEL_AGENTS
 * budget for this, so a 15-persona panel does not open 15 connections
 * at once.
 */
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    }
  );

  await Promise.all(workers);

  return results;
}

class DiscussionEngine {
  constructor(opts) {
    if (!opts.task) throw new Error("task is required");
    if (!opts.personas || opts.personas.length === 0) throw new Error("at least one persona required");
    if (!opts.llmCaller) throw new Error("llmCaller is required");

    this.task = opts.task;
    this.personaIds = opts.personas;
    this.maxRounds = opts.maxRounds || 5;
    this.maxParallel = opts.maxParallel || 4;
    this.llmCaller = opts.llmCaller;
    this.workspaceContext = opts.workspaceContext || "";
    this.projectId = opts.projectId || null;
    this.projectContext = opts.projectContext || null;
    this.onRound = opts.onRound || null; // callback(round, observerDecision)
    this.onMessage = opts.onMessage || null; // callback(message)
    this.onObserver = opts.onObserver || null; // callback(decision, round)

    // Resolve persona definitions
    this.personas = this.personaIds.map(id => {
      const found = PERSONAS.find(p => p.id === id);
      if (!found) throw new Error(`Unknown persona: ${id}. Available: ${PERSONAS.map(p => p.id).join(", ")}`);
      return found;
    });

    const repository =
      opts.transcriptRepository ||
      (opts.persistTranscript ? transcriptRepository : null);

    this.transcript = opts.transcript || new TranscriptStore({
      repository,
      root: opts.dataRoot || this.projectContext?.dataRoot,
      id: opts.discussionId,
      projectId: this.projectId,
      task: this.task,
      personas: this.personaIds,
      maxRounds: this.maxRounds,
      persist: opts.persistTranscript === true
    });

    this.transcript.save();

    this.personaRunner = new PersonaRunner({ llmCaller: this.llmCaller });
    this.observerRunner = new ObserverRunner({ llmCaller: this.llmCaller });
    this.loopDetector = new LoopDetector();

    /** @type {import('./types').ObserverDecision[]} */
    this.observerDecisions = [];
  }

  async runRound(roundNumber, observerInstructions = {}, isFirstRound = false) {
    const startedAt = Date.now();
    const messages = [];

    // Round 1 runs with isolation; round 2+ runs in parallel as well,
    // but each persona then gets the prior transcript and its targeted
    // instruction.
    const results = await mapLimited(this.personas, this.maxParallel, async (personaDef) => {
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

  recordObserverDecision(decision) {
    this.observerDecisions.push(decision);
    this.transcript.setObserverDecisions(this.observerDecisions);
    return decision;
  }

  async runInternal() {
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
    this.recordObserverDecision(observerDecision);
    if (this.onObserver) this.onObserver(observerDecision, 1);

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
        this.recordObserverDecision(forced);
        if (this.onObserver) this.onObserver(forced, r - 1);
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
      this.recordObserverDecision(observerDecision);
      if (this.onObserver) this.onObserver(observerDecision, r);

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
      this.recordObserverDecision(forced);
      if (this.onObserver) this.onObserver(forced, this.maxRounds);
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

  async run() {
    try {
      const result = await this.runInternal();
      this.transcript.setState({
        status: "done",
        finished_at: new Date().toISOString(),
        final_report: result.final_report,
        total_rounds: result.total_rounds,
        hit_max_rounds: result.hit_max_rounds,
        stopped_reason: result.stopped_reason || null
      });
      return result;
    } catch (error) {
      this.transcript.setState({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = { DiscussionEngine };
