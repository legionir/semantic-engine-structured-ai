"use strict";

class TranscriptStore {
  constructor() {
    /** @type {import('./types').DiscussionRound[]} */
    this.rounds = [];
  }

  addRound(round) {
    this.rounds.push(round);
  }

  getAllMessages() {
    return this.rounds.flatMap(r => r.messages);
  }

  getMessagesForRound(roundNumber) {
    const found = this.rounds.find(r => r.round === roundNumber);
    return found ? found.messages : [];
  }

  getPriorMessagesForPersona(excludeRound = null) {
    // For cross-examination, each persona sees all other personas' prior messages
    if (excludeRound === null) return this.getAllMessages();
    return this.rounds.filter(r => r.round < excludeRound).flatMap(r => r.messages);
  }

  formatForPrompt(maxCharsPerMessage = 4000) {
    return this.rounds.map(round => {
      const header = `=== Round ${round.round} ===`;
      const msgs = round.messages.map(m => {
        const content = m.content.length > maxCharsPerMessage
          ? m.content.slice(0, maxCharsPerMessage) + "...[truncated]"
          : m.content;
        return `[${m.persona_name} (${m.persona})]:\n${content}`;
      }).join("\n\n");
      return `${header}\n${msgs}`;
    }).join("\n\n");
  }

  formatForPersona(personaId, roundNumber, maxChars = 4000) {
    // In round 1, persona should NOT see others' round 1 messages before submitting
    // So for round 1, return empty
    if (roundNumber === 1) return "(Round 1 - independent, no other messages visible)";
    const prior = this.rounds.filter(r => r.round < roundNumber);
    return prior.map(round => {
      const header = `--- Round ${round.round} ---`;
      const msgs = round.messages
        .filter(m => m.persona !== personaId) // optionally exclude self? spec says see all other personas
        .map(m => {
          const content = m.content.length > maxChars ? m.content.slice(0, maxChars) + "..." : m.content;
          return `[${m.persona_name}]: ${content}`;
        }).join("\n\n");
      return `${header}\n${msgs}`;
    }).join("\n\n");
  }

  toJSON() {
    return this.rounds;
  }
}

module.exports = { TranscriptStore };
