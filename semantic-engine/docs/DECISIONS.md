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

## D-0004 — Threshold immutability

- **Date:** 2026-09-21
- **Decision:** Appendix B starting thresholds are recorded in `GATES.md` and must not be changed after measurement without a dated, owned decision.
- **Status:** ACTIVE.
