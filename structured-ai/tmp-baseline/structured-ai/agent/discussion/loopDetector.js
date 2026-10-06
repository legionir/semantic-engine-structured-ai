"use strict";

/**
 * Simple loop / repetition detector
 * Phase 1: heuristic - if same persona repeats very similar content across rounds
 * Phase 2 (future): embedding similarity
 */

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function jaccardSimilarity(a, b) {
  const setA = new Set(normalizeText(a).split(" "));
  const setB = new Set(normalizeText(b).split(" "));
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

class LoopDetector {
  constructor(opts = {}) {
    this.similarityThreshold = opts.similarityThreshold || 0.85;
    this.maxRepeatedRounds = opts.maxRepeatedRounds || 2;
  }

  isStuck(rounds) {
    if (rounds.length < 3) return false;

    // Check if last 2 rounds are very similar to previous for all personas
    const last = rounds[rounds.length - 1];
    const prev = rounds[rounds.length - 2];

    let repeatedCount = 0;
    for (const msg of last.messages) {
      const prevMsg = prev.messages.find(m => m.persona === msg.persona);
      if (!prevMsg) continue;
      const sim = jaccardSimilarity(msg.content, prevMsg.content);
      if (sim > this.similarityThreshold) repeatedCount++;
    }

    // If >50% of personas are repeating, consider stuck
    if (last.messages.length > 0 && repeatedCount / last.messages.length > 0.5) {
      return true;
    }

    // Also check if observer previously flagged same open points twice
    return false;
  }

  checkUnaddressedConcerns(observerDecisions) {
    if (observerDecisions.length < 2) return false;
    const last = observerDecisions[observerDecisions.length - 1];
    const prev = observerDecisions[observerDecisions.length - 2];
    if (!last.unaddressed || !prev.unaddressed) return false;
    const same = last.unaddressed.filter(u => prev.unaddressed.includes(u));
    return same.length > 0 && same.length === last.unaddressed.length;
  }
}

module.exports = { LoopDetector, jaccardSimilarity };
