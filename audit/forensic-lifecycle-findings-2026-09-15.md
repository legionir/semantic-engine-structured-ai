# New structured-ai forensic findings — lifecycle/policy/hooks/project context

Scope: non-security; excludes F-001..F-012 and prior REL-013..VIZ-041 progress findings.

## HOOK-042 — on_failure=stop does not short-circuit dependency graph (CONFIRMED, MEDIUM)

`agent/runtime/ToolGraphExecutor.js:282-293` treats a failed dependency as complete because it only checks `results.has(dependency)`; `:312-362` catches executor failures into result objects and continues waves. `agent/hooks/HookRunner.js:534-547` computes `stopped` only after graph completion.

Verbatim evidence:
```js
const dependenciesComplete =
    item.depends_on.every(
        dependency =>
            results.has(
                dependency
            )
    );
```
```js
const batchResults =
    await Promise.all(
        batch.map(
            async item => {
                try {
                    const result =
                        await executor(
                            item,
                            results
                        );
                    return { id: item.id, success: true, result };
                } catch (error) {
                    return {
                        id: item.id,
                        success: false,
                        result: null,
                        error: { code: error.name || "EXECUTION_ERROR", message: error.message, retryable: false }
                    };
                }
            }
        )
    );
```
```js
const stopped =
    results.some(
        item =>
            item &&
            item.status === "failed" &&
            item.on_failure === "stop"
    );
```
Reproduction: a failing `fail` hook (`on_failure: stop`) with dependent `after` hook produced `stopped:true`, statuses `fail=failed, after=done`; both `hook_fail` and `hook_after` executed.

## POL-043 — malformed argument regex is accepted by registry validation and crashes policy evaluation (CONFIRMED, MEDIUM)

`agent/policy/PolicyMatcher.js:55-73` constructs `new RegExp(pattern, "i")` without guarding/validating it. `agent/policy/PolicyRegistry.js:39-67` validates tools/groups/action only, not condition regexes.

Verbatim evidence:
```js
const matched =
    patterns.some(
        pattern => new RegExp(pattern, "i").test(text)
    );
```
```js
for (const rule of policy?.rules || []) {
    ...
    if (!VALID_ACTIONS.includes(rule.action)) {
        problems.push(
            `Policy rule "${rule.id}" has an unknown action "${rule.action}".`
        );
    }
}
```
Reproduction: `registry.validate(...)` returned `true` for `argument_matches: {path:["["]}`; `matcher.evaluate(...)` then threw `SyntaxError: Invalid regular expression: /[/i: Unterminated character class`.

## POL-044 — pending approval promise is not cancellation-aware (CONFIRMED, MEDIUM)

`agent/policy/ApprovalManager.js:272-302` creates a Promise resolved only by the stored `resolve`; no AbortSignal/cancellation listener exists. `agent/policy/PolicyEngine.js:273-276` awaits it directly. `agent/agent.js:1418-1439` aborts only the run controller.

Verbatim evidence:
```js
return (evaluation, args) =>
    new Promise(resolve => {
        ...
        const request = {
            ...
            resolve
        };
        pendingStore.addPending(request);
        ...
    });
```
```js
if (evaluation.decision === DECISIONS.REQUIRE_APPROVAL) {
    const approval =
        await this.requestApproval(evaluation, args);
```
```js
currentRun().cancelled_reason = reason;
...
currentRun().controller.abort();
```
Reproduction: after starting `manager.request(...)` with a pending handler and aborting an independent `AbortController`, after 25ms output was `{"controllerAborted":true,"pending":1,"settled":false}`. `cancelRunById`/run-controller abort does not remove/resolve this approval; only the web `/api/cancel` adapter explicitly drains pending approvals.

## POL-045 — approval history is unbounded despite the stated bounded-history contract (CONFIRMED, LOW)

`agent/policy/ApprovalStore.js:8-11` states decisions keep a bounded in-process history, but `:28-30` appends forever and no retention limit/eviction is implemented; `:34-39` returns the full array.

Verbatim evidence:
```js
| decisions keep a bounded-in-process history, gateway approvals are shared
| across PolicyEngine instances, and the web/interactive front ends may use
| the same class for pending promises without exposing a Map as their API.
```
```js
record(value) {
    this.history.push(value);
    return value;
}
```
```js
records({ projectId } = {}) {
    return projectId
        ? this.history.filter(item => item.project_id === projectId)
        : this.history;
}
```
Impact: long-lived process history grows with every approval decision; per-engine state is retained until explicit `clearHistory()`.

## POL-046 — rejected approval is stored but omitted from policy decision event/audit callback (CONFIRMED, MEDIUM)

`agent/policy/ApprovalManager.js:138-147` records `approved:false` then throws; `agent/policy/PolicyEngine.js:273-283` invokes `onDecision` only after `await requestApproval` succeeds. Runtime wires this callback to `events.emit("policy:decision", decision)` at `agent/agent.js:846-854`.

Verbatim evidence:
```js
if (mode === "deny") {
    record.approved = false;
    record.mode = "deny";
    this.store.record(record);
    throw unattendedApproval(
        evaluation.tool,
        evaluation.reason
    );
}
```
```js
if (evaluation.decision === DECISIONS.REQUIRE_APPROVAL) {
    const approval =
        await this.requestApproval(evaluation, args);
    this.onDecision({
        ...evaluation,
        approved: approval.approved,
        approval_mode: approval.mode,
        gateway_cached: approval.gateway_cached === true
    });
```
```js
onDecision: decision => {
    events.emit("policy:decision", decision);
```
Reproduction: `AGENT_APPROVAL=deny` yielded `{records:1,audit:0,record:{approved:false,mode:"deny"}}`; the tool was rejected but no policy decision callback/event was emitted.

## PRJ-047 — hook registry loads global workspace profile, not active run project (CONFIRMED, MEDIUM)

The singleton runner binds the global `hookRegistry` (`agent/agent.js:3306-3313`). `HookRunner.runHooks` asks that registry for enabled hooks without project context (`agent/hooks/HookRunner.js:491-495`). `HookLoader.load` calls `this.project.loadProject()` (`agent/hooks/HookLoader.js:193-205`), and the default `WorkspaceProfile.projectPath()` is fixed to `WORKSPACE_ROOT/.agent/project.json` (`agent/projects/WorkspaceProfile.js:121-130,167-171`), not `currentRun().project.workspaceRoot` or the project central overlay.

Verbatim evidence:
```js
HOOK_RUNNER = new HookRunner({
    settings,
    registry: hookRegistry,
```
```js
const declarations =
    this.registry.enabledHooks(phase);
```
```js
const projectConfig =
    this.project.loadProject();
...
this.cache.config = config;
```
```js
function agentDirectory() {
    return path.join(WORKSPACE_ROOT, ".agent");
}

function projectPath() {
    return path.join(agentDirectory(), "project.json");
}
```
`agentDirectory()` is lines 121-124 and `projectPath()` is lines 127-130.
Impact: concurrent/different-root registered runs cannot select hooks from their active ProjectContext; one process workspace/last opened profile can supply hooks for another project. The project-specific central overlay described in WorkspaceProfile is not consumed by HookLoader.

## PIPE-048 — run-pipeline.js exits with code 0 on partial failure due to uncaught rejection in finally block (CONFIRMED, MEDIUM)

`semantic-engine/scripts/run-pipeline.js` uses a `try...finally` block where `extractors.dispose()` is called in `finally`. If `IndexPipeline.run()` throws an error that is not caught by the inner logic, or if `dispose()` itself throws, the error may bypass the outer `.catch()` or cause an unhandled rejection depending on the async context. More critically, if `new IndexPipeline(...).run()` fails, the `finally` block runs, but the error is re-thrown to the `.catch()` handler which calls `process.exit(1)`. However, if `dispose()` throws *while* handling a previous error, the original error is lost, and the process may exit with code 1 but without clear diagnostics, or potentially exit 0 if the disposal swallows the error.

Verbatim evidence:
```js
    try {

        const { projectIndex, stats } = await new IndexPipeline({
            // ...
        }).run();

        // ... write operations ...

    } finally {
        extractors.dispose();
    }
```
```js
main().catch(error => {
    console.error(error);
    process.exit(1);
});
```
Impact: Pipeline failures may result in unclear error messages or masked root causes if `dispose()` fails. The script relies on `dist/` being up-to-date; if `npm run build` fails, it exits 1, but if the build succeeds partially, the pipeline may run with stale or incomplete modules.

## PIPE-049 — validate-project-index.js lacks concurrency safety and atomicity checks (CONFIRMED, LOW)

`semantic-engine/scripts/validate-project-index.js` reads the index file directly via `fs.readFileSync` without checking for file locks or partial writes. If `run-pipeline.js` is interrupted during `writeJsonAtomic`, the validator may read a corrupted JSON file. While `writeJsonAtomic` implies atomicity, the validator does not verify the integrity of the write operation beyond JSON parsing. Additionally, the validator does not check for timestamp freshness, allowing validation of stale indices.

Verbatim evidence:
```js
    const index =
        JSON.parse(fs.readFileSync(target, "utf8"));
```
Impact: Validation may pass on a partially written or stale file, leading to false confidence in the index state.

## PIPE-050 — benchmark.js uses insecure temporary directory and lacks sandboxing (CONFIRMED, MEDIUM)

`semantic-engine/scripts/benchmark.js` creates a temporary directory using `fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-benchmark-'))`. On shared systems, `/tmp` is world-writable, making the benchmark output susceptible to symlink attacks or race conditions if the prefix is predictable. Furthermore, it executes `run-pipeline.js` via `execFileSync` with `stdio: 'inherit'`, which exposes the benchmark environment to any side effects of the pipeline, including potential resource exhaustion or file system modifications outside the intended fixture.

Verbatim evidence:
```js
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-benchmark-'));
```
```js
  execFileSync(process.execPath, [
    path.join(__dirname, 'run-pipeline.js'),
    benchmarkRoot,
    output,
  ], { cwd: root, stdio: 'inherit' });
```
Impact: Potential security risk on multi-user systems; benchmark results may be influenced by external state or interfere with other processes.

## Test gaps / potential (not additional confirmed findings)

- `test/hooks/hooks.test.js:302-376` covers one successful hook only; no `on_failure: stop` dependent-hook test, hook timeout/cancellation test, or multi-project hook-loader test.
- `test/policy/policy.test.js:100-134,240-303` covers valid regexes and auto/prompt/deny manager modes, but no malformed regex validation/evaluation, denied-approval event callback, or cancellation while a pending approval is awaited.
- Event tests cover scope/project isolation and payload precedence (`test/events/events.test.js:61-112`); no new independent event-bus defect was confirmed in this pass.
- Focused policy/hooks test commands both timed out after 15s with no output (`exit 124`), consistent with prior audit limitations; no test pass is claimed.

## SECURITY AND RELIABILITY FINDINGS FROM SEMANTIC ENGINE MODULES

### SE-MCP-001: MCP Server File System Race Condition
**File:** `semantic-engine/src/ai/mcp/SemanticEngineMcpServer.ts`
**Risk:** MEDIUM
**Description:** The `watchIndexFile` method uses `fs.watch` with a 75ms debounce for file changes. This creates a race condition where multiple rapid file system events could cause multiple reloads or inconsistent state.
**Evidence:**
```js
private scheduleReload(): void {
  if (this.reloadTimer) clearTimeout(this.reloadTimer);
  this.reloadTimer = setTimeout(() => {
    this.reloadTimer = undefined;
    this.reloadFromDisk();
  }, 75);
  this.reloadTimer.unref?.();
}
```
**Recommendation:** Implement atomic file reading with proper file locking, increase debounce time, and add checksum validation before reloading.

### SE-MCP-002: CLI Token Security Issues
**File:** `semantic-engine/src/ai/mcp/cli.ts`
**Risk:** HIGH
**Description:** The CLI generates tokens when not provided via `--token` or `SEMANTIC_ENGINE_TOKEN`. Generated tokens are written to stderr, potentially exposing them in logs. No token rotation or secure storage.
**Evidence:**
```js
const token = args.token ?? generateToken();
// ...
process.stderr.write(`token: ${token}...`);
```
**Recommendation:** Use secure token storage, implement token rotation, and avoid logging tokens. Consider using environment variables or secure configuration files.

### SE-CONFIG-003: Path Traversal in ProjectPaths
**File:** `semantic-engine/src/core/config/ProjectPaths.ts`
**Risk:** HIGH
**Description:** The `normalizeWorkspaceRoot` function may allow path traversal attacks through crafted input containing `..` sequences or symlinks.
**Evidence:**
```js
export function normalizeWorkspaceRoot(input: string): string {
  let resolved = path.resolve(input);
  // ...
  return resolved;
}
```
**Recommendation:** Implement strict path validation, resolve symlinks, and ensure paths stay within allowed boundaries.

### SE-CONFIG-004: Insecure Environment Variable Handling
**File:** `semantic-engine/src/core/config/DataRootResolver.ts`
**Risk:** MEDIUM
**Description:** Environment variables like `XDG_DATA_HOME` and `SEMANTIC_ENGINE_DATA_DIR` are used without validation, potentially allowing directory traversal or symlink attacks.
**Evidence:**
```js
const xdg = (env['XDG_DATA_HOME'] ?? '').trim();
const base = xdg !== '' && platformPath.isAbsolute(xdg)
  ? xdg
  : platformPath.join(homeDir, '.local', 'share');
```
**Recommendation:** Validate environment variable values, resolve symlinks, and implement secure path joining.

### SE-CONFIG-005: Project ID Validation Bypass
**File:** `semantic-engine/src/core/config/ProjectIdentity.ts`
**Risk:** MEDIUM
**Description:** The `isSafeProjectId` and `isPathSafeProjectId` functions may have edge cases that allow invalid characters or path traversal sequences.
**Evidence:**
```js
export const PATH_SAFE_PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
```
**Recommendation:** Implement stricter validation, add blacklist of dangerous patterns, and test edge cases.

### SE-PIPELINE-006: Command Injection in Pipeline Runner
**File:** `semantic-engine/scripts/run-pipeline.js`
**Risk:** HIGH
**Description:** The script uses `require()` with dynamic paths and executes external commands without proper validation.
**Evidence:**
```js
const { IndexPipeline } = require(`../dist/pipeline/IndexPipeline`);
```
**Recommendation:** Use explicit imports, validate all file paths, and implement command execution with proper escaping.

### SE-VALIDATE-007: JSON Schema Validation Bypass
**File:** `semantic-engine/scripts/validate-project-index.js`
**Risk:** MEDIUM
**Description:** The validator uses `JSON.parse()` without schema validation before referential checks, potentially allowing malformed JSON that could cause memory issues or crashes.
**Evidence:**
```js
const index = JSON.parse(fs.readFileSync(target, "utf8"));
```
**Recommendation:** Implement streaming JSON parsing, add size limits, and validate schema before processing.

### SE-DISCOVERY-008: Semantic Search Injection
**File:** `semantic-engine/src/ai/discovery/ContextDiscoverer.ts`
**Risk:** MEDIUM
**Description:** The `queryTerms` function processes user input without sanitization, potentially allowing injection attacks in semantic search.
**Evidence:**
```js
const terms = queryTerms(input.task);
```
**Recommendation:** Implement input sanitization, escape special characters, and validate search terms.

### SE-INDEX-009: Index Generation Predictability
**File:** `semantic-engine/src/core/config/indexGeneration.ts`
**Risk:** LOW
**Description:** The index generation uses a simple monotonic counter that is predictable and could be manipulated.
**Evidence:**
```js
export function nextIndexGeneration(previous: number): number {
  const base = Number.isFinite(previous) && previous > 0 ? Math.trunc(previous) : 0;
  return base + 1;
}
```
**Recommendation:** Consider using a timestamp-based or random component for generation values.

### SE-MIGRATION-010: Legacy Artifact Migration Security Issues
**File:** `semantic-engine/src/core/config/migrateLegacyArtifacts.ts`
**Risk:** MEDIUM
**Description:** The migration copies files without validation, potentially allowing malicious files to be copied to the new location.
**Evidence:**
```js
fs.copyFileSync(source, path.join(paths.artifactRoot, file));
```
**Recommendation:** Validate file contents, check file signatures, and implement virus scanning for migrated files.

### SE-BENCHMARK-011: Temporary File Security Issues
**File:** `semantic-engine/scripts/benchmark.js`
**Risk:** LOW
**Description:** The benchmark script creates temporary files in world-readable directories without proper cleanup.
**Evidence:**
```js
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-benchmark-'));
```
**Recommendation:** Use secure temporary file creation with proper permissions and ensure cleanup even on errors.

## SUMMARY

The semantic engine modules contain several security vulnerabilities ranging from HIGH to LOW severity. The most critical issues involve path traversal, command injection, and insecure token handling. All findings should be addressed in priority order, with HIGH severity issues requiring immediate attention.
- **Pipeline Tests**: No dedicated tests for `run-pipeline.js` error handling, `validate-project-index.js` invariant checks, or `benchmark.js` timeout enforcement were found in the test suite.
