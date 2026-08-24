"use strict";

/**
 * @typedef {Object} PersonaMessage
 * @property {string} persona - persona id
 * @property {string} persona_name - display name
 * @property {number} round - round number
 * @property {string} content - agent's contribution
 * @property {number} timestamp - ms
 * @property {string[]} [tools_used] - tools used in this turn
 */

/**
 * @typedef {Object} DiscussionRound
 * @property {number} round
 * @property {PersonaMessage[]} messages
 * @property {number} started_at
 * @property {number} ended_at
 */

/**
 * @typedef {Object} ObserverDecision
 * @property {"CONTINUE"|"FINISH"} decision
 * @property {string[]} agreements
 * @property {{topic:string, disagreeing:string[], why:string}[]} open_points
 * @property {string[]} unaddressed
 * @property {Record<string,string>} instructions - per-persona focused instruction
 * @property {FinalReport|null} final_report
 */

/**
 * @typedef {Object} FinalReport
 * @property {string} summary - one paragraph plain-language
 * @property {string[]} agreed_points
 * @property {{topic:string, sides:{persona:string, reasoning:string}[]}[]} unresolved
 * @property {{order:number, layer:string, action:string}[]} next_steps
 */

/**
 * @typedef {Object} DiscussionRequest
 * @property {string} task - user task description
 * @property {string[]} personas - selected persona ids
 * @property {number} max_rounds - hard stop, default 5
 * @property {string} [workspace_context] - optional workspace summary
 */

/**
 * @typedef {Object} DiscussionResult
 * @property {DiscussionRound[]} rounds
 * @property {ObserverDecision[]} observer_decisions
 * @property {FinalReport} final_report
 * @property {number} total_rounds
 * @property {boolean} hit_max_rounds
 */

module.exports = {};
