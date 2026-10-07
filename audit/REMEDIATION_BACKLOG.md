# REMEDIATION BACKLOG — consolidated open items
Source reports reconciled: `audit/REMEDIATION_PLAN.md` (Sections A–D), `audit/STATE.md`,
`audit/OPEN_ITEMS.md`, and the 2026-10-06 STATUS REPORT pasted by the owner.

Closed / DONE items from the source STATUS REPORT have been removed (F-0008, F-0014,
F-0017, F-0020, F-0024, F-0001, F-0007, F-0025, F-0026, F-0036, F-0037, F-0005, F-0003,
F-0027, get_recent_changes, B-1..B-5, C-0, C-1). Blocked items are kept visible but are
not actionable here. Deliberate-deferred items are listed at the bottom for reference.

Baseline in this sandbox (2026-10-07, Node 22, fixture generated): `tsc --noEmit` = 0;
`jest --ci` = 3213 passed / 0 failed / 92 skipped (before this cycle's fixes).

> **EXECUTED 2026-10-07:** every open product item below (P1 `c5llm`…`c7a19`,
> P2 `c8l4`…`c8a4`) is implemented with regression tests; ledger/filing items
> (`l1ids`, `l2count`, `unk2`, `fragile`, `prune`, `sec08file`, `lspeperm`) are
> filed under `audit/findings/`, `audit/COUNT_RECONCILIATION.md`,
> `audit/unknowns.md` and `audit/HOUSEKEEPING.md`. Final full-suite run:
> **252 suites / 3249 tests passed, 0 failed, exit 0** (the +36 delta is the
> new F-00xx regression suites). Blocked and deferred items are untouched.

Legend: P0 security/correctness · P1 correctness/resource-safety/authz · P2 hygiene/CI.

---

## 1. P1 — authz / resource-safety / honest surface (execute top-to-bottom)

| # | id | Finding | Title | Acceptance criteria | Status |
|---|---|---|---|---|---|
| 1 | c5llm | F-0030 (MED) | LLM `fetch` has no AbortSignal / timeout — hung provider stalls index/watch runs. | Add `AbortSignal.timeout()` (configurable) around the chat/embedding fetches in `OpenAILlmClient.complete`; cancellation must interrupt the in-flight request, not only between requests. Test: stalled server times out. | ✅ CLOSED 2026-10-07 |
| 2 | c6a10 | F-0010 (MED) | `allowedProjects` unenforced on the platform path. | Carry `allowedProjects` into `AuthContext` (platform) and enforce it in `PermissionChecker.hasPermission` so gateway + platform agree on the same set. Regression test. | ✅ CLOSED 2026-10-07 |
| 3 | c6a11 | F-0011 (MED) | Destructive/admin routes fall through to `defaultPermission`. | Explicit least-privilege permission per destructive/admin route; add a repo-wide scan test asserting no destructive/admin route relies on the default. | ✅ CLOSED 2026-10-07 |
| 4 | c6a9 | F-0009 (MED) | Public `POST /auth/verify` is an enumeration oracle. | Rate-limit (429) the public verify endpoints. Test proves the oracle is throttled. | ✅ CLOSED 2026-10-07 |
| 5 | c7a12 | F-0012 (MED) | Orphaned `IndexingWorker`/`InMemoryQueueAdapter`; `/ready` advertises a dead `jobQueue`. | Make `/ready` report honestly (never advertise a queue that is constructed but never started). | ✅ CLOSED 2026-10-07 |
| 6 | c7a23 | F-0023 (MED) | IAM `POST /users` `/roles` `/permissions` are no-op 201 stubs. | Return 501 (no side effect ⇒ no fake success). | ✅ CLOSED 2026-10-07 |
| 7 | c7a19 | F-0019 (MED) | `record-commit` builds O(n²) co-churn with unbounded growth. | Cap request payload length; bound the per-file co-churn maps (keep top-N). | ✅ CLOSED 2026-10-07 |

## 2. P2 — hygiene + self-covering CI

| # | id | Finding | Title | Acceptance criteria | Status |
|---|---|---|---|---|---|
| 8 | c8l4 | F-0002 (MED, 2nd half) | CI does not typecheck `*.test.ts`. | Add `tsconfig.test.json`; CI runs `tsc -p tsconfig.test.json --noEmit`. | ✅ CLOSED 2026-10-07 |
| 9 | c8a29 | F-0029 (LOW) | lone-CR (>maxFileSize) hash parity in `FileProcessor`. | Streaming path must apply `normalizeLineEndings` semantics (lone CR → LF), matching the in-memory path. Test. | ✅ CLOSED 2026-10-07 |
| 10 | c8a13 | F-0013 (LOW) | `direction:'both'` behaves as forward. | Implement the forward∪backward union in `CodeIntelligenceService.getDependencies`. Test. | ✅ CLOSED 2026-10-07 |
| 11 | c8a16 | F-0016 (LOW) | Impact severity non-monotonic by depth (else-if clobber). | Fix the branch chain so severity is monotonic by depth; test depth1≥depth2≥depth3. | ✅ CLOSED 2026-10-07 |
| 12 | c8a18 | F-0018 (LOW) | Recursive Tarjan stack-overflows on deep graphs. | Convert `ArchitectureRuleEngine.findCircularDependencies` to iterative; add a deep-chain regression test. | ✅ CLOSED 2026-10-07 |
| 13 | c8a21 | F-0021 (LOW) | `GET /config` hardcodes `embedding.model` literal. | Report the real configured model (thread resolved model into the surface) rather than a literal. | ✅ CLOSED 2026-10-07 |
| 14 | c8a22 | F-0022 (LOW) | Unwired `query_index`/`queryPolicy` dead module. | Lock its absence with a test that fails if it reappears in the registry. | ✅ CLOSED 2026-10-07 |
| 15 | c8a15 | F-0015 (LOW) | Handler families undocumented in OpenAPI (BND-0006). | Bring the code-only-route diff toward zero / document families. | ✅ CLOSED 2026-10-07 |
| 16 | c8a4 | F-0004 (INFO) | Bootstrap-token RBAC bypass. | Document as accepted risk with rationale (no bypass of real keys). | ✅ CLOSED 2026-10-07 |

## 3. Ledger / filing / housekeeping (no product code)

| # | id | Task | Status |
|---|---|---|---|
| 17 | l1ids | File finding ids F-0031..F-0037 under `audit/findings/` so the ledger matches. | ✅ CLOSED 2026-10-07 |
| 18 | l2count | Reconcile finding counts across STATE / EXECUTIVE_SUMMARY / FINAL_REPORT. | ✅ CLOSED 2026-10-07 |
| 19 | unk2 | Record native-optional-dependency evidence (UNKNOWN-0002). | ✅ CLOSED 2026-10-07 |
| 20 | fragile | Record timing-fragile AssembleContextTool SE-AI-18 budget. | ✅ CLOSED 2026-10-07 |
| 21 | prune | Note orphan project data dirs (do not delete user data silently). | ✅ CLOSED 2026-10-07 |
| 22 | sec08file | File SE-SEC-08 (fs/browse leak, already fixed) + update adjacent ledger rows. | ✅ CLOSED 2026-10-07 |
| 23 | lspeperm | Record lspIsolation EPERM temp-cleanup as environmental, not a defect. | ✅ CLOSED 2026-10-07 |

## 4. Blocked (leave visible, do not silently close)

| # | id | Why |
|---|---|---|
| 24 | blocked-ks | Kotlin/Swift grammar support needs a tree-sitter wasm toolchain absent here. |
| 25 | ff-main | fast-forward main → work/reconcile-remote: overwrites files held dirty by another agent; owner decision. |
| 26 | sa-web-flake | structured-ai `web.test.js` timing flake, pre-existing, out of this report's scope. |

## 5. Deliberately deferred (protected by rationale — do not re-open)

no-rust · no-go · no-cs · no-cpp · no-ns
