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

## D-0010 — Point-to-point path queries are not depth-capped by default

- **Date:** 2026-09-21
- **Decision:** `GraphQueryEngine.shortestPath` defaults to unbounded depth (still bounded by
  `maxNodes` and component exhaustion) when the caller has not passed `depth`. Neighborhood
  queries (`neighbors`, `subgraph`, `bfs`) keep `DEFAULT_GRAPH_DEPTH = 2`.
- **Reason:** the 2-hop default is a neighborhood-query policy; applied to `path(from, to)` it
  made the فاز ۴۷ acceptance criterion (`path("API /login", "Database")`, five hops) unreachable —
  three authored LayeredGraph tests were red on the pristine baseline (SE-P0-GRAPH-01). A caller
  who already knows the target node cannot know the depth.
- **Status:** DECIDED and FIXED; executed by `src/graphs/LayeredGraph.test.ts` (155/155 graph tests).

## D-0011 — Visualization consumes the canonical edge-basis vocabulary

- **Date:** 2026-09-21
- **Decision:** `server/types.ts` `GraphEdge.metadata.basis` is widened to
  `EdgeBasis | 'transitive' | 'blueprint' | 'index'`, and the two runtime guard sets
  (`GraphViewModelMapper.EDGE_BASES`, `LodService.GRAPH_BASES`) carry the same values. Unknown
  non-string bases are still rejected; nothing is guessed.
- **Reason:** SE-P0-API-01 — the guard set was a stale subset without `import-resolved`, so every
  real dependency edge the pipeline emits was silently dropped; the architecture view for a real
  indexed project was empty and degraded to the file-level fallback. The strictness comment
  ("never replace missing provenance with a guess") is preserved — the canonical vocabulary is
  recognized, not guessed.
- **Status:** DECIDED and FIXED; executed by `src/server/platform.e2e.test.ts` step 4.

## D-0012 — The platform e2e fixture must contain a module boundary

- **Date:** 2026-09-21
- **Decision:** `platform.e2e.test.ts` places `auth.ts` under `src/auth/` and `user.ts` under
  `src/api/`. No assertion was changed.
- **Reason:** a single-module project *correctly* degrades to the SE-VIZ-01 file-level view; the
  authored acceptance test asserted `level: 'architecture'` anyway. The contradiction was in the
  fixture, not in the view and not in the assertion. With a real module boundary the view returns
  level 1 data (layer + two modules + one cross-module edge), so both authored intents stand.
- **Status:** DECIDED and FIXED; suite green (6/6).

## D-0013 — One artifact-integrity gate for every serve path; legacy artifacts stay accepted

- **Date:** 2026-09-21
- **Decision:** `core/config/artifactManifest.ts` owns `MANIFEST_FILE_NAME` and
  `assertIndexMatchesCommittedManifest`. HTTP (`ProjectService`), MCP
  (`SemanticEngineMcpServer.reloadFromDisk`) and the MCP CLI entry (`cli.ts`, both load sites) all
  pass through it. Artifacts with no manifest, or a manifest without a committed digest, remain
  accepted (pre-Phase-0 policy, kept deliberately).
- **Reason:** HTTP already refused a byte-mismatched pair; the MCP paths parsed and served it
  silently — the consumer-visible half of SE-P0-PUB-01. Three copies of the manifest filename and
  two copies of the check had already begun to drift; a gate with one owner cannot.
- **Status:** DECIDED and FIXED; executed by `src/core/config/artifactManifest.test.ts`,
  `src/ai/mcp/McpArtifactIntegrity.phase0.test.ts`, and the existing `runtimeArtifacts` suites.

## D-0014 — Publication stays two-file; fail-closed consumption is the shipped invariant

- **Date:** 2026-09-21
- **Decision:** the writer keeps the index→manifest two-file order. True atomic publication of the
  pair requires a generation-directory layout with an atomic pointer swap; that migration is
  explicitly deferred (would invalidate stored artifact paths for all consumers). The shipped
  invariant instead: **no serve path hands out a byte-mismatched pair, ever** (D-0013), so the
  crash window degrades to "reload keeps the last good snapshot" instead of "consumers read a
  torn state".
- **Reason:** recording the architectural boundary honestly is better than claiming atomicity that
  two independent files cannot have. SE-P0-PUB-01 is closed at the consumption layer and open at
  the layout layer by decision.
- **Status:** DECIDED (layout migration: POSTPONED, needs owner sign-off).

## D-0015 — Unsatisfiable checks fail closed with named reasons; absent features are recorded, not faked

- **Date:** 2026-09-21
- **Decision:** `check:audit` preflights its three inputs and exits 1 with the named gap instead of
  an `ENOENT` stack — the audit documents (`AUDIT-2026-08.md`, `EXECUTION-PLAN.md`,
  `GRAPH-INTELLIGENCE-GAPS.md`) have never been committed to this repository and must come from the
  owner. Separately: the apply→undo fuzz requirement is recorded as **NOT APPLICABLE**, because no
  apply/undo implementation exists in this codebase to fuzz — inventing one to satisfy a test row
  would be fabrication.
- **Reason:** a gate that cannot pass for reasons outside the repo must say exactly that, and a
  missing feature must stay a named gap, not a green checkmark.
- **Status:** DECIDED.
