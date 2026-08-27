"use strict";

/*
| A tiny OpenAI-compatible stub for local demos and tests of the
| discussion system. Personas get a lens-appropriate canned position;
| the observer follows the real protocol: CONTINUE after round one
| with a targeted instruction, FINISH with a structured report once
| the transcript shows two rounds.
*/

const http = require("http");
const path = require("path");

const PORT = Number(process.env.STUB_MODEL_PORT || 8899);

const { PERSONAS } = require(
    path.join(__dirname, "..", "structured-ai", "agent", "discussion", "personas.js")
);

const SYSTEM_TO_ID = new Map(
    PERSONAS.map(persona => [persona.system_prompt, persona.id])
);

const POSITIONS = {
    security: "Security: any token the client can read is stealable — XSS turns it into an account takeover. Recommend httpOnly, Secure, SameSite=Strict cookies for the JWT; the real open risk then becomes CSRF, which needs an explicit mitigation (double-submit token or SameSite enforcement plus CSRF token for stateful routes).",
    backend: "Backend: shape the API so the cookie is the only credential — POST /api/auth/login (Set-Cookie), POST /api/auth/refresh with rotation and reuse detection, GET /api/session for state, POST /api/auth/logout (revoke + clear cookie). All error codes machine-readable.",
    database: "Database: keep a sessions table (user_id, token_hash, expires_at, revoked_at) so refresh tokens can be rotated and revoked; index on token_hash. Stateless JWT cannot be revoked, which is a real operational difference worth stating.",
    frontend: "Frontend: with an httpOnly cookie the client cannot read the token, so useSession must GET /api/session on load and after refresh; keep auth state in one provider, not per-component. The cost is one extra round trip and no direct token access in JS.",
    architect: "Architecture: this is a cross-cutting concern — the decision belongs to the backend (credential issuance) with a thin contract for the client. Keep the session contract in one module so security, backend and frontend are not each inventing a shape.",
    performance: "Performance: a ~500-byte cookie per request is negligible; the real cost is a session lookup per request — cache it (Redis) with a TTL matched to the token expiry, or verify the JWT signature in memory and only hit the store on refresh.",
    qa: "QA: the interesting edge cases are refresh-token reuse after rotation, concurrent refreshes, cookie loss on mobile, and logout propagation. Each needs an integration test; the rotation logic is the one place a unit test matrix pays off.",
    devops: "DevOps: no new infrastructure for MVP; if sessions move to Redis that is one more service to run and back up. Rollout is safe behind a feature flag because the old flow stays available during migration.",
    cost: "Cost: the only recurring cost is a cache tier if we add one — trivial at startup scale. Managed auth would be a fixed SaaS fee; rolling our own keeps marginal cost near zero.",
    accessibility: "Accessibility: the auth flow must be keyboard-navigable and state changes (signed in/out) announced to screen readers; the session expiry redirect must not trap focus.",
    data: "Data: log auth events (login, refresh, logout, reuse detected) as trackable events for abuse detection; do not log the token itself.",
    compliance: "Compliance: personal data in sessions requires a retention policy and a deletion path; data minimization argues for storing the minimum in the cookie and nothing personal in it.",
    mobile: "Mobile: cookies behave differently in webviews (WKWebView/Safari ITP); the fallback is a server-side session with a long-lived refresh token. Flag any flow that assumes desktop cookie behavior.",
    ml: "ML: no AI component in this task — nothing to evaluate on that lens.",
    legacy: "Legacy: if an existing app reads JWTs from localStorage, the migration is a breaking client change — ship both flows during a deprecation window and kill the old one after the window."
};

const server = http.createServer((req, res) => {

    let body = "";

    req.on("data", chunk => (body += chunk));

    req.on("end", () => {

        let parsed;

        try {
            parsed = JSON.parse(body);
        } catch {
            res.statusCode = 400;
            res.end("{}");
            return;
        }

        const system = parsed.messages?.[0]?.content || "";
        const user = parsed.messages?.[1]?.content || "";

        let content;

        if (system.startsWith("You are the Observer Agent")) {

            const rounds = (user.match(/=== Round/g) || []).length;

            content =
                rounds >= 2
                    ? JSON.stringify({
                        decision: "FINISH",
                        agreements: [
                            "the JWT must not be stored where client script can read it",
                            "the backend owns issuance, refresh and revocation",
                            "session state reaches the client through an API endpoint, not direct cookie access"
                        ],
                        open_points: [],
                        unaddressed: [],
                        instructions: {},
                        final_report: {
                            summary:
                                "Store the JWT in an httpOnly, Secure, SameSite cookie issued by the backend; rotate refresh tokens with reuse detection; the client reads session state through GET /api/session. The group could not close the CSRF question: it is real, and the mitigation (double-submit token versus SameSite-only) is a genuine trade-off the user should decide, with the default recommendation being SameSite=Lax plus a CSRF token on stateful mutations.",
                            agreed_points: [
                                "no client-readable token storage",
                                "backend owns the token lifecycle",
                                "GET /api/session as the client contract"
                            ],
                            unresolved: [
                                {
                                    topic: "CSRF mitigation for the httpOnly cookie",
                                    sides: [
                                        {
                                            persona: "security",
                                            reasoning: "httpOnly blocks XSS theft but not CSRF; an explicit anti-CSRF token is required for stateful routes"
                                        },
                                        {
                                            persona: "frontend",
                                            reasoning: "a double-submit token adds a fetch before every stateful call; SameSite=Lax already blocks cross-site top-level requests"
                                        }
                                    ]
                                }
                            ],
                            next_steps: [
                                { order: 1, layer: "backend", action: "POST /api/auth/login that sets the httpOnly cookie and issues the session" },
                                { order: 2, layer: "backend", action: "POST /api/auth/refresh with rotation and reuse detection" },
                                { order: 3, layer: "database", action: "sessions table with token_hash index" },
                                { order: 4, layer: "frontend", action: "useSession provider reading GET /api/session" },
                                { order: 5, layer: "security", action: "decide and implement the CSRF mitigation" }
                            ]
                        }
                    })
                    : JSON.stringify({
                        decision: "CONTINUE",
                        agreements: ["the token must not live where XSS can reach it"],
                        open_points: [
                            {
                                topic: "CSRF vs direct client access",
                                disagreeing: ["security vs frontend"],
                                why: "httpOnly blocks XSS but opens CSRF; the client loses direct token access"
                            }
                        ],
                        unaddressed: ["frontend has not answered the CSRF concern"],
                        instructions: {
                            security: "State exactly which CSRF mitigation you require and why SameSite alone is or is not enough.",
                            frontend: "Propose the API shape that consumes the httpOnly cookie and say plainly whether you accept the CSRF token cost.",
                            backend: "Confirm the refresh endpoint supports rotation with reuse detection."
                        },
                        final_report: null
                    });
        } else {

            content =
                POSITIONS[SYSTEM_TO_ID.get(system)] ||
                "A considered position from my domain lens.";
        }

        res.setHeader("content-type", "application/json");
        res.end(
            JSON.stringify({
                choices: [{ message: { content } }]
            })
        );
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`stub model on :${PORT}`);
});
