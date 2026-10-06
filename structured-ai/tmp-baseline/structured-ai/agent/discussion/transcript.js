"use strict";

const { transcriptRepository } = require("./TranscriptRepository");


/*
|--------------------------------------------------------------------------
| Discussion transcript model — EXECUTION_PLAN Phase 28
|--------------------------------------------------------------------------
|
| The round model stays in memory for prompt construction. When a repository
| and project data root are supplied, every round/observer update is also
| written through the Phase 18 atomic JSON repository. The default
| constructor remains the historical in-memory store.
|--------------------------------------------------------------------------
*/

class TranscriptStore {

  constructor(options = {}) {
    this.rounds = [];
    this.observerDecisions = [];
    this.repository = options.repository || null;
    this.root = options.root || null;
    this.id = options.id || null;
    this.projectId = options.projectId || null;
    this.metadata = {
      task: options.task || "",
      personas: Array.isArray(options.personas) ? [...options.personas] : [],
      max_rounds: options.maxRounds || 5,
      status: options.status || "running",
      started_at: options.startedAt || new Date().toISOString(),
      finished_at: null,
      final_report: null,
      total_rounds: 0,
      hit_max_rounds: false,
      stopped_reason: null,
      error: null
    };
    this.persistEnabled = options.persist === true || Boolean(options.repository);
  }


  persistenceEnabled() {
    return Boolean(
      this.persistEnabled &&
      this.repository &&
      this.root &&
      this.id
    );
  }


  addRound(round) {
    this.rounds.push(round);
    this.metadata.total_rounds = this.rounds.length;
    this.save();
    return round;
  }


  setObserverDecisions(decisions) {
    this.observerDecisions = Array.isArray(decisions) ? [...decisions] : [];
    this.save();
    return this.observerDecisions;
  }


  setState(patch = {}) {
    this.metadata = {
      ...this.metadata,
      ...patch
    };
    this.save();
    return this.metadata;
  }


  toDocument(patch = {}) {
    return {
      version: "1",
      id: this.id,
      project_id: this.projectId,
      ...this.metadata,
      rounds: this.rounds,
      observer_decisions: this.observerDecisions,
      ...patch
    };
  }


  save(patch = {}) {
    if (!this.persistenceEnabled()) return null;
    return this.repository.save(this.toDocument(patch), this.root);
  }


  static fromDocument(document, { repository = transcriptRepository, root, persist = false } = {}) {
    const store = new TranscriptStore({
      repository,
      root,
      id: document?.id,
      projectId: document?.project_id,
      task: document?.task,
      personas: document?.personas,
      maxRounds: document?.max_rounds,
      status: document?.status,
      persist
    });
    store.rounds = Array.isArray(document?.rounds) ? document.rounds : [];
    store.observerDecisions = Array.isArray(document?.observer_decisions)
      ? document.observer_decisions
      : [];
    store.metadata = {
      ...store.metadata,
      ...(document || {}),
      max_rounds: document?.max_rounds || store.metadata.max_rounds,
      total_rounds: document?.total_rounds ?? store.rounds.length
    };
    return store;
  }


  static load(id, root, repository = transcriptRepository) {
    const document = repository.load(id, root);
    return document
      ? TranscriptStore.fromDocument(document, { repository, root, persist: false })
      : null;
  }


  getAllMessages() {
    return this.rounds.flatMap(round => round.messages || []);
  }


  getMessagesForRound(roundNumber) {
    const found = this.rounds.find(round => round.round === roundNumber);
    return found ? found.messages : [];
  }


  getPriorMessagesForPersona(excludeRound = null) {
    if (excludeRound === null) return this.getAllMessages();
    return this.rounds
      .filter(round => round.round < excludeRound)
      .flatMap(round => round.messages || []);
  }


  formatForPrompt(maxCharsPerMessage = 4000) {
    return this.rounds.map(round => {
      const header = `=== Round ${round.round} ===`;
      const messages = (round.messages || []).map(message => {
        const content = String(message.content || "");
        const clipped = content.length > maxCharsPerMessage
          ? `${content.slice(0, maxCharsPerMessage)}...[truncated]`
          : content;
        return `[${message.persona_name} (${message.persona})]:\n${clipped}`;
      }).join("\n\n");
      return `${header}\n${messages}`;
    }).join("\n\n");
  }


  formatForPersona(personaId, roundNumber, maxChars = 4000) {
    /* Round 1 is intentionally isolated from all other opinions. */
    if (roundNumber === 1) return "(Round 1 - independent, no other messages visible)";

    return this.rounds
      .filter(round => round.round < roundNumber)
      .map(round => {
        const header = `--- Round ${round.round} ---`;
        const messages = (round.messages || [])
          .filter(message => message.persona !== personaId)
          .map(message => {
            const content = String(message.content || "");
            const clipped = content.length > maxChars
              ? `${content.slice(0, maxChars)}...`
              : content;
            return `[${message.persona_name}]: ${clipped}`;
          }).join("\n\n");
        return `${header}\n${messages}`;
      }).join("\n\n");
  }


  toJSON() {
    return this.rounds;
  }
}


module.exports = {
  TranscriptStore,
  transcriptRepository
};
