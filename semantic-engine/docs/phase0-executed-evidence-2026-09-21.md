# Phase 0 — Executed Evidence (2026-09-21)

**Repository:** `legionir/semantic-engine-structured-ai`
**Branch:** `docs/audit-file-status` @ `6a67a7f80668bc68ea391d65d3fd4b7af84e46ad`
**Package under test:** `semantic-engine/`
**Supersedes:** the command-evidence section of `phase0-baseline-2026-09-21.md`, which was
written without an executable checkout. That file's limitation — "commands were **not**
executed" — no longer holds.

## 1. Environment (observed)

| Item | Value |
|---|---|
| Node | `v22.22.3` (package declares `>=20`) |
| npm | `10.9.8` |
| Lockfile | `semantic-engine/package-lock.json` (npm) |
| `npm ci` | succeeded in this checkout |
| Registry reachability | `npm ping` → `PONG 230ms` |
| OS | Linux x86_64 container (not the repository CI image) |

## 2. Commands of record (exact, with results)

| # | Command | Result |
|---|---|---|
| 1 | `npm run build` (`tsc -p ./`) | **exit 0**; `dist/` produced |
| 2 | `npm run lint` (`eslint src`) | **exit 0**; 4 warnings, 0 errors (`src/ai/tools/QueryIndexTool.ts:165`, `src/cli/commands/watch-command.ts:18,20,21` — unused bindings) |
| 3 | `npm test -- --silent` **before** `npm run build` | `Test Suites: 5 failed, 9 skipped, 199 passed, 204 of 213 total` · `Tests: 6 failed, 87 skipped, 2736 passed, 2829 total` |
| 4 | `npm test -- --silent` **after** `npm run build` (baseline of record) | `Test Suites: 5 failed, 208 passed, 213 total` · `Tests: 6 failed, 2823 passed, 2829 total` · 214 s |
| 5 | `npm test -- --silent` after this stage's changes (with `dist/` present) | `Test Suites: 2 failed, 216 passed, 218 total` · `Tests: 4 failed, 3014 passed, 3018 total` |
| 6 | `npm run test:gate` (fixture + `check-tests.js` + `check-artifact-location.js`) after this stage's changes | `Test Suites: 2 failed, 216 passed, 218 total` · `Tests: 4 failed, 3014 passed, 3018 total` · **exit 1** — every suite *ran* (216 + 2 = 218), and the four failures are the two pre-existing red suites listed in §4. The repo's own gate is red because those two suites are red; it is not red because of anything added here. |
| 7 | `npm run check:audit` | **fails**: `ENOENT … semantic-engine/AUDIT-2026-08.md` — the script also reads `EXECUTION-PLAN.md` and `GRAPH-INTELLIGENCE-GAPS.md`, none of which exist in this snapshot |

Why run 3 and run 4 differ: `describeIfBuilt` guards three suites on the presence of `dist/`
(`gateway/multiProject.e2e.test.ts:33`, `lsp/LspClient.test.ts:495`,
`host/barrelLoad.test.ts:54`). Without a build those 87 tests are *skipped*, so **`npm run
build` is a prerequisite for `npm test`** — a skipped suite is not a passing one.

**Evidence-integrity note:** jest's exit status was masked in several exploratory runs by
piping output to `tail` (the pipeline's status is `tail`'s). All numbers above come from
jest's own summary lines, not from a pipeline's exit code.

## 3. Defects found by the new tests, and fixed

| ID | Where | Defect | Fix |
|---|---|---|---|
| **SE-P0-PARITY-01** | `src/incremental/IncrementalEngine.ts`, `ProjectIndexStore.ts` | A rename whose content was unchanged ran `removeFile` + `upsertFile`. `removeFile` also drops `symbolsByFileId` (the SE-INC-11 fix), so the renamed file lost every symbol: incremental index 5 symbols where a full rebuild had 6. | New `ProjectIndexStore.renameFile(fileId, newPath)`: path keys move, symbols stay. `handleRename` uses it. |
| **SE-P0-PARITY-02** | `src/incremental/IncrementalEngine.ts` | The rename paths never reported removed symbol ids and never reprocessed the *old path's* dependents, so a rename with changed content left stale resolved imports, stale dependency edges and stale call edges pointing at the removed file (`b.ts` kept `resolvedFileId` of a file that no longer existed). | `handleRename` now returns `removedSymbolIds`, collects old dependents before removal (and new dependents after reprocessing), and the caller adds the ids to the graph-cleanup set. The "rename to a missing target" branch gets the same delete-grade bookkeeping. |
| **SE-P0-SYM-01** | `src/services/source/SourceSecurityGuard.ts` | `validateSymlink` called `fs.existsSync` (which follows links, so a cycle reported "does not exist") and then `fs.realpathSync` (which resolves the whole chain at once). Measured: a two-link cycle and a five-deep chain both returned `ok: true`; `maxSymlinkDepth` was unreachable. | The chain is now walked with `lstat` + `readlink` one hop at a time, keys are compared for cycles, and the hop count enforces `maxSymlinkDepth`. |
| **SE-P0-CLI-01** | `src/cli/cli.test.ts` | The test named "`--artifact-location in-root` همان خروجی قدیمی را میدهد" never passed the flag; since فاز ۴ the default is `external`, so it asserted the legacy layout while exercising the new default and had been red under `npm test`. | The flag is passed, as the test's own name and the phase-4 decision require. |

## 4. Gaps recorded, not fixed

| ID | Gap | Evidence |
|---|---|---|
| **SE-P0-PUB-01** | `OutputWriter.write()` writes the index first and the manifest second. An interruption between the two leaves a **new index beside an old manifest**, so `manifest.artifacts.index.sha256` does not describe the file next to it. Per-file atomicity is solid; *set* atomicity is not. | `src/pipeline/Publication.phase0.test.ts` — "measured behaviour: the index moves on and the manifest still describes the previous one", plus the repair test. |
| **SE-P0-COORD-01** | `file.lines` counts line terminators (`wc -l`: a file ending in `\n` with 3 breaks reports 3) while `LineIndex.lineCount` counts the empty line a trailing break opens (4). Both are defensible; the mapping between them is not stated anywhere a consumer can find it. | `IncrementalParity.phase0.test.ts` asserts both numbers side by side; recorded here and in `CONTRACTS.md`. |
| **SE-P0-GRAPH-01** | `LayeredGraph` cross-layer path finding returns `path: null` in three acceptance tests, including the API → Database route its own phase-47 criterion requires. | `npx jest src/graphs/LayeredGraph.test.ts` → 3 failed. **Pre-existing**: identical in the pristine tree (run 4) before any change in this stage. |
| **SE-P0-API-01** | `GET /api/v1/projects/:id/visualization/architecture` answers `level: "file"` where the platform e2e expects `"architecture"`. | `npx jest src/server/platform.e2e.test.ts` → 1 failed. **Pre-existing**, unchanged by this stage. |

### The two contract suites named in the task, verified

```
npx jest src/core/contracts
→ Test Suites: 3 passed, 3 total · Tests: 155 passed, 155 total
```

## 5. Files added or changed in this stage

Added (tests): `src/core/contracts/fileProvider.test.ts`,
`src/security/ReadBoundary.phase0.test.ts`, `src/pipeline/IncrementalParity.phase0.test.ts`,
`src/pipeline/Publication.phase0.test.ts`, `src/ai/mcp/McpReadOnlyLifecycle.phase0.test.ts`.

Added (implementation / contract): `src/core/contracts/fileProvider.ts`
(`ConfinedFileProvider`, reference implementation of the `FileProvider` port).

Changed: `src/core/contracts/codeintel.ts` and `ports.ts` (contract rules documented and
tightened), `src/core/contracts/codeintel.test.ts` and `ports.test.ts` (rebuilt),
`src/services/source/SourceSecurityGuard.ts` (SE-P0-SYM-01),
`src/incremental/IncrementalEngine.ts` + `ProjectIndexStore.ts` (SE-P0-PARITY-01/02),
`src/cli/cli.test.ts` (SE-P0-CLI-01).

Docs: this file, `phase0-test-coverage-matrix.md`, and updates to `CONTRACTS.md`,
`DECISIONS.md`, `GATES.md`.

**Not in the audit snapshot:** `AUDIT_FILE_STATUS.md` is a snapshot of the *previous*
revision's 881 files. The files above are new; they are deliberately not appended to a
snapshot table, and `npm run check:audit` cannot run here anyway (§2 row 6).

## 6. Bug found and fixed in the two contract suites the task named

Both suites named in the task were **red** in the pristine tree:

- `src/core/contracts/codeintel.test.ts` — `CRLF round-trips every decoded UTF-16 offset`
  failed (`Expected: 6, Received: 5`). The expectation is *unsatisfiable* as written: with
  `offsetAt` clamping to the end of the line's content, the `\n` of a `\r\n` has no
  `Position` at all, so no implementation can round-trip it. The policy is now explicit in
  `codeintel.ts` (representable offsets round-trip; the interior of a multi-unit break
  collapses to the line end and never moves past the requested offset; `positionAt` is
  idempotent for *every* offset; `isRepresentableOffset()` answers the question directly),
  and the suite asserts each clause.
- `src/core/contracts/ports.test.ts` — did not compile (`TS2554: Expected 0 arguments, but
  got 1`): the mock's `exists` was inferred as zero-argument. The suite is rebuilt against a
  typed port, a runtime check that no mutating member exists, and the real
  `ConfinedFileProvider`.

After the rewrite: `npx jest src/core/contracts` → **3 suites passed, 155 tests passed**.

## 7. Gate verdict (unchanged in kind, changed in evidence)

`GATES.md` requires `LOCALLY VERIFIED` / `MCP VERIFIED` / `GATEWAY VERIFIED` evidence. This
stage produces that class of evidence for: determinism, full/incremental parity, read
security, size/count limits, deadline/cancellation, MCP read-only behaviour, and restart.

**Phase 0 stays 🔴 BLOCKED**, for reasons that are now measured rather than assumed:

1. SE-P0-PUB-01 — publication of the artifact *set* is not atomic;
2. SE-P0-GRAPH-01 and SE-P0-API-01 — four pre-existing red tests remain;
3. the compatibility matrix (step 0.8), the traceability matrix (step 0.9) and adopt-vs-build
   (step 0.10) are not written;
4. ten of the 24 required items are still 🟡 with named missing halves (matrix rows 3, 4, 5, 7,
   10, 17, 18, 19, 23, 24), one is blocked by design (row 20 — no apply/undo implementation),
   and one is blocked until a handle issuer exists (row 13 — runtime staleness);
5. the repository's own gate, `npm run test:gate`, exits 1 because of the four pre-existing
   red tests in §4 — it cannot be green while those two suites are;
6. `npm run check:audit` cannot run in this snapshot at all.

A 🟡 or ⛔ is not a failure of the code; it is the honest state of the evidence.
