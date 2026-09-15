# Structured AI forensic audit — `structured-ai/`

## Scope and snapshot

- Repository: `legionir/semantic-engine-structured-ai`
- Ref: `main`
- Snapshot commit: `3a20f3192e43c5cf2723cd524e08e013f941a4ed`
- Scope: only `structured-ai/`; security audit intentionally excluded.
- Method: complete subtree tree inventory; direct source/config/test/build reads where available; README/docs were not used as finding evidence.

## Inventory and coverage

- Complete subtree inventory: **357 blob files**, **70 directories** (tree API reported `truncated=false`).
- Directly reviewed: **47 files**.
- Not directly reviewed: **310 files** (249 fetched locally but not read; 61 tree-only because content fetch was incomplete).
- The complete path inventory used for this classification is `audit/structured-ai-tree.txt`.

### Reviewed files

- `agent/agent.js`
- `agent/config/SettingsSchema.js`
- `agent/mcp/ProjectSemanticResolver.js`
- `agent/mcp/SemanticClient.js`
- `agent/mcp/SemanticClientPool.js`
- `agent/persistence/AtomicFile.js`
- `agent/persistence/EventStoreRepository.js`
- `agent/persistence/JournalRepository.js`
- `agent/persistence/JsonRepository.js`
- `agent/persistence/SessionRepository.js`
- `agent/projects/ProjectContext.js`
- `agent/projects/ProjectRegistry.js`
- `agent/projects/ProjectResolver.js`
- `agent/projects/ProjectStore.js`
- `agent/projects/WorkspaceProfile.js`
- `agent/runtime/ActionProcessor.js`
- `agent/runtime/AgentRun.js`
- `agent/runtime/AgentRunContext.js`
- `agent/runtime/DelegationRunner.js`
- `agent/runtime/ReportVerifier.js`
- `agent/runtime/RetryController.js`
- `agent/runtime/RunBudget.js`
- `agent/runtime/RunCancellation.js`
- `agent/runtime/RunManager.js`
- `agent/runtime/RunScheduler.js`
- `agent/runtime/RunState.js`
- `agent/runtime/ToolGraphExecutor.js`
- `agent/runtime/engine.js`
- `agent/tools/ToolContext.js`
- `agent/tools/ToolRuntime.js`
- `agent/tools/code/SemanticTools.js`
- `agent/tools/filesystem/WriteTools.js`
- `agent/tools/mcp/McpTools.js`
- `agent/tools/network/NetworkTools.js`
- `agent/tools/process/BackgroundSession.js`
- `agent/tools/process/ForegroundCommand.js`
- `agent/tools/process/ProcessManager.js`
- `ci/github-actions-test.yml`
- `package.json`
- `test/projects/project-run.test.js`
- `test/runs/concurrency.test.js`
- `web/server.js`
- `web/server/ServerImplementation.js`
- `web/server/WebServer.js`
- `web/server/controllers/RunController.js`
- `web/server/controllers/TaskController.js`
- `web/server/services/TaskService.js`

### Not reviewed files

Reason key: **F** = content was fetched into the local mirror but not directly read in this audit; **T** = tree entry was available but file content was not fetched/read (predominantly web UI/server support files after fetch-token expiry).
- `.dockerignore` — F
- `.gitignore` — F
- `Dockerfile` — F
- `HANDOFF-STRUCTURED-AI.md` — F
- `README.md` — F
- `agent/actions/ActionErrors.js` — F
- `agent/actions/ActionNormalizer.js` — F
- `agent/actions/ActionParser.js` — F
- `agent/actions/ActionValidator.js` — F
- `agent/actions/NativeToolCallAdapter.js` — F
- `agent/actions/ResponseRepair.js` — F
- `agent/actions/context.js` — F
- `agent/actions/index.js` — F
- `agent/application/index.js` — F
- `agent/application/lifecycle.js` — F
- `agent/application/run-agent.js` — F
- `agent/application/run-session.js` — F
- `agent/cli/ArgParser.js` — F
- `agent/cli/Cli.js` — F
- `agent/cli/CommandRegistry.js` — F
- `agent/cli/HelpCommand.js` — F
- `agent/cli/InteractiveCommand.js` — F
- `agent/cli/OutputFormatter.js` — F
- `agent/cli/RunCommand.js` — F
- `agent/cli/ServeCommand.js` — F
- `agent/cli/index.js` — F
- `agent/config/ConsoleAuth.js` — F
- `agent/config/SecretMasker.js` — F
- `agent/config/SettingsResolver.js` — F
- `agent/config/SettingsStore.js` — F
- `agent/config/execution_rules.txt` — F
- `agent/config/index.js` — F
- `agent/config/system_prompt.txt` — F
- `agent/context/ArchiveCoordinator.js` — F
- `agent/context/ContextCompactor.js` — F
- `agent/context/ContextManager.js` — F
- `agent/context/ConversationSizer.js` — F
- `agent/context/ExchangeDetector.js` — F
- `agent/context/Memory.js` — F
- `agent/context/MemoryCoordinator.js` — F
- `agent/context/WorkspaceBoundary.js` — F
- `agent/context/contextHost.js` — F
- `agent/context/index.js` — F
- `agent/discussion/DiscussionContext.js` — F
- `agent/discussion/DiscussionService.js` — F
- `agent/discussion/TranscriptRepository.js` — F
- `agent/discussion/engine.js` — F
- `agent/discussion/index.js` — F
- `agent/discussion/loopDetector.js` — F
- `agent/discussion/observerRunner.js` — F
- `agent/discussion/personaRunner.js` — F
- `agent/discussion/personas.js` — F
- `agent/discussion/transcript.js` — F
- `agent/discussion/types.js` — F
- `agent/events/EventBus.js` — F
- `agent/events/EventContext.js` — F
- `agent/events/EventProjector.js` — F
- `agent/events/EventRedactor.js` — F
- `agent/events/EventTypes.js` — F
- `agent/events/EventValidator.js` — F
- `agent/events/index.js` — F
- `agent/hooks/HookCondition.js` — F
- `agent/hooks/HookLoader.js` — F
- `agent/hooks/HookRegistry.js` — F
- `agent/hooks/HookRenderer.js` — F
- `agent/hooks/HookResult.js` — F
- `agent/hooks/HookRunner.js` — F
- `agent/hooks/index.js` — F
- `agent/interactive/ApprovalPrompt.js` — F
- `agent/interactive/InputReader.js` — F
- `agent/interactive/OutputRenderer.js` — F
- `agent/interactive/Repl.js` — F
- `agent/interactive/ReplCommands.js` — F
- `agent/interactive/index.js` — F
- `agent/mcp/McpCatalogue.js` — F
- `agent/mcp/McpConfig.js` — F
- `agent/mcp/McpConfigLoader.js` — F
- `agent/mcp/McpConfigValidator.js` — F
- `agent/mcp/McpConnection.js` — F
- `agent/mcp/McpManager.js` — F
- `agent/mcp/McpTrustPolicy.js` — F
- `agent/mcp/enginePaths.js` — F
- `agent/mcp/index.js` — F
- `agent/mcp/protocol/ContentLengthCodec.js` — F
- `agent/mcp/protocol/JsonRpcCodec.js` — F
- `agent/mcp/protocol/McpErrors.js` — F
- `agent/mcp/protocol/NdjsonCodec.js` — F
- `agent/mcp/protocol/index.js` — F
- `agent/mcp/semantic.js` — F
- `agent/mcp/transports/HttpTransport.js` — F
- `agent/mcp/transports/SseTransport.js` — F
- `agent/mcp/transports/StdioTransport.js` — F
- `agent/mcp/transports/WebSocketTransport.js` — F
- `agent/persistence/ArchiveRepository.js` — F
- `agent/persistence/DataRoot.js` — F
- `agent/persistence/MemoryRepository.js` — F
- `agent/persistence/SafeIdentifier.js` — F
- `agent/persistence/SchemaVersion.js` — F
- `agent/persistence/index.js` — F
- `agent/policy/ApprovalManager.js` — F
- `agent/policy/ApprovalStore.js` — F
- `agent/policy/PolicyEngine.js` — F
- `agent/policy/PolicyErrors.js` — F
- `agent/policy/PolicyMatcher.js` — F
- `agent/policy/PolicyRegistry.js` — F
- `agent/policy/index.js` — F
- `agent/projects/ProjectMigration.js` — F
- `agent/projects/index.js` — F
- `agent/prompt/MainPromptBuilder.js` — F
- `agent/prompt/ProjectContextBuilder.js` — F
- `agent/prompt/PromptBuilder.js` — F
- `agent/prompt/PromptMessages.js` — F
- `agent/prompt/RequestBuilder.js` — F
- `agent/prompt/RuntimeContextBuilder.js` — F
- `agent/prompt/SkillResolver.js` — F
- `agent/prompt/SubAgentPromptBuilder.js` — F
- `agent/prompt/ToolResolver.js` — F
- `agent/prompt/index.js` — F
- `agent/registry/AgentRegistry.js` — F
- `agent/registry/RegistryLoader.js` — F
- `agent/registry/RegistryValidator.js` — F
- `agent/registry/SkillRegistry.js` — F
- `agent/registry/ToolRegistry.js` — F
- `agent/registry/agents.json` — F
- `agent/registry/hooks.json` — F
- `agent/registry/mcp_servers.json` — F
- `agent/registry/personas.json` — F
- `agent/registry/policy.json` — F
- `agent/registry/skills.json` — F
- `agent/registry/tool-schemas/code.json` — F
- `agent/registry/tool-schemas/discussion.json` — F
- `agent/registry/tool-schemas/filesystem.json` — F
- `agent/registry/tool-schemas/git.json` — F
- `agent/registry/tool-schemas/introspection.json` — F
- `agent/registry/tool-schemas/knowledge.json` — F
- `agent/registry/tool-schemas/mcp.json` — F
- `agent/registry/tool-schemas/memory.json` — F
- `agent/registry/tool-schemas/network.json` — F
- `agent/registry/tool-schemas/planning.json` — F
- `agent/registry/tool-schemas/process.json` — F
- `agent/registry/tool-schemas/search.json` — F
- `agent/registry/tool_groups.json` — F
- `agent/registry/tools.json` — F
- `agent/runtime/IterationRunner.js` — F
- `agent/runtime/Observability.js` — F
- `agent/runtime/ProjectOverride.js` — F
- `agent/runtime/Telemetry.js` — F
- `agent/runtime/engineContext.js` — F
- `agent/runtime/index.js` — F
- `agent/runtime/runtime_context.json` — F
- `agent/schema/response_format.json` — F
- `agent/schema/response_format.strict.json` — F
- `agent/skills/ui_ux_pro_max/resources/contrast.md` — F
- `agent/skills/ui_ux_pro_max/resources/spacing.md` — F
- `agent/skills/ui_ux_pro_max/skill.json` — F
- `agent/tools/ToolRegistryAdapter.js` — F
- `agent/tools/code/IndexSessions.js` — F
- `agent/tools/code/LiveLspTools.js` — F
- `agent/tools/code/SemanticClient.js` — F
- `agent/tools/code/index.js` — F
- `agent/tools/discussion/DiscussionTools.js` — F
- `agent/tools/discussion/index.js` — F
- `agent/tools/filesystem/DirectoryTools.js` — F
- `agent/tools/filesystem/FileMetadataTools.js` — F
- `agent/tools/filesystem/PathBoundary.js` — F
- `agent/tools/filesystem/ReadTools.js` — F
- `agent/tools/filesystem/index.js` — F
- `agent/tools/git/GitTools.js` — F
- `agent/tools/git/index.js` — F
- `agent/tools/index.js` — F
- `agent/tools/mcp/index.js` — F
- `agent/tools/memory/ArchiveTools.js` — F
- `agent/tools/memory/MemoryTools.js` — F
- `agent/tools/memory/index.js` — F
- `agent/tools/network/index.js` — F
- `agent/tools/planning/PlanModel.js` — F
- `agent/tools/planning/PlanRepository.js` — F
- `agent/tools/planning/PlanTools.js` — F
- `agent/tools/planning/index.js` — F
- `agent/tools/process/index.js` — F
- `agent/tools/search/SearchTools.js` — F
- `agent/tools/search/index.js` — F
- `agent/tools/skills/SkillTools.js` — F
- `agent/tools/skills/index.js` — F
- `bin/agent.js` — F
- `bin/backfill-eventstore.js` — F
- `bin/interactive.js` — F
- `ci/github-actions-semantic-engine.yml` — F
- `docker-compose.yml` — F
- `package-lock.json` — F
- `test/README.md` — F
- `test/actions/parser.test.js` — F
- `test/application/application.test.js` — F
- `test/cli/modules.test.js` — F
- `test/context/archive.test.js` — F
- `test/context/context.test.js` — F
- `test/contracts/actions.contract.test.js` — F
- `test/contracts/api.contract.test.js` — F
- `test/contracts/discussion.contract.test.js` — F
- `test/contracts/events.contract.test.js` — F
- `test/contracts/persistence.contract.test.js` — F
- `test/contracts/prompt.contract.test.js` — F
- `test/contracts/rollout.contract.test.js` — F
- `test/contracts/tool.contract.test.js` — F
- `test/discussion/discussion.test.js` — F
- `test/discussion/project-discussion.test.js` — F
- `test/e2e/cli.test.js` — F
- `test/e2e/e2e.test.js` — F
- `test/e2e/interactive.test.js` — F
- `test/events/events.test.js` — F
- `test/fixtures/CONTRACTS.md` — F
- `test/fixtures/actions.json` — F
- `test/fixtures/api-surface.json` — F
- `test/fixtures/baseline.md` — F
- `test/fixtures/events.json` — F
- `test/fixtures/prompt.fixture.json` — F
- `test/helpers/normalize.js` — F
- `test/helpers/normalize.test.js` — F
- `test/helpers/stubSemanticGateway.js` — F
- `test/hooks/hooks.test.js` — F
- `test/hooks/legacy.test.js` — F
- `test/mcp/engine-paths.test.js` — F
- `test/mcp/gateway.integration.test.js` — F
- `test/mcp/layer.test.js` — F
- `test/mcp/mcp.test.js` — F
- `test/mcp/semantic-pool.test.js` — F
- `test/mcp/semantic.test.js` — F
- `test/mvp/mvp.test.js` — F
- `test/persistence/eventstore.test.js` — F
- `test/persistence/journal.test.js` — F
- `test/persistence/project-stores.test.js` — F
- `test/persistence/repositories.test.js` — F
- `test/policy/policy.test.js` — F
- `test/projects/project-api.test.js` — F
- `test/projects/projects.test.js` — F
- `test/prompt/builder.test.js` — F
- `test/runs/delegation-projects.test.js` — F
- `test/runs/run-context.test.js` — F
- `test/runtime/engine.test.js` — F
- `test/runtime/runtime.test.js` — F
- `test/tools/project-tools.test.js` — F
- `test/tools/tool-runtime.test.js` — F
- `test/tools/tools.test.js` — F
- `test/ui/modules.test.js` — F
- `test/ui/ui.test.js` — F
- `test/ui/visualizer.test.js` — F
- `test/web/routes.test.js` — F
- `test/web/web.test.js` — F
- `web/public/app.css` — F
- `web/public/app/api.js` — T
- `web/public/app/approval-state.js` — T
- `web/public/app/chat.js` — T
- `web/public/app/console.js` — T
- `web/public/app/direction.js` — T
- `web/public/app/dom.js` — T
- `web/public/app/event-stream.js` — T
- `web/public/app/event-view.js` — T
- `web/public/app/execution-view.js` — T
- `web/public/app/formatters.js` — T
- `web/public/app/history-view.js` — T
- `web/public/app/main.js` — T
- `web/public/app/markdown.js` — T
- `web/public/app/mcp-view.js` — T
- `web/public/app/modal-manager.js` — T
- `web/public/app/plan-view.js` — T
- `web/public/app/project-state.js` — T
- `web/public/app/project-view.js` — T
- `web/public/app/runtime-state.js` — T
- `web/public/app/settings-view.js` — T
- `web/public/app/store.js` — T
- `web/public/app/task-runner.js` — T
- `web/public/index.html` — T
- `web/public/modal.js` — T
- `web/public/visualizer.css` — T
- `web/public/visualizer.html` — T
- `web/public/visualizer/api-client.js` — T
- `web/public/visualizer/graph-model.js` — T
- `web/public/visualizer/graph-renderer.js` — T
- `web/public/visualizer/graph-store.js` — T
- `web/public/visualizer/layout-client.js` — T
- `web/public/visualizer/main.js` — T
- `web/public/visualizer/node-details.js` — T
- `web/public/visualizer/renderer.js` — T
- `web/public/visualizer/selection-state.js` — T
- `web/public/visualizer/visualizer-events.js` — T
- `web/public/workers/layout.worker.js` — T
- `web/server/Middleware.js` — T
- `web/server/RequestBody.js` — T
- `web/server/Response.js` — T
- `web/server/RouteInventory.js` — T
- `web/server/Router.js` — T
- `web/server/SseHub.js` — T
- `web/server/controllers/ApprovalController.js` — T
- `web/server/controllers/ArchiveController.js` — T
- `web/server/controllers/BaseController.js` — T
- `web/server/controllers/DiscussionController.js` — T
- `web/server/controllers/McpController.js` — T
- `web/server/controllers/PlanController.js` — T
- `web/server/controllers/ProjectController.js` — T
- `web/server/controllers/SessionController.js` — T
- `web/server/controllers/SettingsController.js` — T
- `web/server/controllers/StateController.js` — T
- `web/server/controllers/index.js` — T
- `web/server/serializers/ProjectSerializer.js` — T
- `web/server/serializers/StateSerializer.js` — T
- `web/server/serializers/index.js` — T
- `web/server/services/EventStreamService.js` — T
- `web/server/services/SessionService.js` — T
- `web/server/services/SettingsService.js` — T
- `web/server/services/index.js` — T

## Runtime/lifecycle trace (code comparison, not a finding by itself)

- `agent/agent.js:3500-3557` resolves a project, creates an `AgentRunContext`, and enters `runScheduler.schedule(...)` before `runManager.execute(...)`; `RunManager` tracks the context only when `execute` starts.
- `RunScheduler.js` implements per-project queues, round-robin dispatch, worker/project limits, memory admission, and cancellation of queued promises.
- `ServerImplementation.js` is the compatibility/domain implementation used by canonical `WebServer.js`; the API project-task route performs a global `busy()` check, calls advisory scheduler admission, and launches `startTask` asynchronously.
- Project flow: `ProjectRegistry` persists records; `ProjectResolver` maps `projectId`/explicit project/default to `ProjectContext`; `ToolContext`/`ToolRuntime` carries run/project identity into tools; semantic code paths use the per-project Semantic client pool/resolver.
- Persistence flow: event/journal/JSON repositories and sessions write under project data roots; sessions use `JsonRepository` for the index but direct `fs.writeFileSync` for the session document.
- Tool/action flow: `ActionProcessor` routes final/tool/delegation actions; `ToolGraphExecutor` executes dependency-aware calls; `ToolRuntime` records telemetry and caps returned results; process tools have separate foreground and background buffering paths.

## Findings — CONFIRMED

### F-001 — Web API global busy gate defeats intended multi-project scheduler concurrency
- **Classification:** CONFIRMED
- **Severity:** HIGH
- **Confidence:** HIGH
- **Impact/why:** The scheduler promises distinct projects in parallel, but the web API rejects any task while the single process-wide web state is running. The project route therefore returns 409 instead of admitting a second project; direct/CLI runtime calls still enter the scheduler, so this finding is specifically about the web/API lifecycle path.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/agent/runtime/RunScheduler.js:11-17`
    ```text
    |   - distinct projects run in parallel up to MAX_CONCURRENT_PROJECT_RUNS
    |   - one project is capped at MAX_RUNS_PER_PROJECT (default 1 = serialize)
    |   - total inflight runs cap at MAX_WORKERS_PER_USER
    |   - overflow goes on a per-project queue (round-robin dispatch)
    |   - a full queue rejects immediately (RUN_QUEUE_FULL) instead of hanging
    ```
  - `structured-ai/web/server/ServerImplementation.js:2385-2394`
    ```text
                        if (busy()) {

                            sendJson(res, 409, {
                                error:
                                    state.status === "running"
                                        ? "a task is already running"
                                        : "a discussion is already running"
                            });
                            return;
                        }
    ```
  - `structured-ai/web/server/ServerImplementation.js:901-907`
    ```text
        if (state.status === "running") {

            throw Object.assign(
                new Error("a task is already running"),
                { status: 409 }
            );
        }
    ```
  - `structured-ai/agent/agent.js:3519-3523` (contrast: direct runtime path does schedule)
    ```text
    return await runScheduler.schedule(projectId, () =>
        runManager.execute(context, async () => {

        try {
            return await runAgentCore(options);
    ```

### F-002 — AUTO_CONTINUE drops project scope
- **Classification:** CONFIRMED
- **Severity:** HIGH
- **Confidence:** HIGH
- **Impact/why:** A project-scoped web task starts with `{ projectId }`, but the automatic continuation calls `startTask` without options. The next cycle therefore calls `runtime.runAgent` without `projectId`, losing project attribution/context.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/web/server/ServerImplementation.js:911-912`
    ```text
        state.projectId = runOptions.projectId || null;
    ```
  - `structured-ai/web/server/ServerImplementation.js:952-955`
    ```text
                    ...(runOptions.projectId
                        ? { projectId: runOptions.projectId }
                        : {})
                });
    ```
  - `structured-ai/web/server/ServerImplementation.js:1108-1113`
    ```text
                setTimeout(
                    () =>
                        startTask(
                            "Continue the plan: read it, take the next open step, verify it, and record the result."
                        ).catch(() => {}),
                    50
                );
    ```
  - `structured-ai/web/server/ServerImplementation.js:2414-2419` (initial project-scoped request)
    ```text
                        startTask(task, { projectId: record.id }).catch(() => {});

                        sendJson(res, 202, {
                            accepted: true,
                            project_id: record.id,
                            queued: admission === "queue"
    ```

### F-003 — Cancelling a queued run leaves an untracked run context
- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact/why:** `runAgentModular` allocates and issues a context before scheduling. A queued job is rejected by `cancelQueued`; `RunManager.execute` is never entered, so the context never reaches active/finished bookkeeping and its issued ID is not retired.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/agent/agent.js:3507-3512`
    ```text
    const context =
        runManager.createRun({
            task: options.task || "",
            parentRunId: options.parent_run_id || null,
            project: projectContext
        });
    ```
  - `structured-ai/agent/agent.js:3519-3521`
    ```text
    return await runScheduler.schedule(projectId, () =>
        runManager.execute(context, async () => {
    ```
  - `structured-ai/agent/runtime/RunScheduler.js:284-306`
    ```text
    cancelQueued(projectId, reason) {

        const key = this.keyOf(projectId);

        if (!key || !this.queues.has(key)) {
            return 0;
        }

        const pending = this.queueOf(key).splice(0);

        for (const job of pending) {

            const error = new Error(
                reason || `queued run for project ${projectId} was cancelled`
            );

            error.code = "RUN_CANCELLED";
            error.status = 409;
            error.project_id = projectId;
            job.reject(error);
        }

        return pending.length;
    }
    ```
  - `structured-ai/agent/runtime/RunManager.js:136-143` (tracking begins only inside `execute`)
    ```text
    async execute(context, fn) {

        this.active.set(context.runId, context);

        context.status = "running";
    ```
  - `structured-ai/web/server/ServerImplementation.js:2346-2350` (real cancellation call site)
    ```text
                        const dropped =
                            runtime.runScheduler &&
                            typeof runtime.runScheduler.cancelQueued === "function"
                                ? runtime.runScheduler.cancelQueued(projectId, "web console")
                                : 0;
    ```

### F-004 — Foreground terminal stdout is buffered without the configured cap
- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact/why:** `capture` enforces the total output limit for stderr, but stdout appends every chunk directly. Truncation occurs only after process close, so large stdout can grow memory unbounded during execution.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/agent/tools/process/ForegroundCommand.js:102-123`
    ```text
        let stdout = "";
        let stderr = "";
        let capturedChars = 0;
        let outputTruncated = false;
        const outputLimit = settings.get("MAX_TOOL_RESULT_TOTAL_CHARS");

        const capture = (current, chunk) => {
            if (capturedChars >= outputLimit) {
                outputTruncated = true;
                return current;
            }

            const text = chunk.toString();
            const remaining = outputLimit - capturedChars;
            const kept = text.slice(0, remaining);
            capturedChars += kept.length;
            if (kept.length < text.length) {
                outputTruncated = true;
            }
            return current + kept;
        };
    ```
  - `structured-ai/agent/tools/process/ForegroundCommand.js:136-148`
    ```text
        child.stdout.on(
            "data",
            chunk => {
                stdout += chunk.toString();
            }
        );

        child.stderr.on(
            "data",
            chunk => {
                stderr = capture(stderr, chunk);
            }
        );
    ```
  - `structured-ai/agent/tools/process/ForegroundCommand.js:214-220`
    ```text
                    stdout:
                        truncateText(stdout).text,

                    stderr:
                        truncateText(stderr).text,

                    output_truncated: outputTruncated,
    ```

### F-005 — Session document save is non-atomic despite the repository atomic-write contract
- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact/why:** The module documents atomic JSON writes and uses `JsonRepository` for the index, but `saveSession` writes the session document with direct `fs.writeFileSync`. A crash during serialization can leave a torn session file.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/agent/persistence/SessionRepository.js:20-22`
    ```text
    | Paths and file shape remain stable;
    | JSON writes are atomic.
    ```
  - `structured-ai/agent/persistence/SessionRepository.js:229-248`
    ```text
    function saveSession(session, root) {

        if (settings.get("SESSIONS_ENABLED") !== true) {
            return session;
        }

        fs.mkdirSync(sessionsDirectory(root), { recursive: true });

        session.updated_at = new Date().toISOString();

        session.title =
            session.title || titleFrom(session);

        trim(session);

        fs.writeFileSync(
            sessionPath(session.id, root),
            `${JSON.stringify(session, null, 2)}\n`,
            "utf8"
        );
    ```
  - `structured-ai/agent/persistence/SessionRepository.js:250-257`
    ```text
        const index = loadIndex(root);

        const summary = summarise(session);

        const existing =
            index.sessions.findIndex(
                item => item.id === session.id
            );
    ```
  - `structured-ai/agent/persistence/SessionRepository.js:295-297`
    ```text
    index.sessions = index.sessions.slice(0, limit);

    saveIndex(index, root);

    return session;
    ```
  - `structured-ai/agent/persistence/JsonRepository.js:36-44` (atomic helper that saveSession bypasses)
    ```text
function writeJson(file, value) {

    AtomicFile.writeFile(
        file,
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8"
    );

    return value;
}
    ```

### F-006 — CI omits project/concurrency/persistence/semantic suites
- **Classification:** CONFIRMED
- **Severity:** LOW
- **Confidence:** HIGH
- **Impact/why:** The checked-in CI workflow runs only syntax, tools, runtime, e2e, CLI, interactive, and web scripts. `package.json` defines separate project/run/persistence/semantic suites, but CI does not invoke them; regressions in these audit-critical areas can pass CI.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/ci/github-actions-test.yml:24-44`
    ```text
      - name: Syntax check
        run: npm run check

      - name: Tool and boundary tests
        run: npm run test:tools

      - name: Runtime unit tests
        run: npm run test:runtime

      - name: End to end tests
        run: npm run test:e2e

      - name: CLI tests
        run: npm run test:cli

      - name: Interactive session tests
        run: npm run test:interactive

      - name: Web console tests
        run: npm run test:web
    ```
  - `structured-ai/package.json:14-20`
    ```text
    "test:projects": "node test/projects/projects.test.js && node test/projects/project-api.test.js && node test/projects/project-run.test.js",
    "test:runs": "node test/runs/run-context.test.js && node test/runs/concurrency.test.js && node test/runs/delegation-projects.test.js && node test/projects/project-run.test.js",
    "check": "node --check agent/agent.js",
    "test:tools": "node test/tools/tools.test.js && node test/tools/project-tools.test.js && node test/tools/tool-runtime.test.js",
    "test:runtime": "node test/runtime/runtime.test.js && node test/runtime/engine.test.js",
    "test:semantic": "node test/mcp/semantic.test.js && node test/mcp/semantic-pool.test.js && node test/mcp/engine-paths.test.js && node test/mcp/gateway.integration.test.js",
    "test:mcp": "node test/mcp/mcp.test.js && node test/mcp/layer.test.js",
    ```

## Findings — POTENTIAL / UNVERIFIED

### F-007 — Project registry read-modify-write can lose concurrent updates
- **Classification:** POTENTIAL/UNVERIFIED
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Why not confirmed:** `ProjectRegistry.register/update/remove` each load, mutate, and save independently; `ProjectStore.save` uses one process-wide temp pathname. This is a concurrency hazard, but no focused concurrent writer test was completed, so impact/race manifestation remains unverified.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/agent/projects/ProjectRegistry.js:130-140`
    ```text
    register(config = {}) {

        const canonicalRoot = canonicalizeRoot(config.rootPath);

        const data = this._load();

        for (const existing of Object.values(data.projects)) {
            if (existing.rootPath === canonicalRoot) {
                return cloneProject(existing);
            }
        }
    ```
  - `structured-ai/agent/projects/ProjectRegistry.js:271-278`
    ```text
        const data = this._load();

        const record = data.projects[projectId];

        if (!record) {

            throw new Error(
                `Unknown project: ${projectId}`
            );
        }
    ```
  - `structured-ai/agent/projects/ProjectRegistry.js:314-320`
    ```text
        record.updated_at = new Date().toISOString();

        this._save(data);

        return cloneProject(record);

    }
    ```
  - `structured-ai/agent/projects/ProjectStore.js:137-158`
    ```text
function save(registry, registryPath = resolveRegistryPath()) {

    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    const tempPath = `${registryPath}.tmp-${process.pid}`;

    fs.writeFileSync(

        tempPath,

        JSON.stringify(
            {
                version: registry.version || STORE_VERSION,
                projects: registry.projects
            },
            null,
            2
        ) + "\\n"

    );

    fs.renameSync(tempPath, registryPath);

}
    ```
### F-008 — Explicit project object can bypass the documented registry/workspace validation
- **Classification:** POTENTIAL/UNVERIFIED
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Why not confirmed:** `ProjectResolver` documentation says explicit projects are validated against the registry, yet an object with string `id` and `rootPath` is immediately converted into a context; `assertWorkspaceMatch` is exported but not called from `resolveProjectForRun`. The public caller contract may intentionally accept trusted registry records, so this remains potential rather than confirmed.
- **Evidence (verbatim, line numbers):**
  - `structured-ai/agent/projects/ProjectResolver.js:18-20`
    ```text
    | Every run resolves a ProjectContext. An unscoped caller receives the
    | synthetic default project, while explicit project options are validated
    | against the registry before execution.
    ```
  - `structured-ai/agent/projects/ProjectResolver.js:44-52`
    ```text
function resolveProjectForRun(options = {}, { registry, workspaceRoot } = {}) {

    const activeRegistry =
        registry || new ProjectRegistry();

    if (looksLikeProjectRecord(options.project)) {

        return createProjectContext(options.project);
    }
    ```
  - `structured-ai/agent/projects/ProjectResolver.js:93-108`
    ```text
function assertWorkspaceMatch(context, workspaceRoot) {

    const canonicalWorkspace = canonicalizeRoot(workspaceRoot);

    if (context.workspaceRoot !== canonicalWorkspace) {

        throw new Error(
            `Project "${context.projectId}" is rooted at ${context.workspaceRoot}, ` +
            `but this process is bound to workspace ${canonicalWorkspace}. ` +
            `Running tools across two roots lands with the project-aware tool runtime ` +
            `(Phase 4); start the agent on the project root or select a matching project.`
        );

    }

}
    ```

## Test/build execution note

- No test result is claimed. A focused attempt to run `node test/runs/concurrency.test.js` under a 20–30 second timeout produced no output and timed out (exit 124); the combined focused command also timed out. Therefore findings are source-verified, not runtime-reproduced.
- CI configuration was read but not executed.

## Exclusions and limitations

- Security findings are intentionally absent per instruction; path/authentication/security behavior was not audited as a security review.
- No external Semantic Engine process was started. Semantic integration was traced statically through the project resolver, Semantic client/pool, and semantic tools.
- Frontend assets and un-fetched web support/controller/service files are listed as not reviewed; no finding is based on them.
