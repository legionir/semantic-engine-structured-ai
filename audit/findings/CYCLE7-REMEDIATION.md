# Cycle-7 per-item verification & remediation — 2026-10-08

This cycle's work was verified against the CURRENT checkout with executable
evidence (§4.1: a label is never the proof). Every claim below names the test
or command that demonstrates it.

## Canonical ledger count — corrected by direct measurement

Programmatic parse of `audit/FINDING_INDEX.tsv` (10 columns, no blank rows, no
duplicate ids): **161 data rows.** The cycle brief's "159" figure was stale:
the ledger gained the two verified rows `SE-AI-19` and `SE-AI-20` in the
2026-10-07 ledger reconciliation, and `COUNT_RECONCILIATION.md` (written
2026-10-07, before that append) still carried the pre-append number. The
earlier "33 invalid" count was also an artifact: two genuinely-INVALID rows
(`SE-F-011`, `SE-DEBT-001`) stored their `fix_status` as a CSV-quoted JSON
blob inside the TSV; a naive reader missed them. The artifacts are now cleaned
(content preserved) and `audit/tools/verify_ledger.py` fails loudly if they —
or any arithmetic drift — reappear.

Post-remediation disposition (from `python3 audit/tools/verify_ledger.py`):

| disposition | count |
|---|---|
| FIXED | 99 |
| INVALID | 35 |
| SUPERSEDED | 7 |
| DUPLICATE | 17 |
| PARTIAL | 1 (SA-F-016) |
| OPEN | 2 (SE-ARCH-001, SE-ARCH-002 — deferred by decision, see below) |
| **TOTAL** | **161** |

99 + 35 + 7 + 17 + 1 + 2 = 161 ✓

## Items remediated this cycle

### SE-F-057 — gateway dashboard config editing (FIXED)

- Root cause (three layers, all real): the form's `save()` sent only
  `path/name/id/autoStart` (§ evidence at the original audit line); it always
  POSTed to the collection even when editing; and the backend had no place to
  persist a worker config at all, so even a complete payload would have had
  nothing to update.
- Fix: per-project `worker-config.json` under the data root (atomic tmp+rename
  like the registry), accepted by POST and PATCH with validate-before-write
  (an invalid edit or a secret in the body is rejected 400 and the stored
  config is byte-unchanged); `GET /api/v1/gateway/projects/:id` returns the
  effective config so the form hydrates every field; update restarts a running
  worker so the edit is live, and reports a failed restart truthfully (500,
  config disclosed as stored); identity fields always come from the registry,
  never the payload.
- Regression: `gatewayUi.test.ts` (pure request-contract: create=POST,
  update=PATCH/<id>, every schema key present, explicit null for cleared
  optionals, URL escaping) + `GatewayServer.test.ts` (PATCH stores/returns/
  re-reads the full config; single-field edit preserves unrelated fields;
  persistence survives a fresh GatewayServer over the same data root; invalid
  debounce rejected with config unchanged; apiKey refused).
- AI-context validation: the detail response now discloses the EFFECTIVE
  config (not the requested one); the failed-restart path states exactly which
  side effects happened ("configuration stored but the worker could not be
  restarted") — success is never claimed for a half-applied update.

### SA-F-007 — modular settings overlay read the process workspace (FIXED)

- Root cause: `overlayFor()` accepted a `workspaceRoot` parameter but no
  production caller passed one — `openProject`/`persist` (and any caller
  using the exported `loadOverlay`) resolved the floor layer from
  `WORKSPACE_ROOT`, so any registered project whose root differed from the
  process inherited another workspace's settings as its floor.
- Fix: `projectWorkspaceRoot()` resolves the floor from the registry record's
  own `rootPath`; ids the registry does not know fall back to the process
  workspace (legacy default-project flow, documented and now test-pinned).
  HookLoader's already-correct explicit-root calls are unaffected.
- Regression: `test/persistence/project-stores.test.js` — the pre-existing
  overlay test was itself an encoding of the bug (it planted the floor in the
  process workspace and asserted `prj-a` read it); rewritten to plant A's
  floor in A's root, add a decoy in the process workspace, and assert the
  decoy is ignored. New test: A/B isolation, context-switch re-resolution,
  process-cwd never overrides a registered project, unknown id deterministic.
- AI-context validation: project identity now controls settings resolution;
  "no settings file for this project" and "the other project's settings" are
  distinguishable again (the latter is now impossible for registered projects).

### SE-DEBT-003 — `findByName` first-match (FIXED; the fix predates this cycle, the disposition was missing)

The finding's own RECOMMENDED FIX ("callers disambiguate") is verifiably
implemented: every consumer (TypeGraphBuilder.resolveSymbol,
CallGraphBuilder ×3 paths) tries `findByNameAndFile` first and labels the
global fallback `basis:'name-match'` with confidence 40 (< 70), so a guessed
match is never presented as a resolved one. The honesty is locked by
`GraphProvenance.test.ts` (duplicate-name fixture, cross-file edges asserted
name-match + confidence<70) plus ExplainSymbol/ImpactAnalysis name-match
cases. Kept as FIXED with that evidence rather than left `open` on inertia;
the doc-comment "first match wins" remains accurate for the labeled fallback.

### AI-06 — Kotlin/Swift grammar support (UNBLOCKED → IMPLEMENTED)

The "environment has no viable toolchain" claim was re-measured and
**falsified**: `tree-sitter-cli@0.24.7` (0.26 needs GLIBC 2.39, host is 2.35)
plus a locally installed `emsdk` builds the official
`tree-sitter-kotlin@0.3.8` / `tree-sitter-swift@0.7.1` grammars, and the
resulting wasm load and parse under the repo's own `web-tree-sitter@0.26.11`.
Per the cycle rules (do not keep an item blocked when the dependency is now
available), support was implemented:

- `tree-sitter-grammars/tree-sitter-{kotlin,swift}.wasm` committed; build
  provenance in `src/symbols/tree-sitter/README.md`.
- Node-kind tables derived by probing the built wasm (never guessed); a new
  `kindFromKeyword` table mechanism disambiguates class/interface/enum/struct/
  protocol — without it every Kotlin `interface` and Swift `struct` would be
  labeled `class`, which is exactly the misleading-output failure mode §2
  forbids.
- Support level declared `structural` (no call graph), announced through the
  existing honest surface `describeLanguageSupport`; the previous
  `swift: heuristic` test assertions were updated to the new truth.
- Verification: `kotlinSwift.ai06.test.ts` extracts real symbols (kinds,
  parents, no nameless symbols) from .kt/.swift sources; the golden snapshot
  moved 201→205 symbols — all four additions reviewed as genuine
  tree-sitter-extracted symbols replacing heuristic misses — then regenerated
  with the repo's own `npm run snapshot:update` and re-compared (`snapshot.js`
  reports "unchanged").

### SE-ARCH-001 / SE-ARCH-002 — explicit deferral with evidence (stay OPEN, dispositioned)

Source inspection found no correctness or AI-misleading defect in either unit
(both output-paths' honesty issues were fixed and locked separately:
SE-AI-19/20 for discovery, the blueprint contract tests for generation). Both
are deliberate architectural deferrals (D-16, D-17) with named triggers, kept
`open` in the ledger because "open by decision with rationale" is the honest
state; they are not silently closed and not rewritten under audit pressure.
SE-ARCH-002 is confirmed **independent** of SE-ARCH-001 (different file,
different failure surface); its `duplicate_of` marks theme, not disposition
(the SE-SEC-001 precedent in §5).

AI-13 is the product alias of SE-ARCH-001 — one finding, one ledger row, no
double count (ACTIVE-ISSUES states the mapping explicitly).

### SA-F-016 — remaining concurrency half DECIDED (stays PARTIAL)

Cross-process read-modify-write serialization analysed and decided NOT
required (D-18): synchronous load→mutate→save, no in-process cache, atomic
tmp+rename already guarantees no partial reads, and the concurrency model is
per-project ownership. Lost-update between concurrent writers of the SAME
registry is documented, not hidden. The atomic-save half (cycle-5) is
verified-fixed (`atomic-saves.test.js` green in this cycle's full chain) and
was not reopened.

## Independent post-remediation review (§22) — findings and fixes

The second pass (as a reviewer who did not write the fixes) found and closed
four real gaps before final validation:

1. **Silent identity drop in PATCH:** a body carrying `path`/`rootPath`/`id`
   was accepted (200) while those keys were ignored — an AI consumer could
   conclude a root move succeeded. Now refused with `400 not patchable`, and a
   regression proves the refusal is side-effect-free (project still its own
   root) (`GatewayServer.test.ts`).
2. **Half-created project on invalid POST:** the new config validation ran
   after `registry.register()`, so a rejected create still left the project
   registered. Registration now rolls back when the root did not exist before
   the call (regression: the rejected root must not appear in the list).
3. **New-worker form could flip schema defaults:** since the payload now
   carries the whole config, an empty "New worker" form would submit explicit
   `false` over blueprint/git/treeSitter/pretty defaults. The form initializes
   from `DEFAULT_FORM_VALUES`, which a test mechanically pins to
   `WORKER_CONFIG_JSON_SCHEMA` defaults in both directions — UI and schema can
   never silently drift (this is the §14 "can an AI infer something that is
   not actually known" guard).
4. **Blind save after a failed config load:** if the detail fetch fails while
   editing, saving would overwrite the real config with the (identity-only)
   visible fields. The form now blocks save with a persistent, explicit reason
   until the config can be loaded (and `updatePreview` no longer wipes that
   message on keystroke).

## Gates executed this cycle (final, post-review)

- semantic-engine: `tsc -p ./` 0 · `tsc -p tsconfig.test.json --noEmit` 0 ·
  eslint 0 · `npm run test:gate` exit 0 = **274 suites, 3438 pass / 0 fail /
  2 skipped** (2 skipped TESTS, environment probes: the optional `sqlite3`
  native driver fails to load on this host's glibc; the LSP orphan-reaper probe
  skips when the environment does not reap SIGKILL'd-parent children — both
  honest-declared, no suite-level skip, and the suite-skip budget stays 0).
  Includes the new AI-06 suite + the SE-F-057 request-contract and gateway e2e
  additions.
- structured-ai: full `npm test` chain exit 0 (incl. project-stores, the new
  SA-F-007 isolation test, and the atomic-saves SA-F-016 crash case).
- `python3 audit/tools/verify_ledger.py` exit 0 with the table above.
