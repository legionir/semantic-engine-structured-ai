# Phase 0 Contract Inventory

**Status:** 🟡 INVENTORY ONLY — no contract is marked implemented or verified from static presence.

## Source-of-truth rule

Existing `semantic-engine/` contracts remain authoritative until direct source/test inspection proves a mapping. New CodeIntel contracts are additive; conflicts require a recorded mapping in `DECISIONS.md`.

## Required contract inventory

| Contract | Required target | Current evidence | Status |
|---|---|---|---|
| Project identity/root/path confinement | Stable identity, canonical root, confined access | Package/README metadata only | UNKNOWN |
| Range/LineIndex | UTF-16 code units on decoded text, end-exclusive, `\n`/`\r\n`/`\r`, BOM-aware | No direct source/test execution | UNKNOWN |
| SymbolKey/signatureHash | Stable key with signature hash separate | No direct source/test execution | UNKNOWN |
| Handle/STALE_HANDLE | Hash-bound read handle and explicit stale error | No direct source/test execution | UNKNOWN |
| Envelope | snapshotId, trust, stats, warnings, optional sessionId | No direct source/test execution | UNKNOWN |
| Error taxonomy/config | Validated config and stable error codes | `contracts/config.schema.json` exists in tree; semantics unverified | PARTIAL / UNKNOWN |
| Generation/freshness/publication | Atomic snapshot publication and ownership | No runtime evidence | UNKNOWN |
| FileProvider/TokenCounter | Explicit ports for file reads and token accounting | No direct source/test execution | UNKNOWN |
| Determinism | Stable ordering independent of time/random/process order | No executed evidence | UNKNOWN |
| MCP content/structuredContent | Text/structured parity and project/generation scope | MCP source/tests exist in tree; no MCP execution | PARTIAL / UNKNOWN |
| Gateway/worker lifecycle | Cancellation/dispose and no post-shutdown work | Source paths exist in tree; no lifecycle execution | PARTIAL / UNKNOWN |

## Required follow-up

Directly inspect each boundary and link it to source symbols, tests, fixture IDs, command output, and exit code before changing any contract. Static file presence is not acceptance evidence.
