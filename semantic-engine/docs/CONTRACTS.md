# Phase 0 Contract Inventory

**Status:** 🟡 PARTIALLY EXECUTED — see `phase0-executed-evidence-2026-09-21.md`.
Rows marked `TESTED` below have a test that runs under `npm test` and passed in the recorded
run at revision `6a67a7f`. Rows still marked `UNKNOWN` have no executed evidence.

## Source-of-truth rule

Existing `semantic-engine/` contracts remain authoritative until direct source/test inspection proves a mapping. New CodeIntel contracts are additive; conflicts require a recorded mapping in `DECISIONS.md`.

## Required contract inventory

| Contract | Required target | Current evidence | Status |
|---|---|---|---|
| Project identity/root/path confinement | Stable identity, canonical root, confined access | Package/README metadata only | UNKNOWN |
| Range/LineIndex | UTF-16 code units on decoded text, end-exclusive, `\n`/`\r\n`/`\r`, BOM-aware | `src/core/contracts/codeintel.ts` + `codeintel.test.ts` (92 tests, executed). Line base 0; `toProjectIndexLine()` is the documented bridge to the 1-based symbol lines. **Representability rule:** the `\n` of a `\r\n` has no `Position`; `offsetAt(positionAt(o)) === o` for every representable `o`, the collapse never moves past `o`, and `positionAt` is idempotent for every offset (`isRepresentableOffset()`). **SE-P0-COORD-01:** `file.lines` counts terminators while `LineIndex.lineCount` counts the empty line a trailing break opens — both intentional, mapping recorded here. | TESTED (contract) / mapping open |
| SymbolKey/signatureHash | Stable key with signature hash separate | `<relPath>::<qualifiedName>::<kind>[#ordinal]` in `codeintel.ts`, `parseSymbolKey` inverse; path must be relative POSIX and normalized (absolute, drive letters, `..`, `//`, trailing `/`, NUL, `::` inside a part are rejected). `signatureHash` stays a separate field. | TESTED (contract) |
| Handle/STALE_HANDLE | Hash-bound read handle and explicit stale error | `<relPath>:<start>-<end>#<hash8>` with `parseHandle()`; hash must be 8 lowercase hex characters; the error code is non-retryable. **UNKNOWN:** nothing in this revision issues or verifies a handle, so only the contract half is executed (matrix row 13). | TESTED (contract) / runtime UNKNOWN |
| Envelope | snapshotId, trust, stats, warnings, optional sessionId | No direct source/test execution | UNKNOWN |
| Error taxonomy/config | Validated config and stable error codes | Closed code set in `CODEINTEL_ERROR_CODES` (11 codes, unique, stable strings); retryability is a property of the code (`TIMEOUT`, `IO_ERROR`, `STALE_SNAPSHOT` only); `DEFAULT_CODEINTEL_CONFIG` is frozen and safe (`enabled: false`, `readOnly: true`, 10 000 files, 2 000 000 bytes, 30 000 ms). | TESTED (contract) |
| Generation/freshness/publication | Atomic snapshot publication and ownership | Per-file atomicity is tested (temp + fsync + rename, orphan sweep, concurrent writers, reader never sees a torn index). **SE-P0-PUB-01 (open):** the index/manifest *pair* is not atomic — an interruption between the two leaves a new index beside an old manifest. | PARTIAL |
| FileProvider/TokenCounter | Explicit ports for file reads and token accounting | `ports.ts` + reference implementation `fileProvider.ts` (`ConfinedFileProvider`): lexical **and** canonical-root confinement, escaping symlinks denied (omitted from listings), secret denylist, `.git` segment denied, `maxFiles`/`maxFileBytes` caps, deadline → `TIMEOUT`, `AbortSignal` → `CANCELLED`, binary sniff. `TokenCounter` is replaceable; `WhitespaceTokenCounter` is the reference. **Open:** not yet wired into the MCP/HTTP read paths; `SourceSecurityGuard` (shipped) has no secret denylist. | TESTED (port) / wiring open |
| Determinism | Stable ordering independent of time/random/process order | Full-index runs over the same files produce the same canonical projection; file and symbol order do not depend on write order; scanner output equals sequential output. Ordering in the new contracts is by UTF-16 code unit, not `localeCompare` (collation is ICU-dependent). | TESTED |
| MCP content/structuredContent | Text/structured parity and project/generation scope | `mcpIndexGeneration.test.ts` (content unchanged, `structuredContent` extended, consumer cache invalidated) plus the new read-only/lifecycle suite: tools/list equals the registry, tool calls change nothing on disk (workspace **and** artifact digests), restart re-reads the generation from the manifest. | TESTED |
| Gateway/worker lifecycle | Cancellation/dispose and no post-shutdown work | Existing executed suites: worker supervisor (one worker per project, crash restart, crash limit → degraded, stops all and leaves no lock), worker CLI (Unix socket, ready only after an index, SIGTERM), project lock (dead owner, quiet heartbeat, half-written lock), protocol matrix (client disconnect, client timeout). | TESTED (existing) |

## Required follow-up

Directly inspect each boundary and link it to source symbols, tests, fixture IDs, command output, and exit code before changing any contract. Static file presence is not acceptance evidence.

Still open after this stage:

1. **SE-P0-PUB-01** — make the index/manifest pair coherent across an interruption
   (write the manifest first with a pending marker, or publish into a new directory and swap).
2. **SE-P0-COORD-01** — decide and document whether `file.lines` and `LineIndex.lineCount`
   stay different numbers, and where a consumer converts between them.
3. Wire `ConfinedFileProvider` (or a single shared confinement helper) into the MCP/HTTP read
   paths, and unify it with `SourceSecurityGuard` (see D-0007).
4. A handle issuer and a snapshot store, so `STALE_HANDLE`/`STALE_SNAPSHOT` become testable
   runtime behaviour instead of a contract.
5. The compatibility matrix (step 0.8), traceability matrix (step 0.9) and adopt-vs-build
   decision (step 0.10).
