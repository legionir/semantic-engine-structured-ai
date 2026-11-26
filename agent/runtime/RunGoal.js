"use strict";

/*
|--------------------------------------------------------------------------
| Run goal (roadmap P3-05)
|--------------------------------------------------------------------------
|
| A goal is the condition that ends a run ("all tests in test/web pass",
| "the README documents every setting"). The agent sees it on every
| iteration (RunDirectives); when it answers final, a short request to
| the SUMMARY endpoint compares the answer and the latest tool results
| with the goal. Not met: the agent is sent back with the reason, at most
| GOAL_MAX_CHECKS times; after that the final answer stands and the run
| reports the goal as not met. A checker that cannot answer never keeps
| the run going (met: null).
|--------------------------------------------------------------------------
*/

const settings = require("../config");

function evidenceFrom(messages, limit = 12000) {

    const EVIDENCE_CHARS = limit;
    const parts = [];
    let used = 0;

    for (let index = messages.length - 1; index >= 0 && used < EVIDENCE_CHARS; index--) {

        const message = messages[index];

        if (message.role !== "tool" && message.role !== "assistant") {
            continue;
        }

        const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");
        const piece = text.slice(-Math.min(3000, EVIDENCE_CHARS - used));

        parts.unshift(`[${message.role}] ${piece}`);
        used += piece.length;
    }

    return parts.join("\n\n");
}


function parseVerdict(text) {

    const raw = String(text || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start === -1 || end <= start) {
        return null;
    }

    try {

        const parsed = JSON.parse(raw.slice(start, end + 1));

        if (typeof parsed.met !== "boolean") {
            return null;
        }

        return { met: parsed.met, reason: String(parsed.reason || "").slice(0, 1000) };

    } catch {
        return null;
    }
}


/* { met: true | false | null, reason } */
async function checkGoal({ goal, action, messages = [], callAI }) {

    try {

        const response = await callAI({
            messages: [
                {
                    role: "system",
                    content: [
                        "You check whether an autonomous coding agent met the goal of its run.",
                        "Judge only from the evidence: the agent's final answer and its latest tool results.",
                        "A claim without evidence in the tool results is not enough when the goal is verifiable (tests, builds, files).",
                        "Answer with one JSON object and nothing else: {\"met\": true or false, \"reason\": \"one or two sentences\"}."
                    ].join(" ")
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        goal,
                        final_answer: action.response ?? null,
                        evidence: evidenceFrom(messages)
                    })
                }
            ],
            agentDefinition: { name: "goal_checker", temperature: 0, max_tokens: 400 },
            tools: undefined,
            responseFormat: null,
            role: "SUMMARY",
            scope: "goal_checker"
        });

        const verdict = parseVerdict(response?.choices?.[0]?.message?.content);

        return verdict || { met: null, reason: "the goal checker did not give a readable verdict" };

    } catch (error) {
        return { met: null, reason: `the goal checker failed: ${String(error.message).slice(0, 300)}` };
    }
}


function notMetMessage(goal, verdict, attempt) {

    return {
        role: "user",
        content: JSON.stringify({
            type: "runtime_notice",
            notice: "goal_not_met",
            goal,
            reason: verdict.reason,
            attempt,
            max_attempts: settings.get("GOAL_MAX_CHECKS"),
            instructions: "Your final answer does not meet the goal yet. Continue working toward it; answer final again once it holds, or explain precisely why it cannot."
        })
    };
}


module.exports = { checkGoal, notMetMessage, parseVerdict, evidenceFrom };
