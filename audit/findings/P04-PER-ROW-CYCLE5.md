# Cycle 5 — Per-row verification of the remaining open ledger (2026-10-08)

§4.1 discipline carried forward from cycle 4: no prior label is proof. This
pass took the **52 rows that cycle 4 left `open — not verified fixed`** and
read the CURRENT checkout for every one of them (or ran the live test), then
either back-propagated a fix, invalidated the finding with evidence, or kept
it honestly open.

## Baseline (live, this session)

- fresh `npm install` (both projects; no `node_modules` in the checkout).
- semantic-engine: `npm run build` then `jest --ci` → **273 suites / 3415
  passed / 0 failed / 2 skipped**, exit 0 (the 2 skips are the pre-existing
  environment probes: `sqlite3` glibc gate + orphan-reaper gate).
  `test:gate` exits 0 with skip-budget 0 honored; artifact-location gate ok.
- structured-ai: `npm test` full chain → **exit 0**.
- The `+1 suite / +15 tests` delta over cycle 4 is this cycle's new
  regressions (barrel surface, symbol ordering, archive dead-segment,
  registry atomic save).

## Fixes shipped this cycle (each with a named regression)

| Row | Defect | Class | Lock |
|-----|--------|-------|------|
| SA-F-003 | `compactSegments` rewrote a fully-dead archive segment to a permanent one-newline empty file whenever any unrelated rollup kept the global `keep` set non-empty — a stale-file leak + wrong compaction statistics | DATA_QUALITY / RELIABILITY | `archive.test.js` (fails deterministically without the fix) |
| SA-F-016 (contained half) | `ProjectStore.save` hand-rolled the atomic write with a **pid-only** temp suffix; two saves sharing a pid (container pid-namespace, retry overlap) could publish each other's bytes, and a crash before rename left a `.tmp-<pid>` forever | RELIABILITY / INTEGRITY | `atomic-saves.test.js` registry case (fails without the fix) |
| SE-F-016 / SE-F-019 | `core/utils` barrel omitted `decodeBuffer`, `normalizeLineEndings`, `LineIndex`, `getLineNumber`, `sortSymbolsDeterministically` — the declared public surface was incomplete | API_CONTRACT | `barrelSurface.test.ts` (13 cases) |
| SE-F-022 | `KIND_ORDER` left `trait` and `decorator` in the catch-all 999 bucket: output stayed deterministic but violated the canonical ordering | AI_CONTEXT (consistency) | `symbolSort.test.ts` (canonical-bucket + unknown-kind determinism) |
| (back-propagation) | `test/golden/blueprint.golden.json` still recorded `authRequired:false` after the AI-09 three-state fix — a stale golden that would mask a regression of the honesty fix | DATA_QUALITY (docs↔impl) | `snapshot.js --update`, diff reviewed: exactly 10× false→null, then `snapshot.js` reports unchanged |

The two SA fixes are the class §15/§30 cares about: silent data leaks and
integrity hazards invisible to a green suite. Both regressions were confirmed
to **fail without the fix** and **pass with it**.

## Rows dispositioned INVALID (not defects) with evidence

Several rows described a real-looking symptom whose premise does not hold
against the current design/contract, or whose recommendation duplicates an
already-correct implementation. Recorded with the specific evidence so they
are never re-litigated blind:

- **Security-class (SE-SE-005/006/009/010/011/012, SE-PIPE-003):** absolute-
  path XDG handling, an anchored lowercase `PATH_SAFE_PROJECT_ID_PATTERN`, no
  regex/SQL/shell sink for `queryTerms`, a cache-coherency counter (predictable
  *by contract*), own-artifact migration on the same FS, and `mkdtempSync`
  (O_EXCL, unpredictable, 0700) — none is a defect.
- **Contract/design (SE-F-025/026, XX-F-002, SE-F-010/012/013/014/015/017/
  018/020/021):** raw-extraction D-11 contract, documented heuristics, the
  boundary `makeConfidence` guard, ajv runtime validation coexisting with
  compile-time mirrors, the 8 KiB binary prefix, the intentional `??`/clamp
  semantics — each already a deliberate, tested design.
- **Stale premise (SE-DEBT-001/002, SE-PERF-001):** the `auto` brute-force
  fallback is documented/measured and an explicit `usearch` request throws
  rather than degrading silently; `updateIncremental` already keys staleness
  off contentHash; `loadBlueprint` is a one-time startup read with honest
  degradation.

## Rows verified FIXED in current code (no product change needed this cycle)

The prior cycles (and decisions D-10/D-11/D-14/D-15, AI-09, P-06) had already
landed these; the ledger simply was not back-propagated (AI-04's honest gap):

SE-VIZ-001/002/003/006/007, SE-API-003, SE-F-003/016/019/022/023/024,
SE-SE-001/008, SE-REL-001, SA-ARCH-002, SA-PRJ-001/002, SA-F-015, XX-F-001,
SE-PIPE-002 (superseded — closed at the atomic writer). Each row in the ledger
now carries the code/test pointer that proves it.

## Still OPEN after cycle 5 (5 rows — honest state, none silently closed)

These are genuine but deliberately not patched with a guess (§12, §7):

- **SE-ARCH-001** — `ContextDiscoverer.discover()` 200-line monolith. HIGH-
  classified maintainability; produces correct, non-misleading output. Splitting
  is a refactor with cross-discovery/ranking regression risk, taken only when a
  functional change needs the seams. (Tracked as AI-13, §12.)
- **SE-ARCH-002** — `BlueprintGenerator` god-class (10 responsibilities). Same
  category: correct output, refactor-risk; no AI misled. Design note, not a defect.
- **SE-DEBT-003** — `SymbolIndex.findByName` returns the first name match. Real
  limitation, **documented** in the method's own JSDoc; callers that need
  file-scoping use `findByNameAndFile`. Changing global name→symbol resolution
  needs a disambiguation contract, not a one-line fix.
- **SA-F-007** — modular project overlay reads the process workspace's project
  file as the floor for every project. A partial fix was attempted and REVERTED
  in cycle 4: the behavior is asserted by a documented bit-for-bit contract +
  a passing persistence test; relocating the floor is a contract change. (P-17.)
- **SE-F-057** — Gateway dashboard Edit posts 4 of 35 worker-config fields;
  making Edit work needs per-project WorkerConfig persistence + a PATCH
  contract (a feature, not a defect patch). Create-only semantics are honest
  today (SE-F-040 locks that). (P-18.)

Plus the environment BLOCKED item (AI-06, Kotlin/Swift wasm toolchain) and the
SA-F-016 open half (cross-process registry lock) — recorded, not hidden.

## Final ledger counters (cycle 5)

**96 fixed · 33 invalid · 7 superseded · 17 duplicate · 1 partial (SA-F-016)
· 5 open** = 161 rows. The open 5 are all maintainability/design/feature-
boundary items with explicit rationale; **no HIGH-class correctness or
AI-misleading defect remains open and unexamined.**
