# Supplementary forensic audit — `semantic-engine/`

## Scope, revision, and method

- **Repository:** `legionir/semantic-engine-structured-ai`
- **Ref:** `main`
- **Commit audited:** `3a20f3192e43c5cf2723cd524e08e013f941a4ed`
- **Scope:** only files under `semantic-engine/`. Security was explicitly excluded; no security finding is reported.
- **Baseline:** the companion report (`semantic-engine-audit.md`) already records F-01–F-06 and P-01/P-02. This supplement does not repeat those findings.
- **Method:** first compared the complete recursive tree inventory in `tree-files.tsv` with the baseline report's reviewed-path set, then inspected previously unreviewed source, scripts, public/API-adjacent files, and tests. Evidence below is verbatim source text with manually counted line numbers from the same `main` revision. Findings are static unless a trigger path is explicitly described; no repository tests were executed.

## Tree comparison and exact coverage counts

The complete recursive tree contains **524 blobs** under `semantic-engine/`:

| inventory group | blobs |
|---|---:|
| `src/` | 474 |
| `public/` | 14 |
| `scripts/` | 9 |
| `contracts/` | 4 |
| `tree-sitter-grammars/` | 7 |
| `docs/` | 2 |
| `bin/` | 1 |
| root files | 11 |
| **total** | **524** |

The baseline report marked **74 files reviewed**. The deduplicated supplementary review added **58 new files**, so **132 files have now been reviewed in total**. Therefore **392 blobs remain not reviewed**. The remaining set is **385 fetched text/source blobs plus 7 uninspected `.wasm` grammar blobs**. The authoritative path-by-path inventory is `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/tree-files.tsv`; fetched unreviewed material is under `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo-unreviewed`.

The supplementary set covered the previously unreviewed runtime queue/worker path, watch/embedding path, visualization route/LoD service, context/search services and their AI tools, SQLite graph export/query path and parity test, provider/vector path, history/provider/server support files, scripts, public UI files, and targeted tests. The five paths newly inspected while validating this supplement were:

```text
src/runtime/queue/IJobQueue.ts
src/runtime/queue/InMemoryQueueAdapter.test.ts
src/ai/tools/SemanticSearchTool.ts
src/export/index.ts
src/index.ts
```

(The five paths above are included in the 58 count; the remainder are the 28 paths listed in the audit work log plus the earlier 25 supplementary paths, with all duplicates removed against the baseline set.)

## Findings — confirmed static defects

### F-07 — `watch` silently ignores the requested embedding provider

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** CLI/API correctness; persistence of requested vector configuration
- **Trigger path:** run `semantic-engine watch --embedding-provider ollama ...` or `--embedding-provider openai-compatible ...`. If no prior vector index exists, the command does not enable vector indexing merely because a provider was requested. If vector indexing is enabled, it still constructs a hashing generator rather than the requested provider.

`embeddingFromArgs.ts` explicitly defines provider selection as implying vectors:

```ts
/** آیا کاربر اصلاً provider خواسته است؟ (یعنی vectorها هم implied هستند) */
export function embeddingRequested(args: ParsedArgs): boolean {
  return stringOption(args.options, 'embeddingProvider') !== undefined;
}
```

Evidence: `src/cli/embeddingFromArgs.ts:29-31`.

The watch command imports both provider helpers but never calls them. Instead, its decision and generator are:

```ts
const wantsVectors = boolOption(
  args.options,
  'vectors',
  Boolean(existingIndex?.vectorChunks)
);
const vectorIndexer = wantsVectors
  ? new VectorIndexer({ embeddingGenerator: new HashingEmbeddingGenerator() })
  : null;
```

Evidence: `src/cli/commands/watch-command.ts:19-22` (imports) and `140-147` (actual construction). The same command passes that `vectorIndexer` into the initial pipeline at `watch-command.ts:163-184`, and passes it to `IncrementalEngine` at `198-205`; no later provider selection repairs the choice.

This makes the provider flags a no-op on the watch path and can produce either no `vectorChunks` or hashing vectors despite an explicit remote-provider request. It is distinct from F-02: this is the CLI watch configuration path, not the Gateway dashboard save path.

### F-08 — cancelling an active queue job does not cancel the worker task

- **Status:** CONFIRMED
- **Severity:** High (correctness/concurrency)
- **Confidence:** High
- **Area:** asynchronous job lifecycle
- **Trigger path:** enqueue a job, allow `IndexingWorker.getNextJob()` to mark it active, call `queue.cancelJob(id)`, then let `projectService.indexProject()` resolve.

The adapter changes only the stored queue record:

```ts
async cancelJob(id: string): Promise<boolean> {
  const job = this.jobs.get(id);
  if (!job) return false;
  if (job.status === 'completed' || job.status === 'failed') return false;

  this.jobs.set(id, { ...job, status: 'cancelled' });
  return true;
}
```

Evidence: `src/runtime/queue/InMemoryQueueAdapter.ts:46-53`. An active record is produced separately by `getNextJob()`:

```ts
const next = candidates[0]!;
const active: QueuedJob = { ...next, status: 'active' };
this.jobs.set(next.id, active);
return active;
```

Evidence: `InMemoryQueueAdapter.ts:63-79`.

The worker creates a private token source, but cancellation through the queue never reaches it. After only two checks before the indexing call, it unconditionally indexes and completes the job:

```ts
this.currentTaskTokenSource = new CancellationTokenSource();
const token = this.currentTaskTokenSource.token;
...
if (token.isCancellationRequested) throw new Error('Task cancelled');
...
const indexResult = await this.projectService.indexProject(job.projectId, {
  incremental: job.priority === 'urgent',
});

await this.queue.markComplete(job.id);
```

Evidence: `src/runtime/workers/IndexingWorker.ts:62-65`, `79-85`, and `90-95`. `cancelJob()` does not invoke `currentTaskTokenSource.cancel()`, and the worker never re-reads `queue.getJob(job.id)` after obtaining the active snapshot. Consequently the cancelled job can still mutate/reload project state and then overwrite its queue state to `completed`. The existing queue test only cancels a still-queued job (`src/runtime/queue/InMemoryQueueAdapter.test.ts:23-30`), so it does not cover this race.

### F-09 — neighborhood visualization replaces valid zero-valued options with defaults

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** HTTP API correctness
- **Trigger path:** POST `/api/v1/projects/:id/visualization/neighborhood` with `{ "seedId": "...", "depth": 0, "minConfidence": 0 }`.

The route schema accepts both values without a minimum constraint:

```ts
properties: {
  seedId: { type: 'string' },
  depth: { type: 'integer' },
  minConfidence: { type: 'number' },
},
required: ['seedId'],
```

But the handler uses truthiness defaults:

```ts
const body = (ctx.body || {}) as { seedId: string; depth?: number; minConfidence?: number };
const view = lodService.getNeighborhoodView(project, body.seedId, body.depth || 1, body.minConfidence || 70);
```

Evidence: `src/server/routes/visualizationRoutes.ts:123-145`, especially `140-142`. `depth: 0` is a meaningful zero-hop boundary, while `minConfidence: 0` is explicitly documented as “all edges” by the graph query API (`src/graphs/GraphQueryEngine.ts:110-117`). The graph filter preserves an explicit zero via nullish semantics (`GraphQueryEngine.ts:389-394`), so the route—not the graph engine—changes the requested behavior. The service then receives `1` and `70`, making zero-depth requests expand one level and zero-threshold requests discard edges below 70.

### F-10 — `ContextService` drops target-file selection and returns a fabricated token estimate

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** public service API / AI context assembly
- **Trigger path:** call the publicly exported `ContextService.assembleContext(project, { task, files: ['relative/path.ts'], maxTokens: 100 })` and inspect the returned items and `tokenEstimate`.

The service's public request contract names `files`:

```ts
export interface ContextRequestOptions {
  readonly task: string;
  readonly files?: string[];
  readonly maxTokens?: number;
}
```

Evidence: `src/services/ContextService.ts:8-12`. It forwards that property unchanged:

```ts
const result = await tool.execute({
  task: options.task,
  files: options.files,
  maxTokens: options.maxTokens,
});
```

Evidence: `ContextService.ts:28-32`. However, `AssembleContextTool` consumes `targetFiles`, not `files`:

```ts
export interface AssembleContextInput extends AiToolInput {
  readonly task: string;
  readonly targetFiles?: readonly string[];
  readonly targetSymbols?: readonly string[];
  readonly maxTokens?: number;
```

Evidence: `src/ai/tools/AssembleContextTool.ts:44-52`. Its implementation consequently reads an empty target list when called through `ContextService`:

```ts
const targetFiles = (input.targetFiles ?? [])
  .map(p => this.reader.getFileByPath(p))
  .filter((f): f is FileEntry => !!f);
```

Evidence: `AssembleContextTool.ts:183-185`.

The service also reports the requested budget as if it were actual usage:

```ts
return {
  task: options.task,
  tokenEstimate: options.maxTokens || 2000,
  summary: firstItem?.excerpt || `Assembled context with ${result.items.length} items`,
  items: [...result.items],
};
```

Evidence: `ContextService.ts:38-44`. The tool has the actual value in `result.metadata.estimatedTokens` (`AssembleContextTool.ts:321-333`), but the service discards that metadata. Thus selected files are ignored and `tokenEstimate` remains wrong even when the tool truncates or uses substantially fewer/more tokens.

### F-11 — OpenAI-compatible embedding batches silently accept short responses

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** vector indexing reliability / partial persistence
- **Trigger path:** configure an OpenAI-compatible endpoint that returns HTTP 200 with fewer embedding rows than inputs (for example, a malformed proxy response or provider-side partial batch), then index a project with vectors enabled.

The OpenAI path maps any returned rows without checking cardinality:

```ts
const data = (await this.postJson([url, fallback], headers, payload)) as {
  data?: Array<{ embedding?: number[] }>;
};
const rows = Array.isArray(data.data) ? data.data : [];
return rows.map(row => this.toResult(row.embedding ?? []));
```

Evidence: `src/vector/RemoteEmbeddingGenerator.ts:55-68`. In contrast, the Ollama branch explicitly checks `data.embeddings.length === texts.length` and falls back to one request per input (`RemoteEmbeddingGenerator.ts:70-98`).

`VectorIndexer` then silently skips every missing result:

```ts
const results = await generator.generateBatch(pending.map(c => c.content));

for (let i = 0; i < pending.length; i++) {
  const chunk = pending[i]!;
  const result = results[i];
  if (!result) continue;
```

Evidence: `src/vector/VectorIndexer.ts:176-182`. The pipeline can therefore report a successful index while some chunks have no embedding; subsequent semantic search sees only a partial vector store. The defect is not an HTTP error-handling claim: it specifically requires a successful but short batch response.

### F-12 — SQLite graph traversal defaults are observably inconsistent with the in-memory graph API

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** persistence/export API parity
- **Trigger path:** call the exported `SqliteGraphQuery.neighbors()`, `edgesFrom()`, or `path()` without explicitly supplying every direction/depth/threshold option, then compare with `GraphQueryEngine` on the same index.

SQLite defines these defaults:

```ts
const DEFAULT_MAX_NODES = 5_000;
const DEFAULT_DEPTH = 2;
...
async edgesFrom(
  nodeId: string,
  direction: Direction = 'out',
  relations?: readonly GraphRelation[],
  minConfidence = 0
): Promise<readonly GraphEdge[]> {
```

Evidence: `src/export/sqlite/SqliteGraphQuery.ts:68-69` and `194-199`. Its neighborhood query defaults to both directions and a high threshold:

```ts
const depth = options.depth ?? DEFAULT_DEPTH;
const minConfidence = options.minConfidence ?? HIGH_CONFIDENCE_THRESHOLD;
const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
const direction = options.direction ?? 'both';
```

Evidence: `SqliteGraphQuery.ts:238-247`. Its path defaults are again depth 2 and both directions (`SqliteGraphQuery.ts:342-350`).

The in-memory API instead applies a high-confidence default to `edgesFrom` through `passes()` and defaults ordinary BFS to outgoing direction; path uses depth 8 and outgoing direction:

```ts
const threshold = options.minConfidence ?? HIGH_CONFIDENCE_THRESHOLD;
```

Evidence: `src/graphs/GraphQueryEngine.ts:389-394`;

```ts
const depthLimit = options.depth ?? DEFAULT_DEPTH;
const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
const direction = options.direction ?? 'out';
```

Evidence: `GraphQueryEngine.ts:402-405`; and:

```ts
const depthLimit = options.depth ?? 8;
const direction = options.direction ?? 'out';
```

Evidence: `GraphQueryEngine.ts:482-485`.

The parity test supplies explicit direction, depth, and threshold in its comparisons (`src/export/sqlite/SqliteGraphQuery.phase49.test.ts:131-155` and `241-303`), so it does not detect the no-options divergence. Consumers using the exported SQLite backend can therefore get reverse edges, shorter paths, or low-confidence edges that the in-memory backend would omit.

### F-13 — SQLite shortest-path traversal ignores its public `maxNodes` limit

- **Status:** CONFIRMED
- **Severity:** Medium (correctness/performance)
- **Confidence:** High
- **Area:** persistence backend resource bound
- **Trigger path:** call `SqliteGraphQuery.path(from, to, { maxNodes: 1, depth: N })` on a graph requiring exploration through more than one intermediate candidate.

The public options advertise a node cap:

```ts
/** سقف گره. پیش‌فرض ۵۰۰۰. */
readonly maxNodes?: number;
```

Evidence: `src/export/sqlite/SqliteGraphQuery.ts:79-87`. `neighbors()` uses it to limit the recursive CTE (`SqliteGraphQuery.ts:243-292`), but `path()` delegates to `shortestPath()` and that implementation reads only depth and direction:

```ts
const depth = options.depth ?? DEFAULT_DEPTH;
const direction = options.direction ?? 'both';
const legs = branchesFor(options.relations).flatMap(branch => directed(branch, direction));
```

Evidence: `SqliteGraphQuery.ts:342-350`. The generated recursive SQL has no `LIMIT` or visited-node counter (`SqliteGraphQuery.ts:352-376`), and `options.maxNodes` is never referenced in `shortestPath`.

This differs from the in-memory path implementation, which checks `visited.size > maxNodes` and marks the result truncated (`src/graphs/GraphQueryEngine.ts:482-529`). A caller can therefore request a bounded SQLite path search but still cause an unbounded-by-node recursive exploration (up to depth), and receives no truncation indication in `SqlitePathResult`.

### F-14 — `check-tests.js` claims that all suites ran while allowing skipped suites

- **Status:** CONFIRMED (test-gate defect)
- **Severity:** Low–Medium
- **Confidence:** High
- **Area:** test/build reliability
- **Trigger path:** any Jest run containing `describe.skip(...)` or another skipped suite while all executed tests pass.

The script documents a stronger guarantee than it enforces:

```js
| Runs the suite and fails unless *every* suite ran.
```

Evidence: `scripts/check-tests.js:5-10`. The gate checks only a failed-suite match, process status, and whether a summary exists:

```js
const failedSuites = /Test Suites:.*?(\d+) failed/.exec(output);

if (failedSuites) {
  ...
  process.exit(1);
}

if (result.status !== 0) {
  ...
  process.exit(result.status ?? 1);
}

if (!suites) {
  ...
  process.exit(1);
}

console.log("\nall suites ran");
```

Evidence: `scripts/check-tests.js:76-99`. There is no check for `skipped` in the `Test Suites:` summary and no check that the number of executed suites equals discovered suites. A successful Jest summary containing skipped suites therefore passes and prints `all suites ran`, making the build gate unable to enforce its stated coverage guarantee. No test command was executed during this audit.

### F-15 — `SearchService` does not honor its declared `mode` and `minScore` contract

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** search API correctness
- **Trigger path:** call the publicly exported `SearchService.search(project, { query, mode: 'vector', minScore: 0.9 })`, or call it with `mode: 'hybrid'`, and compare the actual candidate pipeline.

The public options declare three modes and a score threshold:

```ts
export interface SearchQueryOptions {
  readonly query: string;
  readonly limit?: number;
  readonly mode?: 'hybrid' | 'keyword' | 'vector';
  readonly minScore?: number;
```

Evidence: `src/services/SearchService.ts:8-15`. The service ignores `minScore` entirely and collapses both vector and hybrid to the same boolean:

```ts
const result = await tool.execute({
  query: options.query,
  limit: options.limit || 20,
  useEmbeddings: options.mode !== 'keyword',
  filters: {
    path: options.pathFilter,
    kind: options.kindFilter,
  },
});
```

Evidence: `SearchService.ts:28-35`. `SemanticSearchTool` always computes keyword candidates before optionally computing embedding candidates:

```ts
// Step 1: keyword-based candidates
const keywordCandidates = this.getKeywordCandidates(terms, kinds, languages, filters);

// Step 2: embedding-based candidates
let embeddingCandidates: ScoredEntity[] = [];
```

Evidence: `src/ai/tools/SemanticSearchTool.ts:209-215`. Thus `mode: 'vector'` is not vector-only, `mode: 'hybrid'` and `mode: 'vector'` select the same behavior, and the caller cannot enforce the declared minimum score through `SearchService`. The returned mode field (`SearchService.ts:43-46`) only echoes the requested string; it does not prove that the mode was applied.

## Unverified observations kept separate

These observations were examined but are not promoted to findings because the audit did not establish a concrete consumer contract or trigger with sufficient confidence:

- `SseManager`/`WebSocketManager` do not visibly handle write backpressure or replay missed events; no reconnect/replay contract was established.
- `LodService.getModuleView()` can retain an edge whose opposite endpoint is outside the selected node set; UI handling was not sufficient to call this a confirmed defect.
- `LocalEmbeddingGenerator` lazy initialization may race under concurrent first calls; no production concurrent caller was established.
- Blueprint schema referential identities are not cross-document validated; no validator/consumer trigger was established.
- Artifact-location checks use narrow single-line expression matching; no actual bypassing source offender was tied to it.
- `FactStore` equal-confidence supersession ordering is insertion-stable; no consumer-visible failure was demonstrated.
- Security-related provider/network observations were intentionally excluded.

## Execution limitations and feedback for the parent

- **Tests:** no repository tests were executed. The retrieved workspace did not have usable `node_modules`; all conclusions are static source/test inspection.
- The bulk tree and file inventory were obtained before source review; no files outside `semantic-engine/` were used as evidence.
- The initial audit's F-01–F-06 and P-01/P-02 are not duplicated here.
- The remaining 393 blobs are not represented as reviewed merely because they were present in the fetched local tree; only the 57 paths newly inspected in this supplement were added to coverage.

## Finding index

| ID | status | severity | confidence |
|---|---|---|---|
| F-07 | CONFIRMED | Medium | High |
| F-08 | CONFIRMED | High | High |
| F-09 | CONFIRMED | Medium | High |
| F-10 | CONFIRMED | Medium | High |
| F-11 | CONFIRMED | Medium | High |
| F-12 | CONFIRMED | Medium | High |
| F-13 | CONFIRMED | Medium | High |
| F-14 | CONFIRMED (test-gate defect) | Low–Medium | High |
| F-15 | CONFIRMED | Medium | High |

**Security findings:** intentionally omitted per scope instruction.


## Coverage update — 2026-09-17

The directly reviewed paths completed in this pass are recorded one per line in `semantic-completed-paths.txt`. These manifests are the authoritative increment for this pass; all other paths remain at their prior status in `AUDIT_FILE_STATUS.md`. No security review was performed.


## Batch review — 2026-09-17

# Forensic batch review — `semantic-engine/`

## Scope and method

Reviewed 30 files that were marked `درانتظار` in `AUDIT_FILE_STATUS.md`, all directly readable in the local mirror under `work/repo/semantic-engine`. Each selected source/config/test file was opened and its relevant execution path, dependencies, error handling, and test coverage were traced. Security was out of scope. No tests were executed.

## Confirmed findings

### F-16 — IndexPipeline ignores the entire top-level directory when output is nested under a source directory

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Trigger:** Run `IndexPipeline` with `outputPath` inside the workspace at a nested path whose first segment is a real source directory, for example `workspace/src/generated/project-index.json`, while `src` is not otherwise ignored.

The implementation computes the output directory and relative path:

```ts
const outputDir = path.dirname(path.resolve(this.options.outputPath));
const relative = path.relative(workspaceRoot, outputDir).split(path.sep).join('/');
```

Evidence: `src/pipeline/IndexPipeline.ts:502-505`.

After confirming the path is inside the workspace, it extracts only the first path segment and adds that segment to `ignoreDirectories`:

```ts
const existing = base.ignoreDirectories ?? DEFAULT_IGNORE_DIRECTORIES;
const name = relative.split('/')[0]!;
if (existing.includes(name)) return base;

return { ...base, ignoreDirectories: [...existing, name] };
```

Evidence: `src/pipeline/IndexPipeline.ts:510-514`.

`WorkspaceScanner`/`IgnoreMatcher` treat an entry in `ignoreDirectories` as a directory name to skip recursively. Therefore an output directory such as `src/generated` causes `src`—not merely `src/generated`—to be ignored, removing all source files under `src` from the index. The nearby comment claims the fix is to ignore “the path that is actually written” (`IndexPipeline.ts:498-500`), but the actual value passed is only the top-level name. The reviewed `IndexPipeline.test.ts` covers the normal output path under `.semantic-engine` and general indexing, but has no nested-output-under-source test; its output path is `workspace/.semantic-engine/project-index.json`, so the defect is not exercised.

### F-17 — TypeScript dependency extraction collapses multiple exported variables into one invalid export name

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Trigger:** Index a TS/JS file containing a multi-declarator exported variable statement, e.g. `export const first = 1, second = 2;`.

The extractor intentionally advertises one `ExportEntry` per exported name:

```ts
SE-DATA-02 — یک `ExportEntry` به‌ازای هر نام.
```

Evidence: `src/dependencies/typescript/TSDependencyExtractor.ts:269-275`. Named export declarations correctly map each AST element separately (`TSDependencyExtractor.ts:280-287`), but declaration-based exports use `parseExportedDeclaration`, which returns only one `ExportEntry`:

```ts
private parseExportedDeclaration(node: ts.Node): ExportEntry | null {
  const isDefault = this.hasDefaultModifier(node);
  const name = this.getDeclarationName(node);
  ...
  return {
    name,
    kind: isDefault ? 'default' : 'named',
  };
}
```

Evidence: `src/dependencies/typescript/TSDependencyExtractor.ts:313-330`.

For a variable statement, `getDeclarationName` collects every identifier but joins them into one comma-separated string:

```ts
if (ts.isVariableStatement(node)) {
  const names: string[] = [];
  for (const decl of node.declarationList.declarations) {
    if (ts.isIdentifier(decl.name)) {
      names.push(decl.name.text);
    }
  }
  return names.length > 0 ? names.join(', ') : null;
}
```

Evidence: `src/dependencies/typescript/TSDependencyExtractor.ts:357-371`.

The resulting export is `{ name: 'first, second', kind: 'named' }` rather than two entries (`first` and `second`). Downstream symbol/export linking and API metadata cannot resolve either individual exported symbol by name. The reviewed `TSDependencyExtractor.test.ts` tests named imports, packages/builtins, dynamic imports, single declarations, re-exports, and aliases, but does not test multiple declarators; the defect therefore has no coverage in the selected test.

## No additional confirmed findings

The other reviewed paths did not yield a separate confirmed defect under the stated scope and evidence standard. In particular, graph traversal, incremental store synchronization, watch serialization/disposal, output atomicity/schema validation, path resolution, and job cancellation behavior had targeted tests or coherent error handling in the inspected paths.


## Batch 2 review — 2026-09-17

# Forensic batch review — `semantic-engine/`

## Scope and method

Reviewed 30 files marked `درانتظار` in `AUDIT_FILE_STATUS.md`, directly from the local mirror under `work/repo/semantic-engine`. The selected batch covers the CLI launcher, blueprint contract, archived/current public UI assets, build/audit/fixture/pipeline/snapshot/schema-validation scripts, AI metadata and registry tests/implementation, config/test mapping, blueprint/context discovery, and token-cost tests. For each source/implementation file, imports/callers and downstream data shape were traced where present; tests, error paths, and project-root/multi-project implications were checked. Security was out of scope. No repository tests were executed.

## Confirmed finding

### F-18 — `scripts/snapshot.js` normalizer discards all supposedly stable IDs

- **Status:** CONFIRMED
- **Severity:** Medium (test/snapshot correctness)
- **Confidence:** High
- **Area:** regression detection / generated-artifact snapshot gate
- **Trigger path:** run `node scripts/snapshot.js` (or its snapshot comparison in CI) against a generated project index/blueprint containing IDs, then change a stable file/symbol/module/graph ID while keeping the rest of the normalized artifact equal.

The script explicitly says that IDs under selected collections are stable and should be retained:

```js
/* Kept even though the name matches: these are stable identifiers. */
const KEEP_ID_UNDER = new Set([
    "files", "symbols", "nodes", "edges", "callGraph", "typeGraph",
    "dependencyGraph", "reverseDependencyGraph", "vectorChunks",
    "moduleMap", "symbolIndex", "technicalConstraints", "apiMap"
]);
```

Evidence: `scripts/snapshot.js:62-67`.

The volatility decision attempts to preserve those IDs only when the current object’s parent key is one of the set:

```js
const isVolatile =
    VOLATILE.has(name) &&
    !(name === "id" && KEEP_ID_UNDER.has(parentKey));
```

Evidence: `scripts/snapshot.js:80-84`.

However, the recursive call that enters every object overwrites the parent context with the child property name:

```js
out[name] =
    isVolatile
        ? "<volatile>"
        : normalise(value[name], name, name);
```

Evidence: `scripts/snapshot.js:86-89`. For an object inside `files` (or `symbols`, `moduleMap`, etc.), the `id` property is therefore evaluated with `parentKey === "id"`, not `parentKey === "files"`/`"symbols"`/the relevant collection. Since `"id"` is in `VOLATILE` at `snapshot.js:57`, every such ID becomes `"<volatile>"`; `KEEP_ID_UNDER` is effectively unreachable for normal collection items. The same propagation error also means nested collection IDs are not protected.

The result is that the snapshot comparison cannot detect a stable-identity regression: changing a file/symbol/module/graph ID alone normalizes both expected and actual values to the same placeholder. This affects every project passed through the shared `run-pipeline.js`/`snapshot.js` path, including multi-project use when snapshots are generated separately per workspace. It is distinct from intentionally volatile blueprint metadata IDs: those should remain volatile, but generated index entity IDs and graph IDs are explicitly listed as stable.

The reviewed script has no test fixture/assertion for preserving IDs, and the selected tests do not cover this normalizer. No repository tests were run during this audit.

## No additional confirmed findings

The other 29 reviewed files did not yield a separate confirmed defect under the requested evidence standard. In particular, the CLI launcher has explicit not-built and rejected-promise handling; benchmark/snapshot/pipeline scripts clean temporary output in `finally`; schema/index validators report malformed input and referential errors; AI metadata and test-mapping code have targeted regression tests; blueprint loading degrades explicitly when absent/invalid; and context discovery has tests for search, blueprint, graph expansion, limits, tokenization, and multi-project-independent project-index inputs.

## Execution limitations

- No repository tests were executed; no usable `node_modules`/build execution was assumed.
- Security review was intentionally excluded.
- All 30 paths were directly read from the local mirror; the authoritative manifest is `semantic-batch2-completed.txt`.
