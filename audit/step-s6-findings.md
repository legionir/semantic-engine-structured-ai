# Audit Findings — Step s6
## semantic-engine/src/ai/discovery/ and other src/ modules

### Files Audited in This Step
- semantic-engine/src/ai/discovery/BlueprintIndex.ts
- semantic-engine/src/ai/discovery/ContextDiscoverer.ts
- semantic-engine/src/ai/discovery/loadBlueprint.ts
- semantic-engine/src/vector/VectorStoreCache.ts
- semantic-engine/src/vector/VectorStore.ts
- semantic-engine/src/vector/VectorIndexer.ts
- semantic-engine/src/vector/RemoteEmbeddingGenerator.ts
- semantic-engine/src/vector/LocalEmbeddingGenerator.ts
- semantic-engine/src/vector/HashingEmbeddingGenerator.ts
- semantic-engine/src/vector/EmbeddingGenerator.ts
- semantic-engine/src/vector/EmbeddingConfig.ts
- semantic-engine/src/vector/createEmbeddingGenerator.ts
- semantic-engine/src/blueprint/index.ts
- semantic-engine/src/blueprint/EntityMapExtractor.ts
- semantic-engine/src/blueprint/BlueprintGenerator.ts
- semantic-engine/src/blueprint/ApiMapExtractor.ts
- semantic-engine/src/graphs/TypeGraphBuilder.ts
- semantic-engine/src/graphs/SymbolIndex.ts
- semantic-engine/src/graphs/SubgraphExplorer.ts
- semantic-engine/src/graphs/GraphQueryEngine.ts
- semantic-engine/src/test/setupDataDir.ts
- semantic-engine/src/test/globalSetupDataDir.ts
- semantic-engine/src/blueprint/moduleResponsibility.test.ts
- semantic-engine/src/vector/index.ts

---

## CONFIRMED FINDINGS

### ARCH-021
**SEVERITY:** HIGH  
**CATEGORY:** Architecture  
**CONFIDENCE:** CONFIRMED

**TITLE:** ContextDiscoverer.discover() violates Single Responsibility Principle with 200+ line monolithic orchestration

**LOCATION:**
- File: semantic-engine/src/ai/discovery/ContextDiscoverer.ts
- Symbol: ContextDiscoverer.discover()
- Line(s): approximate (method spans ~150 lines)

**EVIDENCE:**
```typescript
// semantic-engine/src/ai/discovery/ContextDiscoverer.ts
async discover(input: DiscoverInput): Promise<DiscoveryResult> {
    const limit = input.limit ?? 20;
    const expansionDepth = Math.max(0, input.expansionDepth ?? 2);
    const seedLimit = input.seedLimit ?? 8;
    const filesPerModule = input.filesPerModule ?? 3;
    const maxNodes = input.maxNodes ?? 200;
    const includeTests = input.includeTests ?? false;
    const maxPerFile = Math.max(1, input.maxPerFile ?? 2);

    const terms = queryTerms(input.task);

    // ── ۱. دانه از جست‌وجو ────────────────────────────────────────
    const seeds = new Map<string, DiscoverySeed>();
    const keywordById = new Map<string, number>();

    const searchResult = await this.search.execute({ query: input.task, limit: seedLimit });
    for (const item of searchResult.items) {
      // ... 30+ lines of seed collection
    }

    // ── ۲. دانه از blueprint ──────────────────────────────────────
    const modules = this.options.blueprint?.matchModules(terms) ?? [];
    let blueprintSeeds = 0;
    for (const mod of modules) {
      // ... 20+ lines of blueprint seed collection
    }

    // ── ۳. گسترش گرافی ────────────────────────────────────────────
    const seedIds = Array.from(seeds.keys());
    const seedWeights: Record<string, number> = {};
    for (const [id, seed] of seeds) seedWeights[id] = seed.weight;

    const exploration = this.subgraphExplorer().explore(seedIds, {
      maxDepth: expansionDepth,
      maxNodes,
      direction: 'both',
      seedWeights,
    });

    // ── ۴. رتبه‌بندی ──────────────────────────────────────────────
    interface Entity { /* ... */ }
    const entities: Entity[] = [];
    // ... 40+ lines of entity construction

    const rankCandidates: RankCandidate<Entity>[] = entities.map(entity => {
      // ... 20+ lines of ranking signal construction
    });

    const ranked = this.ranker.rank<Entity>(rankCandidates, { /* ... */ });

    // ── ۵. تنوع‌بخشی ─────────────────────────────────────────────
    const perFile = new Map<string, number>();
    const diversified: DiscoveredCandidate[] = [];
    // ... 15+ lines of diversification
}
```

**PROBLEM:** The `discover()` method contains 5 distinct phases (search, blueprint matching, graph expansion, ranking, diversification) in a single 200+ line method. This violates Single Responsibility Principle, makes the method hard to test in isolation, and creates a maintenance burden where changes to any phase risk breaking others.

**WHY IT IS A PROBLEM:** 
1. **Testability:** Cannot unit test ranking logic without also executing search and graph expansion
2. **Maintainability:** Any change to seed collection, expansion, or ranking requires understanding the entire method
3. **Reusability:** Other workflows cannot reuse individual phases (e.g., "expand but don't rank")
4. **Debugging:** Stack traces and logs conflate 5 distinct operations

**TRIGGER / EXECUTION PATH:** Any call to `ContextDiscoverer.discover()` executes all 5 phases sequentially.

**EXPECTED BEHAVIOR:** Each phase should be a separate, testable method or class with clear inputs/outputs.

**ACTUAL BEHAVIOR:** All phases are tightly coupled in a single method with shared mutable state (`seeds`, `entities`, `ranked`).

**IMPACT:** HIGH — Makes the core discovery workflow fragile and difficult to evolve. Any bug in ranking affects the entire discovery pipeline.

**ROOT CAUSE:** Incremental development without refactoring; each phase was added to the same method rather than extracted.

**RECOMMENDED FIX:** Extract each phase into its own method or class:
- `collectSearchSeeds()`
- `collectBlueprintSeeds()`
- `expandSubgraph()`
- `rankCandidates()`
- `diversifyResults()`

**REGRESSION RISK:** LOW — Internal refactoring with same inputs/outputs.

**RELATED FILES:**
- semantic-engine/src/ai/discovery/BlueprintIndex.ts
- semantic-engine/src/ai/ranking/ContextRanker.ts
- semantic-engine/src/graphs/SubgraphExplorer.ts

**RELATED WORKFLOWS:** Context discovery, candidate generation, AI-assisted code navigation

---

### SEC-022
**SEVERITY:** HIGH  
**CATEGORY:** Security  
**CONFIDENCE:** CONFIRMED

**TITLE:** ApiMapExtractor hardcodes authRequired: false for all routes, creating false sense of security

**LOCATION:**
- File: semantic-engine/src/blueprint/BlueprintGenerator.ts
- Symbol: BlueprintGenerator.buildApiMap()
- Line(s): approximate (within buildApiMap method)

**EVIDENCE:**
```typescript
// semantic-engine/src/blueprint/BlueprintGenerator.ts
entries.push({
  id: `api-${sha256(`${file.id}:${route.method}:${route.path}:${route.line}`).substring(0, 12)}`,
  method: route.method as ApiEntry['method'],
  path: route.path,
  handlerSymbolId: handlerSymbol?.id ?? null,
  handlerName: route.handlerName,
  fileId: file.id,
  line: route.line,
  framework: route.framework,
  derivedFrom: 'static-analysis',
  /*
  | تشخیصِ اینکه یک مسیر احراز هویت می‌خواهد، از نحو
  | برنمی‌آید. `false` اینجا یعنی «شواهدی ندیدم»، نه «باز
  | است» — و چون قرارداد این فیلد را اجباری کرده، جای دیگری
  | برای گفتنش نیست.
  */
  authRequired: false,
});
```

**PROBLEM:** The `authRequired` field is hardcoded to `false` for all extracted routes. The comment acknowledges this means "no evidence seen" rather than "open", but the field name and consumers may interpret it as "authentication not required".

**WHY IT IS A PROBLEM:**
1. **Misleading semantics:** `authRequired: false` strongly suggests the route is public
2. **Security decisions:** Downstream tools may use this field to skip security reviews for "public" routes
3. **False negatives:** Routes requiring authentication will be incorrectly flagged as open
4. **No detection logic:** The extractor makes no attempt to detect auth middleware, guards, or decorators

**TRIGGER / EXECUTION PATH:** Any route extraction via `ApiMapExtractor` or `BlueprintGenerator.buildApiMap()`.

**EXPECTED BEHAVIOR:** Either:
- Omit `authRequired` when unknown (tri-state: true/false/unknown)
- Implement actual auth detection (middleware analysis, decorator scanning)
- Rename field to `authEvidence` to clarify uncertainty

**ACTUAL BEHAVIOR:** All routes get `authRequired: false`, creating a false sense of security coverage.

**IMPACT:** HIGH — Security reviews based on this data will miss authenticated routes, potentially exposing sensitive endpoints.

**ROOT CAUSE:** Field was added to schema without implementation; static analysis for auth detection is non-trivial and was deferred.

**RECOMMENDED FIX:** 
1. Change field to `authRequired?: boolean | null` where `null` means "unknown"
2. OR implement basic auth detection: scan for middleware names (`auth`, `authenticate`, `guard`), decorators (`@UseGuards`, `@Authenticated`), and route-level checks
3. Update all consumers to handle tri-state

**REGRESSION RISK:** MEDIUM — Requires schema change and consumer updates.

**RELATED FILES:**
- semantic-engine/src/blueprint/ApiMapExtractor.ts
- semantic-engine/src/core/types/blueprint.types.ts

**RELATED WORKFLOWS:** API security review, attack surface analysis, route documentation

---

### ARCH-023
**SEVERITY:** MEDIUM  
**CATEGORY:** Architecture  
**CONFIDENCE:** CONFIRMED

**TITLE:** BlueprintGenerator is a God class with 8+ distinct responsibilities

**LOCATION:**
- File: semantic-engine/src/blueprint/BlueprintGenerator.ts
- Symbol: BlueprintGenerator
- Line(s): entire file

**EVIDENCE:**
```typescript
// semantic-engine/src/blueprint/BlueprintGenerator.ts
export class BlueprintGenerator {
  generate(projectIndex: ProjectIndex): Blueprint {
    const modules = this.buildModuleMap(projectIndex.files);           // 1. Module mapping
    const apiMap = this.buildApiMap(projectIndex);                     // 2. API extraction
    const folderStructure = this.buildFolderStructure(projectIndex.files); // 3. Folder structure
    const dependencyGraph = this.buildDependencyGraph(projectIndex, modules); // 4. Dependency graph
    const moduleDependencies = this.deriveModuleDependencies(modules, dependencyGraph); // 5. Module deps
    const modulesWithDeps = modules.map(mod => { /* ... */ });        // 6. Module enrichment
    const entityTechnicalMapping = new EntityMapExtractor().extract({ /* ... */ }); // 7. Entity mapping
    const workflowExecutionMap = new WorkflowExtractor().extract({ /* ... */ }); // 8. Workflow extraction
    const symbolIndex = this.buildSymbolIndex(projectIndex.symbols, projectIndex.files); // 9. Symbol index
    const technicalConstraints = this.buildTechnicalConstraints(projectIndex); // 10. Constraints
    // ... plus architecture overview, meta, etc.
  }
}
```

**PROBLEM:** `BlueprintGenerator` combines 10+ distinct responsibilities in a single class. Each responsibility has different inputs, outputs, and failure modes.

**WHY IT IS A PROBLEM:**
1. **Testing:** Must construct a full `ProjectIndex` to test any single responsibility
2. **Performance:** Cannot generate partial blueprints (e.g., only module map) without computing everything
3. **Change isolation:** Changes to entity mapping risk breaking dependency graph generation
4. **Reusability:** Other tools cannot reuse individual extractors without the full generator

**TRIGGER / EXECUTION PATH:** Any call to `BlueprintGenerator.generate()`.

**EXPECTED BEHAVIOR:** Separate extractor classes for each concern, composed by a lightweight orchestrator.

**ACTUAL BEHAVIOR:** Single class with private methods for each concern, all executed unconditionally.

**IMPACT:** MEDIUM — Makes the blueprint generation pipeline rigid and difficult to optimize or extend.

**ROOT CAUSE:** Incremental development; each new extractor was added to the existing class rather than extracted.

**RECOMMENDED FIX:** Extract into separate classes:
- `ModuleMapBuilder`
- `ApiMapExtractor` (already exists)
- `EntityMapExtractor` (already exists)
- `WorkflowExtractor` (already exists)
- `DependencyGraphBuilder`
- `ArchitectureOverviewBuilder`

Then compose them in `BlueprintGenerator` or a dedicated `BlueprintOrchestrator`.

**REGRESSION RISK:** LOW — Internal refactoring with same outputs.

**RELATED FILES:**
- semantic-engine/src/blueprint/ApiMapExtractor.ts
- semantic-engine/src/blueprint/EntityMapExtractor.ts
- semantic-engine/src/core/types/blueprint.types.ts

**RELATED WORKFLOWS:** Blueprint generation, architecture analysis, codebase understanding

---

### PERF-024
**SEVERITY:** MEDIUM  
**CATEGORY:** Performance  
**CONFIDENCE:** CONFIRMED

**TITLE:** VectorStore uses synchronous fs operations in loadBlueprint, blocking event loop

**LOCATION:**
- File: semantic-engine/src/ai/discovery/loadBlueprint.ts
- Symbol: loadBlueprint, loadBlueprintBeside
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/ai/discovery/loadBlueprint.ts
export function loadBlueprintBeside(projectIndexPath: string): BlueprintLoadResult {
  const blueprintPath = path.join(path.dirname(projectIndexPath), BLUEPRINT_FILENAME);
  return loadBlueprint(blueprintPath);
}

export function loadBlueprint(blueprintPath: string): BlueprintLoadResult {
  if (!fs.existsSync(blueprintPath)) {                    // Blocking
    return { index: null, note: `no blueprint at ${blueprintPath}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));  // Blocking
  } catch (error) {
    return {
      index: null,
      note: `blueprint is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // ...
}
```

**PROBLEM:** `loadBlueprint` uses `fs.existsSync` and `fs.readFileSync`, which are blocking synchronous I/O operations. In a server or CLI context handling multiple requests, this blocks the event loop.

**WHY IT IS A PROBLEM:**
1. **Event loop blocking:** Synchronous file I/O blocks the Node.js event loop
2. **Concurrency:** Multiple concurrent `loadBlueprint` calls serialize on the event loop
3. **CLI impact:** Less critical for CLI, but still blocks progress during file read

**TRIGGER / EXECUTION PATH:** Any call to `loadBlueprint` or `loadBlueprintBeside`, typically during `ContextDiscoverer` initialization or blueprint loading.

**EXPECTED BEHAVIOR:** Use `fs.promises` API (`fs.exists` and `fs.readFile`) for non-blocking I/O.

**ACTUAL BEHAVIOR:** Synchronous I/O blocks the event loop during blueprint loading.

**IMPACT:** MEDIUM — Affects responsiveness in server contexts; minor impact in CLI.

**ROOT CAUSE:** Convenience of synchronous API; no async wrapper was created.

**RECOMMENDED FIX:**
```typescript
export async function loadBlueprint(blueprintPath: string): Promise<BlueprintLoadResult> {
  try {
    await fs.promises.access(blueprintPath);
  } catch {
    return { index: null, note: `no blueprint at ${blueprintPath}` };
  }

  try {
    const content = await fs.promises.readFile(blueprintPath, 'utf8');
    const parsed = JSON.parse(content);
    // ...
  } catch (error) {
    // ...
  }
}
```

**REGRESSION RISK:** LOW — API change from sync to async requires caller updates.

**RELATED FILES:**
- semantic-engine/src/ai/discovery/ContextDiscoverer.ts (caller)

**RELATED WORKFLOWS:** Blueprint loading, context discovery initialization

---

### REL-025
**SEVERITY:** MEDIUM  
**CATEGORY:** Reliability  
**CONFIDENCE:** CONFIRMED

**TITLE:** ContextDiscoverer caches GraphQueryEngine and SubgraphExplorer, risking stale graph data

**LOCATION:**
- File: semantic-engine/src/ai/discovery/ContextDiscoverer.ts
- Symbol: ContextDiscoverer.graph, ContextDiscoverer.explorer, ContextDiscoverer.subgraphExplorer()
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/ai/discovery/ContextDiscoverer.ts
export class ContextDiscoverer {
  private readonly search: SemanticSearchTool;
  private readonly ranker = new ContextRanker();
  private graph: GraphQueryEngine | null = null;
  private explorer: SubgraphExplorer | null = null;

  constructor(
    private readonly reader: ProjectIndexReader,
    private readonly options: ContextDiscovererOptions = {}
  ) {
    this.search = new SemanticSearchTool(reader, options.embeddingGenerator);
  }

  private subgraphExplorer(): SubgraphExplorer {
    if (!this.explorer) {
      this.graph = this.graph ?? new GraphQueryEngine(this.reader.projectIndex);
      this.explorer = new SubgraphExplorer(this.graph);
    }
    return this.explorer;
  }
}
```

**PROBLEM:** `ContextDiscoverer` caches `GraphQueryEngine` and `SubgraphExplorer` instances. If the underlying `projectIndex` changes (e.g., after re-indexing), the cached graph becomes stale and returns incorrect traversal results.

**WHY IT IS A PROBLEM:**
1. **Stale data:** Graph reflects old project state after re-indexing
2. **Memory leak:** Cached graph holds references to old index data
3. **Incorrect results:** Subgraph exploration uses outdated dependency/call graphs
4. **No invalidation:** No mechanism to detect or trigger cache invalidation

**TRIGGER / EXECUTION PATH:** Any `discover()` call after the project index has been updated.

**EXPECTED BEHAVIOR:** Either:
- Invalidate cache when `projectIndex` changes
- Create fresh graph/explorer per `discover()` call
- Add explicit `invalidate()` method

**ACTUAL BEHAVIOR:** Graph and explorer are created once and never invalidated.

**IMPACT:** MEDIUM — In long-running processes (VS Code extension, server), stale graphs produce incorrect discovery results after code changes.

**ROOT CAUSE:** Optimization to avoid rebuilding graph on every `discover()` call, without invalidation mechanism.

**RECOMMENDED FIX:**
```typescript
private subgraphExplorer(): SubgraphExplorer {
  const currentIndex = this.reader.projectIndex;
  if (this.graph?.projectIndex !== currentIndex) {
    this.graph = new GraphQueryEngine(currentIndex);
    this.explorer = new SubgraphExplorer(this.graph);
  }
  return this.explorer;
}
```

**REGRESSION RISK:** LOW — Adds invalidation check, preserves caching when index unchanged.

**RELATED FILES:**
- semantic-engine/src/graphs/GraphQueryEngine.ts
- semantic-engine/src/graphs/SubgraphExplorer.ts

**RELATED WORKFLOWS:** Context discovery, incremental indexing, live code analysis

---

### DEBT-026
**SEVERITY:** MEDIUM  
**CATEGORY:** Technical Debt  
**CONFIDENCE:** CONFIRMED

**TITLE:** VectorStore.selectBackend silently falls back from usearch to brute-force without notification

**LOCATION:**
- File: semantic-engine/src/vector/VectorStore.ts
- Symbol: VectorStore.selectBackend, VectorStore.backend
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/vector/VectorStore.ts
private selectBackend(
  chunkCount: number,
  options: VectorStoreOptions
): 'brute-force' | 'usearch' {
  const backend = options.backend ?? 'auto';
  if (backend === 'brute-force') return 'brute-force';
  if (backend === 'usearch') {
    if (!this.isUsearchAvailable()) {
      throw new Error('usearch backend requested but package is not available');
    }
    return 'usearch';
  }

  // auto
  const threshold = options.usearchThreshold ?? 500;
  if (chunkCount >= threshold && this.isUsearchAvailable()) {
    return 'usearch';
  }
  return 'brute-force';  // Silent fallback
}
```

**PROBLEM:** When `backend: 'auto'` and usearch is unavailable or chunk count is below threshold, the code silently falls back to brute-force. The `backend` property exposes which backend was selected, but there's no logging or telemetry about the fallback.

**WHY IT IS A PROBLEM:**
1. **Performance surprise:** Users expecting usearch performance get brute-force without knowing
2. **Debugging difficulty:** Performance issues in production are hard to trace without knowing which backend is active
3. **Configuration drift:** Threshold changes or usearch unavailability silently changes behavior

**TRIGGER / EXECUTION PATH:** Any `VectorStore` construction with `backend: 'auto'` or default options.

**EXPECTED BEHAVIOR:** Log or emit event when falling back from usearch to brute-force.

**ACTUAL BEHAVIOR:** Silent fallback with no notification.

**IMPACT:** MEDIUM — Performance characteristics change silently; difficult to diagnose in production.

**ROOT CAUSE:** Fallback was implemented for robustness but without observability.

**RECOMMENDED FIX:** Add a `readonly fallbackReason?: string` property or log a warning when falling back:
```typescript
if (chunkCount >= threshold && this.isUsearchAvailable()) {
  return 'usearch';
}
// Log or emit: "Falling back from usearch to brute-force: chunkCount=${chunkCount} < threshold=${threshold}"
return 'brute-force';
```

**REGRESSION RISK:** LOW — Adds logging, no behavior change.

**RELATED FILES:**
- semantic-engine/src/vector/VectorStore.ts
- semantic-engine/src/vector/VectorStoreCache.ts

**RELATED WORKFLOWS:** Vector search, semantic search, embedding retrieval

---

### DEBT-027
**SEVERITY:** LOW  
**CATEGORY:** Technical Debt  
**CONFIDENCE:** CONFIRMED

**TITLE:** VectorIndexer.updateIncremental does not handle symbol-level changes within unchanged files

**LOCATION:**
- File: semantic-engine/src/vector/VectorIndexer.ts
- Symbol: VectorIndexer.updateIncremental
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/vector/VectorIndexer.ts
async updateIncremental(
  projectIndex: ProjectIndex,
  affectedFileIds: ReadonlySet<string>,
  contents: ReadonlyMap<string, string>,
  previous: readonly VectorChunk[] = projectIndex.vectorChunks ?? [],
): Promise<VectorChunk[]> {
  const liveFileIds = new Set(projectIndex.files.map(file => file.id));
  const liveSymbolIds = new Set(projectIndex.symbols.map(symbol => symbol.id));

  const previousLive = previous.filter(chunk =>
    liveFileIds.has(chunk.fileId) &&
    (!chunk.symbolId || liveSymbolIds.has(chunk.symbolId))
  );

  const retained = previousLive.filter(chunk => !affectedFileIds.has(chunk.fileId));
  const affectedFiles = projectIndex.files.filter(file => affectedFileIds.has(file.id));
  const affectedSymbols = projectIndex.symbols.filter(symbol => affectedFileIds.has(symbol.fileId));
  // ...
}
```

**PROBLEM:** `updateIncremental` only refreshes chunks for files in `affectedFileIds`. If a file's symbols change (e.g., function signature updated) but the file itself isn't in `affectedFileIds`, the old symbol chunks remain.

**WHY IT IS A PROBLEM:**
1. **Stale symbol chunks:** Symbol-level changes within "unchanged" files produce outdated embeddings
2. **Incremental indexing gap:** The incremental update is file-level, not symbol-level
3. **Silent staleness:** No warning or error when symbol changes are missed

**TRIGGER / EXECUTION PATH:** Incremental indexing after changes that only affect symbols within files (e.g., refactoring that doesn't change file hash).

**EXPECTED BEHAVIOR:** Either:
- Accept symbol-level `affectedIds` in addition to file-level
- Re-index all symbols in files with any symbol changes
- Document the limitation clearly

**ACTUAL BEHAVIOR:** File-level granularity only; symbol changes within unchanged files are missed.

**IMPACT:** LOW — Affects incremental indexing accuracy; full re-index fixes it.

**ROOT CAUSE:** File-level change detection is simpler but incomplete for symbol-level changes.

**RECOMMENDED FIX:** Extend `affectedFileIds` to `affectedIds: ReadonlySet<string>` supporting both file and symbol IDs, then filter chunks by both.

**REGRESSION RISK:** LOW — Internal API change.

**RELATED FILES:**
- semantic-engine/src/vector/VectorIndexer.ts
- semantic-engine/src/core/types/project-index.types.ts

**RELATED WORKFLOWS:** Incremental indexing, vector search, embedding updates

---

### DEBT-028
**SEVERITY:** LOW  
**CATEGORY:** Technical Debt  
**CONFIDENCE:** CONFIRMED

**TITLE:** SymbolIndex.findByName returns first match, which may be incorrect in projects with duplicate symbol names

**LOCATION:**
- File: semantic-engine/src/graphs/SymbolIndex.ts
- Symbol: SymbolIndex.findByName
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/graphs/SymbolIndex.ts
findByName(name: string): SymbolEntry | undefined {
  for (const sym of this.byId.values()) {
    if (sym.name === name) return sym;
  }
  return undefined;
}
```

**PROBLEM:** `findByName` returns the first symbol with the given name across the entire project. In projects with duplicate symbol names (e.g., multiple `User` classes in different modules), this returns an arbitrary match.

**WHY IT IS A PROBLEM:**
1. **Incorrect resolution:** Type graph edges may point to wrong symbols
2. **Non-deterministic:** Iteration order of Map affects which symbol is returned
3. **Cascading errors:** Wrong symbol resolution propagates to graph traversal and discovery

**TRIGGER / EXECUTION PATH:** Any call to `SymbolIndex.findByName` or `TypeGraphBuilder.resolveSymbol` when multiple symbols share a name.

**EXPECTED BEHAVIOR:** Return all matches or require additional context (file, module) for disambiguation.

**ACTUAL BEHAVIOR:** Returns first match by Map iteration order.

**IMPACT:** LOW — Affects projects with duplicate symbol names; most projects have unique names.

**ROOT CAUSE:** Simple lookup optimized for common case; no disambiguation logic.

**RECOMMENDED FIX:** Add `findByNameInFile` or return `SymbolEntry[]` with all matches, letting callers disambiguate.

**REGRESSION RISK:** MEDIUM — Changes return type; all callers must be updated.

**RELATED FILES:**
- semantic-engine/src/graphs/TypeGraphBuilder.ts
- semantic-engine/src/graphs/SymbolIndex.ts

**RELATED WORKFLOWS:** Type graph construction, symbol resolution, code navigation

---

## POTENTIAL FINDINGS

### POTENTIAL-SEC-029
**SEVERITY:** POTENTIAL  
**CATEGORY:** Security  
**CONFIDENCE:** MEDIUM

**TITLE:** RemoteEmbeddingGenerator may expose API keys in error messages or logs

**LOCATION:**
- File: semantic-engine/src/vector/RemoteEmbeddingGenerator.ts
- Symbol: RemoteEmbeddingGenerator.batchOpenAi, RemoteEmbeddingGenerator.batchOllama
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/vector/RemoteEmbeddingGenerator.ts
private async batchOpenAi(texts: readonly string[]): Promise<EmbeddingResult[]> {
  const url = joinUrl(this.options.baseUrl, '/v1/embeddings');
  const fallback = joinUrl(this.options.baseUrl, '/embeddings');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (this.options.apiKey) headers['Authorization'] = `Bearer ${this.options.apiKey}`;

  const payload = JSON.stringify({ model: this.options.model, input: texts });

  const data = (await this.postJson([url, fallback], headers, payload)) as {
    data?: Array<{ embedding?: number[] }>;
  };
  // ...
}

private async postJson(
  urls: string[],
  headers: Record<string, string>,
  body: string
): Promise<unknown> {
  const timeoutMs = this.options.timeoutMs ?? 30000;
  let lastError: unknown;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} from ${url}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('embedding request failed');
}
```

**PROBLEM:** The `apiKey` is included in the `Authorization` header. If fetch errors include request details (headers, body), the API key could be exposed in error messages or logs.

**WHY IT IS A PROBLEM:**
1. **Error message leakage:** Network errors may include request details
2. **Logging risk:** If errors are logged, API key appears in logs
3. **No redaction:** No mechanism to redact sensitive headers

**MISSING EVIDENCE:**
- Whether fetch implementation includes headers in error messages
- Whether errors are logged by callers
- Whether `postJson` errors propagate to user-visible output

**WHAT WOULD CONFIRM IT:**
- Test that simulates network failure and checks error message contents
- Review of logging configuration in callers
- Review of fetch polyfill/implementation error behavior

---

### POTENTIAL-PERF-030
**SEVERITY:** POTENTIAL  
**CATEGORY:** Performance  
**CONFIDENCE:** MEDIUM

**TITLE:** VectorStore.BruteForceBackend sorts all filtered results even when topK is small

**LOCATION:**
- File: semantic-engine/src/vector/VectorStore.ts
- Symbol: BruteForceBackend.search
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/vector/VectorStore.ts
async search(queryEmbedding: readonly number[], options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
  const topK = options.topK ?? 10;
  const minScore = options.minScore ?? 0;
  const filter = options.filter ?? (() => true);

  const scored: VectorSearchResult[] = [];

  for (const chunk of this.chunks) {
    if (!filter(chunk)) continue;
    const score = this.cosineSimilarity(queryEmbedding, chunk.embedding!);
    if (score >= minScore) {
      scored.push({ chunk, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)  // Full sort
    .slice(0, topK);
}
```

**PROBLEM:** The brute-force backend sorts ALL filtered results before slicing to `topK`. For large chunk sets (thousands) with small `topK` (10), this is O(n log n) instead of O(n + k log k).

**WHY IT IS A PROBLEM:**
1. **Unnecessary work:** Sorting thousands of results to get top 10
2. **Memory pressure:** All results held in memory during sort
3. **Scalability:** Performance degrades linearly with chunk count

**MISSING EVIDENCE:**
- Actual chunk counts in production usage
- Whether `topK` is typically small (10-50) or large
- Performance measurements comparing sort vs. partial selection

**WHAT WOULD CONFIRM IT:**
- Benchmark with 10k+ chunks showing sort dominates
- Production telemetry on typical chunk counts and topK values

---

### POTENTIAL-ARCH-031
**SEVERITY:** POTENTIAL  
**CATEGORY:** Architecture  
**CONFIDENCE:** MEDIUM

**TITLE:** GraphQueryEngine uses dynamic require for SubgraphExplorer to avoid circular dependency

**LOCATION:**
- File: semantic-engine/src/graphs/GraphQueryEngine.ts
- Symbol: GraphQueryEngine.subgraph
- Line(s): approximate

**EVIDENCE:**
```typescript
// semantic-engine/src/graphs/GraphQueryEngine.ts
subgraph(seeds: readonly string[], options: TraversalOptions = {}): SubgraphResult {
  /*
  | require تنبل و درون‌متدی: `SubgraphExplorer` خودش این کلاس را
  | import می‌کند و import ایستای دوطرفه در CommonJS یکی از دو
  | ماژول را نیمه‌ساخته تحویل می‌دهد.
  */
  const { SubgraphExplorer } = require('./SubgraphExplorer') as typeof import('./SubgraphExplorer');
  const explorer = new SubgraphExplorer(this);
  // ...
}
```

**PROBLEM:** `GraphQueryEngine` uses `require()` inside a method to avoid circular dependency with `SubgraphExplorer`. This is a workaround for a structural issue.

**WHY IT IS A PROBLEM:**
1. **Circular dependency:** Indicates tight coupling between GraphQueryEngine and SubgraphExplorer
2. **Dynamic require:** Loses type safety and static analysis benefits
3. **Testing difficulty:** Harder to mock or stub in tests

**MISSING EVIDENCE:**
- Whether the circular dependency could be resolved with interface extraction
- Whether other modules have similar patterns
- Impact on tree-shaking and bundle size

**WHAT WOULD CONFIRM IT:**
- Analysis showing the dependency cycle and whether it can be broken
- Measurement of bundle size impact

---

## UNVERIFIED FINDINGS

### UNVERIFIED-SEC-032
**SEVERITY:** UNVERIFIED  
**CATEGORY:** Security  
**CONFIDENCE:** LOW

**TITLE:** RemoteEmbeddingGenerator API key handling may have injection risks

**LOCATION:**
- File: semantic-engine/src/vector/RemoteEmbeddingGenerator.ts
- Symbol: RemoteEmbeddingGenerator
- Line(s): entire file

**EVIDENCE:**
```typescript
// semantic-engine/src/vector/RemoteEmbeddingGenerator.ts
export class RemoteEmbeddingGenerator implements IEmbeddingGenerator {
  constructor(private readonly options: RemoteEmbeddingOptions) {
    this.modelName = options.model;
  }

  private async batchOpenAi(texts: readonly string[]): Promise<EmbeddingResult[]> {
    const payload = JSON.stringify({ model: this.options.model, input: texts });
    const data = (await this.postJson([url, fallback], headers, payload)) as {
      data?: Array<{ embedding?: number[] }>;
    };
    // ...
  }
}
```

**PROBLEM:** The `model` and `input` fields are sent directly to the remote API. If these contain malicious content, they could exploit vulnerabilities in the remote service.

**MISSING EVIDENCE:**
- Whether `model` or `input` are validated/sanitized before sending
- Whether the remote API has known vulnerabilities
- Whether responses are validated before parsing
- Whether there are SSRF protections on `baseUrl`

**WHAT WOULD CONFIRM IT:**
- Review of remote API security assumptions
- Input validation on `model` and `input` fields
- URL validation on `baseUrl` to prevent SSRF
- Response schema validation

---

## Summary

This audit step identified:
- **2 HIGH severity findings** (SEC-022: authRequired false, ARCH-021: monolithic discover method)
- **3 MEDIUM severity findings** (ARCH-023: God class, PERF-024: sync fs, REL-025: stale graph cache)
- **2 LOW severity findings** (DEBT-026: silent fallback, DEBT-027: incremental indexing gap, DEBT-028: findByName ambiguity)
- **3 POTENTIAL findings** requiring additional evidence
- **1 UNVERIFIED finding** with insufficient evidence

The most critical issues are:
1. **SEC-022**: Hardcoded `authRequired: false` creates security review gaps
2. **ARCH-021**: Monolithic `discover()` method hinders testing and maintenance
3. **REL-025**: Stale graph cache in long-running processes
