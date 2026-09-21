# Phase 0 Decisions

**Status:** 🟡 PARTIAL / BLOCKED — evidence baseline started; repository checkout and executable dependency environment are not available to this agent.

## D-0001 — Existing repository is the source of truth

- **Date:** 2026-09-21
- **Decision:** Extend the existing `semantic-engine/` package and its `ProjectIndex`, registry, scanner/parser/extractor, incremental pipeline, output/reader, `AiToolRegistry`, MCP and Gateway/worker lifecycle additively. Do not create a second CodeIntel source of truth.
- **Evidence:** canonical plan committed at revision `d1289aec99987065657c6ad824c900c7a7b36dc5`.
- **Status:** DECIDED; implementation/runtime conformance not yet verified.

## D-0002 — Phase 0 execution boundary

- **Date:** 2026-09-21
- **Decision:** Only Phase 0 baseline/hardening work may proceed until its gate is evaluated. Phase 1–4 implementation is blocked.
- **Reason:** The plan requires executable evidence for build, tests, full/incremental parity, artifact freshness, compatibility, security, MCP and Gateway lifecycle.
- **Status:** ACTIVE.

## D-0003 — Runtime evidence blocker

- **Date:** 2026-09-21
- **Decision:** Static repository metadata may establish TARGET/UNKNOWN inventory only. It cannot establish TESTED, LOCALLY VERIFIED, MCP/GATEWAY VERIFIED, or gate acceptance.
- **Blocker:** No executable checkout with repository source and installed dependencies is available in the current environment; only selected files were readable through the repository connection.
- **Required resolution:** Provide/attach an allowed local checkout and dependency installation environment, or an approved reproducible CI execution path.
- **Status:** OPEN / BLOCKING.

## D-0005 — CRLF representability in the additive range contract

- **Date:** 2026-09-21
- **Decision:** the additive CodeIntel contract keeps `Position` 0-based and LSP-shaped
  (`line`, UTF-16 `character`, end-exclusive ranges). Because `offsetAt` clamps to the end of
  a line's *content*, the `\n` of a `\r\n` has no `Position`. The contract therefore states:
  round-trip for every representable offset; the interior of a multi-unit break collapses to
  the line end and never moves past the requested offset; `positionAt` is idempotent for every
  offset; `isRepresentableOffset()` answers the question directly. `toProjectIndexLine()`
  (+1) is the only bridge to the 1-based `line`/`endLine` of `ProjectIndex`.
- **Reason:** the previous `codeintel.test.ts` demanded a round-trip for *every* UTF-16
  offset, which no implementation can satisfy while `offsetAt` clamps; the suite was red at
  `6a67a7f` (`Expected: 6, Received: 5`). Relaxing it silently would have hidden a real
  contract question, so the rule is written down where consumers read it.
- **Status:** DECIDED; executed by `src/core/contracts/codeintel.test.ts`.

## D-0006 — Identifier paths must be relative, POSIX and normalized

- **Date:** 2026-09-21
- **Decision:** `makeSymbolKey`/`makeHandle` (and their parsers) reject absolute paths, drive
  letters, backslashes, `..`, empty/`.` segments, trailing slashes, NUL, and `::` inside a
  part. Keys and handles are identifiers that other processes store and compare; an
  identifier that can be written two ways is not stable.
- **Status:** DECIDED; executed by `codeintel.test.ts`.

## D-0007 — The read port gets its own confinement implementation

- **Date:** 2026-09-21
- **Decision:** `core/contracts/fileProvider.ts` implements the `FileProvider` port with its
  own lexical + canonical-root confinement instead of importing
  `services/source/SourceSecurityGuard`.
- **Reason:** `core/contracts` must not depend on `services`, and the guard carries policy a
  *read* boundary should not inherit (it blocks `.bin`/`.so`/… extensions, which are
  legitimately readable, just not source). The duplication is real and recorded here rather
  than hidden; unifying both under one confinement helper is a Phase 1 decision.
- **Status:** DECIDED; both copies are executed by tests
  (`ReadBoundary.phase0.test.ts`, `fileProvider.test.ts`).

## D-0008 — Incremental updates must match a full rebuild for rename

- **Date:** 2026-09-21
- **Decision:** a rename keeps the file id *and* its symbols when the content hash is
  unchanged (`ProjectIndexStore.renameFile`), and a rename that changes content does
  delete-grade bookkeeping: removed symbol ids reach the graph cleanup, and the old path's
  dependents are reprocessed.
- **Reason:** measured parity gaps (SE-P0-PARITY-01/02): 5 symbols where a rebuild had 6, and
  stale resolved imports/edges pointing at a file that no longer existed. The Phase 0
  acceptance criterion is «full و incremental معادل»; these were blocking gaps.
- **Status:** DECIDED and FIXED; executed by `src/pipeline/IncrementalParity.phase0.test.ts`.

## D-0009 — A cyclic symlink is a rejection, not a pass

- **Date:** 2026-09-21
- **Decision:** `SourceSecurityGuard.validateSymlink` walks the chain with `lstat` +
  `readlink`, rejects a repeated hop as a cycle, and enforces `maxSymlinkDepth`.
- **Reason:** SE-P0-SYM-01 — the previous implementation used `existsSync` (follows links, so
  a cycle looked absent) and `realpathSync` (resolves the whole chain at once), so both checks
  were unreachable: a two-link cycle and a five-deep chain both returned `ok: true`. A
  security check that cannot fail is worse than none, because the caller believes it ran.
- **Status:** DECIDED and FIXED; executed by `src/security/ReadBoundary.phase0.test.ts`.

## D-0004 — Threshold immutability

- **Date:** 2026-09-21
- **Decision:** Appendix B starting thresholds are recorded in `GATES.md` and must not be changed after measurement without a dated, owned decision.
- **Status:** ACTIVE.
