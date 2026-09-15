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

## Test gaps / potential (not additional confirmed findings)

- `test/hooks/hooks.test.js:302-376` covers one successful hook only; no `on_failure: stop` dependent-hook test, hook timeout/cancellation test, or multi-project hook-loader test.
- `test/policy/policy.test.js:100-134,240-303` covers valid regexes and auto/prompt/deny manager modes, but no malformed regex validation/evaluation, denied-approval event callback, or cancellation while a pending approval is awaited.
- Event tests cover scope/project isolation and payload precedence (`test/events/events.test.js:61-112`); no new independent event-bus defect was confirmed in this pass.
- Focused policy/hooks test commands both timed out after 15s with no output (`exit 124`), consistent with prior audit limitations; no test pass is claimed.
