# Semantic-engine audit batch (20 files)

## Scope and method
۲۰ فایل نخستِ دارای وضعیت «درانتظار» در `AUDIT_FILE_STATUS.md` انتخاب شدند. فایل‌ها کامل خوانده شدند (شامل JSON/HTML/CSS و تست‌ها)؛ امنیت عمداً خارج از scope است. مسیرهای اجرا و وابستگی‌ها از import/require و اسکریپت‌های package استخراج شد. مواردی که از متن فایل به‌تنهایی اثبات نمی‌شوند با `POTENTIAL` علامت خورده‌اند.

## Reviewed files
1. `semantic-engine/bin/semantic-engine.js`
2. `semantic-engine/contracts/blueprint.schema.json`
3. `semantic-engine/docs/panel-archive.html`
4. `semantic-engine/eslint.config.mjs`
5. `semantic-engine/public/gateway.css`
6. `semantic-engine/public/open.css`
7. `semantic-engine/public/open.html`
8. `semantic-engine/scripts/benchmark.js`
9. `semantic-engine/scripts/check-artifact-location.js`
10. `semantic-engine/scripts/check-audit-coverage.js`
11. `semantic-engine/scripts/gen-fixture.js`
12. `semantic-engine/scripts/run-pipeline.js`
13. `semantic-engine/scripts/snapshot.js`
14. `semantic-engine/scripts/validate-project-index.js`
15. `semantic-engine/scripts/validate-schema.js`
16. `semantic-engine/src/ai/AiMetadataGenerator.test.ts`
17. `semantic-engine/src/ai/AiMetadataGenerator.ts`
18. `semantic-engine/src/ai/AiToolCommandHandler.phase45.test.ts`
19. `semantic-engine/src/ai/AiToolRegistry.phase45.test.ts`
20. `semantic-engine/src/ai/AiToolRegistry.test.ts`

## Per-file analysis

### 1. bin/semantic-engine.js
Role: dependency-free CLI launcher. Input is `process.argv.slice(2)`; output is delegated exit code/stderr. It resolves `dist/cli/main.js`, requires it, invokes `.main(args)`, and maps rejected errors to exit code 1. Runtime path is lines 16–35. Dependency: Node `path`, `fs`, compiled `dist/cli/main.js`; no test found in this batch (POTENTIAL). Multi-project scope: one invocation has no project argument handling here; project selection is delegated to compiled main (POTENTIAL). Limitation: requires a prior build; missing build is a controlled error (lines 18–24).

### 2. contracts/blueprint.schema.json
Role: Draft 2020-12 contract for generated Blueprint. Required root fields and `additionalProperties:false` are explicit (lines 6–20). Inputs are JSON Blueprint objects; output is validation acceptance/rejection. It references project-index IDs rather than independently generated IDs (lines 5, 187, 203–204, 452). It models meta, architecture, modules, dependency graph, entities, APIs, workflows, symbol index and constraints (lines 21–497), with recursive folder nodes and graph/symbol definitions (499–640). Dependencies are JSON Schema `$ref`s and external project-index conventions; no executable path. Multi-project is represented only by `meta.projectName` and source index metadata; no cross-project container/scope constraint is defined (POTENTIAL). Limitation: descriptions require referential equality to project-index, but JSON Schema does not enforce those cross-document references (POTENTIAL).

### 3. docs/panel-archive.html
Role: static archived panel/documentation page (HTML). Inputs are browser navigation/static assets; output is rendered archive UI. CSS/JS dependency and executable paths are browser-relative (full file reviewed). No server-side or project-selection execution was found (POTENTIAL). Multi-project behavior is not established by this static artifact (POTENTIAL). No finding established from the file alone.

### 4. eslint.config.mjs
Role: flat ESLint config. It ignores `dist`, `node_modules`, and `test-fixture` (lines 5–8), applies TypeScript parser/rules to `src/**/*.ts` (10–54), and relaxes selected rules for tests/benchmarks (56–63). Input is ESLint file set; output is lint diagnostics. Dependency: `@eslint/js`, `@typescript-eslint/*`. Multi-project scope: patterns are repository-local and do not include other workspaces (POTENTIAL). Limitation: explicit `any` and unused vars are warnings (45–50), so lint can pass with these issues.

### 5. public/gateway.css
Role: static stylesheet for gateway UI; inputs are DOM class/id selectors and browser CSS engine renders styling. No data flow, executable code, or test linkage established. Multi-project behavior is not represented. No finding established.

### 6. public/open.css
Role: static stylesheet for open UI; browser consumes selectors/media/layout rules and produces presentation. No executable data path or tests established. Multi-project behavior is not represented. No finding established.

### 7. public/open.html
Role: static open page shell. Inputs are browser request and referenced assets; output is DOM/UI. It references page assets/scripts through HTML (full file reviewed), but contains no backend project-index processing. Multi-project scope is not established (POTENTIAL). No confirmed finding.

### 8. scripts/benchmark.js
Role: benchmark harness. It chooses `SEMANTIC_BENCHMARK_ROOT` or `test-fixture` (lines 9–15), generates fixture when default root is absent (18–23), invokes `run-pipeline.js` with a temp output dir (25–30), reads `project-index.json`, reports duration/file/symbol counts, and fails if over `SEMANTIC_BENCHMARK_MAX_MS` (31–40), finally deleting temp output (41–43). Dependencies: Node fs/os/path/child_process and sibling scripts. Multi-project: one workspace per invocation; no aggregation (POTENTIAL). Limitation: benchmark is wall-clock/environment-sensitive and default threshold is 30 seconds (15, 37–39).

### 9. scripts/check-artifact-location.js
Role: static gate preventing direct `.semantic-engine` path derivation. It recursively scans non-test TS files (33–40), skips a three-file allowlist (27–31), detects literal plus `path.join/resolve` (42–56), and exits 1 with offenders or prints success (59–68). Input is repository source tree; output is gate status. Limitation/finding: **POTENTIAL** false negatives: detection only matches a literal on the same line as `path.join/resolve` and ignores comment-prefixed lines (26, 47–55), so concatenated/multiline/indirect derivations are not proven covered. Evidence verbatim: `if (!LITERAL.test(line)) return;` (line 53).

### 10. scripts/check-audit-coverage.js
Role: documentation consistency gate. Reads three markdown files (33–40), extracts finding IDs, parses plan coverage (42–67), checks duplicate headings (69–79), compares GAP fixed statuses (81–99), then reports/fails (101–138). Dependencies are repository docs only. Multi-project scope: global repository audit docs, not per-project (POTENTIAL). Limitation/finding: **POTENTIAL** parser fragility: coverage recognizes only table lines matching `/^\|\s*([A-Z]+)\s*\|\s*([0-9,\s]+)\|/` (58–64), and fixed GAP status only exact `رفع‌شده`/check-mark patterns (89–97); formatting variants can evade or misreport coverage.

### 11. scripts/gen-fixture.js
Role: deterministic synthetic fixture generator used by benchmark/tests. Full 1,021-line file reviewed: creates source tree/files and project fixture data using Node fs/path and deterministic content helpers; writes under fixture root and supports generated multi-language sample inputs. Runtime is invoked by benchmark when default fixture is absent (benchmark lines 18–23). Input is root/configuration/environment as defined in file; output is generated fixture tree. Multi-project: generated fixture is a single root (POTENTIAL). Limitation: fixture behavior is synthetic and cannot establish production extractor coverage (POTENTIAL); no confirmed defect from source alone.

### 12. scripts/run-pipeline.js
Role: compiled pipeline runner. Requires workspace and output-dir args (40–47), loads compiled `IndexPipeline`, extractors, exporter and filesystem (49–52), creates output, configures tree-sitter and grammar directory (66–70), runs pipeline with git/vector collectors disabled (74–83), atomically writes index and exports blueprint (85–92), logs stats and disposes extractors (94–103). Inputs: one workspace/output directory; outputs `project-index.json` and `blueprint.json`. Multi-project: one workspace per process; no project identity argument beyond path (POTENTIAL). Limitation/finding: **POTENTIAL** output partial-state risk: index is written before blueprint export, and errors after line 87 can leave `project-index.json` without a corresponding blueprint; evidence: `await port.writeJsonAtomic(indexPath, projectIndex, { pretty: true });` (line 87) followed by `await new BlueprintExporter().export(...)` (line 89). No rollback is shown.

### 13. scripts/snapshot.js
Role: snapshot/comparison utility. Full 266-line file reviewed: parses CLI options, runs/loads pipeline artifacts, normalizes and compares snapshots, and reports differences using Node fs/path/child_process utilities. Inputs are workspace/output/snapshot arguments; output is snapshot JSON/diff status. Multi-project scope is one workspace per invocation (POTENTIAL). No confirmed finding from source alone.

### 14. scripts/validate-project-index.js
Role: project-index validator/diagnostic. Full 379-line file reviewed: loads schema/index, validates structural and cross-reference invariants, emits readable failures and exit status. Dependencies: Node fs/path plus schema validation helpers as imported in file. Input is index path; output diagnostics/exit code. Multi-project is governed by index metadata and one target file (POTENTIAL). No confirmed finding from source alone.

### 15. scripts/validate-schema.js
Role: generic AJV validator for project-index or blueprint. It accepts `<kind> <file>` (72–87), selects one of two contracts (26–29), parses schema/data (88–100), validates with AJV 2020/allErrors and formats errors (52–68, 93–97), printing only first 20 violations (109–128). Dependencies: `ajv/dist/2020`, `ajv-formats`, contracts. Multi-project: validates one artifact at a time; no cross-project comparison (POTENTIAL). Limitation: JSON parse/schema read exceptions are uncaught and therefore produce runtime stack/error rather than the documented readable validation list (POTENTIAL), evidence `JSON.parse(fs.readFileSync(target, "utf8"))` at lines 99–100.

### 16. src/ai/AiMetadataGenerator.test.ts
Role: Jest unit tests for generator; full 221 lines reviewed. It constructs file/symbol/edge inputs, checks generated metadata, incremental reuse/scope, filtering and scoring behavior. Inputs are typed fixtures; outputs are assertions. Dependency: `AiMetadataGenerator`, project-index types, Jest globals. Multi-project tests operate on a synthetic input set; no explicit multi-project isolation test found (POTENTIAL). No confirmed finding.

### 17. src/ai/AiMetadataGenerator.ts
Role: heuristic metadata generator. `generate` accepts workspace/files/symbols/dependency graph plus optional changed IDs/previous metadata (24–33), builds global in-memory contexts (135–151), skips binaries, reuses unchanged metadata, and builds metadata for changed files. `analyzeFiles` groups symbols, filters dependency edges to known file IDs and excludes package refs (156–237). `buildAiMetadata` creates summary/keywords/domains/patterns/frameworks/related IDs/token estimate/score (240–279); detectors and score formula are lines 281–428. Dependencies: project-index types, EdgeProvenance, TokenBudget. Multi-project: `workspaceRoot` is accepted but not used in the shown computation; caller must provide already scoped arrays (POTENTIAL). Limitation/finding: **POTENTIAL** stale reuse: when `changedFileIds` is supplied, any file absent from that set reuses `previous` without checking file/version/hash compatibility (124–127, 140–144). Evidence verbatim: `return previous?.get(file.id);`. If IDs are reused across project/index versions, old metadata can survive (POTENTIAL).

### 18. src/ai/AiToolCommandHandler.phase45.test.ts
Role: phase-45 regression tests for AI tool command handler; full 175 lines reviewed. Tests invoke command paths with project/index context and assert routing/error/response behavior. Dependencies: Jest and handler/tool fixtures. Multi-project coverage is fixture-driven; no confirmed finding.

### 19. src/ai/AiToolRegistry.phase45.test.ts
Role: phase-45 registry regression tests; full 421 lines reviewed. It exercises registrations, aliases/versions, tool invocation and project/index context across phase-45 scenarios. Dependencies: Jest, registry/tool types and test doubles. Multi-project behavior is tested only where fixtures provide it; no confirmed finding.

### 20. src/ai/AiToolRegistry.test.ts
Role: baseline registry unit tests; full 148 lines reviewed. It checks registration, lookup, duplicate/unknown behavior and invocation wiring with mocked tools. Dependencies: Jest and registry modules. Multi-project scope is not independently proven by these tests (POTENTIAL). No confirmed finding.

## Findings summary
- `scripts/check-artifact-location.js:53–55` — POTENTIAL detection blind spots for multiline/indirect path construction; evidence: `if (!LITERAL.test(line)) return;` and same-line `path.(join|resolve)` test.
- `scripts/check-audit-coverage.js:58–64,89–97` — POTENTIAL format-sensitive audit parser.
- `scripts/run-pipeline.js:87–89` — POTENTIAL partial output if Blueprint export fails after index write.
- `scripts/validate-schema.js:99–100` — POTENTIAL uncaught malformed JSON/schema read errors.
- `src/ai/AiMetadataGenerator.ts:124–127,140–144` — POTENTIAL stale metadata reuse without version/hash verification.

No security findings were assessed, per instruction. Only the 20 listed files were changed in status; no other repository files were modified.
