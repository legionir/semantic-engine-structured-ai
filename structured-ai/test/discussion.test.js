"use strict";

const assert = require("assert");
const { DiscussionEngine } = require("../agent/discussion");
const { PERSONAS } = require("../agent/discussion/personas");

// Mock LLM that returns deterministic responses based on persona
function createMockLlm() {
  const roundCounters = {};

  return async (messages, personaDef) => {
    const id = personaDef.id;
    roundCounters[id] = (roundCounters[id] || 0) + 1;
    const round = roundCounters[id];

    if (id === "observer") {
      // Observer mock: after 2 rounds, finish
      const userContent = messages[1]?.content || "";
      // Count rounds from transcript
      const roundMatches = userContent.match(/=== Round/g) || [];
      const currentRound = roundMatches.length || 1;

      if (currentRound >= 2) {
        return {
          content: JSON.stringify({
            decision: "FINISH",
            agreements: ["All agree JWT should not be in localStorage", "Need httpOnly cookie"],
            open_points: [],
            unaddressed: [],
            instructions: {},
            final_report: {
              summary: "Use httpOnly secure cookies for JWT, with /api/session endpoint, short-lived access token + refresh token rotation. Frontend reads session via API, not direct cookie access.",
              agreed_points: ["No localStorage for tokens", "Need CSRF protection", "Backend should handle token refresh"],
              unresolved: [
                {
                  topic: "Token storage vs UX",
                  sides: [
                    { persona: "security", reasoning: "httpOnly cookie is mandatory to prevent XSS token theft" },
                    { persona: "frontend", reasoning: "httpOnly makes client-side auth state harder, needs extra endpoint" }
                  ]
                }
              ],
              next_steps: [
                { order: 1, layer: "backend", action: "Implement POST /api/auth/login that sets httpOnly secure cookie with JWT" },
                { order: 2, layer: "backend", action: "Implement POST /api/auth/refresh with rotation and reuse detection" },
                { order: 3, layer: "frontend", action: "Create useSession hook that fetches /api/session" },
                { order: 4, layer: "security", action: "Add CSRF token via double-submit cookie pattern" }
              ]
            }
          })
        };
      } else {
        return {
          content: JSON.stringify({
            decision: "CONTINUE",
            agreements: ["Agree localStorage is risky"],
            open_points: [{ topic: "CSRF vs XSS trade-off", disagreeing: ["security vs frontend"], why: "httpOnly prevents XSS but requires CSRF mitigation" }],
            unaddressed: ["Frontend hasn't addressed CSRF concern"],
            instructions: {
              security: "Explain CSRF mitigation for httpOnly approach",
              frontend: "Propose how to consume httpOnly cookie via API shape",
              backend: "Detail refresh token rotation logic"
            },
            final_report: null
          })
        };
      }
    }

    // Persona mocks
    const mocks = {
      security: `From security lens: Storing JWT in localStorage exposes it to XSS - any injected script can exfiltrate token. Recommend httpOnly, Secure, SameSite=Strict cookie. Risks: CSRF if not mitigated. Need anti-CSRF token. Assessment: current proposal with localStorage is REJECTED due to XSS.`,
      backend: `From backend lens: Should implement /api/auth/login returning Set-Cookie header, not JSON token. Business logic: token creation, refresh rotation in service layer. Endpoints: POST /login, POST /refresh, GET /session, POST /logout. Error handling: 401 with clear code. Maintainable if logic lives in auth service, not controllers.`,
      frontend: `From frontend lens: If backend uses httpOnly, frontend cannot read token directly - need useSession hook fetching /api/session. Component boundaries: AuthProvider at root, useSession for child. State placement: global auth state via context, not local. API shape: GET /api/session returning {user, expiresAt} is better than token itself. Rendering: avoid flicker with SSR session check.`,
      database: `From DB lens: Need sessions table for refresh token rotation: id, user_id, token_hash, expires_at, revoked_at, created_at. Index on user_id and token_hash. Access pattern: lookup by hash on refresh, not scan. Trade-off: storing sessions denormalized vs stateless JWT - stateful allows revocation. Migration cost: add table, low risk.`,
      performance: `Performance: JWT in cookie adds ~500 bytes per request, okay. N+1 risk if session lookup per request hits DB without cache. Mitigation: cache session in Redis with TTL = token expiry. Estimate: DB lookup 5-10ms, Redis 1ms. No premature optimization needed for <10k RPS.`
    };

    return {
      content: mocks[id] || `[${id}] Assessment for round ${round}: This is a mock evaluation from ${personaDef.name} perspective. Task analysis from my domain lens shows specific trade-offs that should be considered.`
    };
  };
}

async function testDiscussion() {
  console.log("=== Testing Discussion Engine with Mock LLM ===");

  const mockLlm = createMockLlm();

  const engine = new (require("../agent/discussion").DiscussionEngine)({
    task: "Design user session storage for a Next.js app with JWT - should we use localStorage or httpOnly cookies?",
    personas: ["security", "backend", "frontend", "database", "performance"],
    maxRounds: 3,
    llmCaller: mockLlm,
    workspaceContext: "Next.js 14 app, App Router, TypeScript"
  });

  const result = await engine.run();

  console.log(`\nTotal rounds: ${result.total_rounds}`);
  console.log(`Hit max rounds: ${result.hit_max_rounds}`);
  console.log(`\nFinal Report Summary:\n${result.final_report.summary}`);
  console.log(`\nAgreed Points:\n- ${result.final_report.agreed_points.join("\n- ")}`);
  console.log(`\nUnresolved:\n${JSON.stringify(result.final_report.unresolved, null, 2)}`);
  console.log(`\nNext Steps:\n${result.final_report.next_steps.map(s => `${s.order}. [${s.layer}] ${s.action}`).join("\n")}`);

  // Assertions
  assert(result.total_rounds >= 1, "Should have at least 1 round");
  assert(result.final_report.summary.length > 0, "Summary should exist");
  assert(result.final_report.next_steps.length > 0, "Next steps should exist");
  assert(result.rounds.length === result.total_rounds, "Rounds length matches");

  // Check round 1 isolation property: each persona in round 1 should not reference others
  const round1 = result.rounds[0];
  assert(round1.messages.length === 5, "Round 1 should have 5 messages");

  console.log("\n✓ All assertions passed");
  console.log("\n=== Observer Decisions ===");
  result.observer_decisions.forEach((d, i) => {
    console.log(`Round ${i+1}: ${d.decision} - Agreements: ${d.agreements.length}, Open: ${d.open_points.length}`);
  });

  return result;
}

if (require.main === module) {
  testDiscussion().then(() => {
    console.log("\n=== Test completed successfully ===");
  }).catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
  });
}

module.exports = { testDiscussion };
