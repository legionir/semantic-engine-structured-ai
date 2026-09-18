# Batch 3 forensic review — `semantic-engine/`

## Scope and method

20 paths were selected from the complete inventory only when absent from `semantic-completed-paths.txt`, then read directly from `work/repo/semantic-engine`. The selected route/service implementations were traced through their local collaborators, response/error paths, and multi-project parameters. Security was excluded. No repository tests were executed; findings below are static unless the explicitly stated runtime trigger is used.

## Status-table mismatch

The selection rule (absent from `semantic-completed-paths.txt`) does not match the status table. The following selected paths are marked `کامل` in `AUDIT_FILE_STATUS.md`, not `درانتظار`: `src/server/routes/searchRoutes.ts`, `historyRoutes.ts`, `sourceRoutes.ts`, `configRoutes.ts`, `server/types.ts`, `projectRoutes.ts`, `jobRoutes.ts`, `codeRoutes.ts`, `analysisRoutes.ts`, `chatRoutes.ts`, `services/ProjectService.ts`, `services/providers/EmbeddingProviderService.ts`, `services/history/GitHistoryMiner.ts`, `services/source/SourceSyncService.ts`, `services/analysis/MutationSimulator.ts`. They are listed in the completion manifest only because they were absent from the supplied semantic-completed manifest; their status was not changed or fabricated. The remaining selected paths are marked `درانتظار`: `providerRoutes.ts`, `CodeIntelligenceService.ts`, `fsRoutes.ts`, `ImpactAnalysisEngine.ts`, and `ArchitectureRuleEngine.ts`.

## Confirmed findings

### F-19 — Configuration PATCH reports success but never applies the update

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** HTTP API correctness / runtime configuration
- **Trigger:** authenticated `PATCH /api/v1/config` with a body such as `{ "maxBodyBytes": 123456 }`, then issue `GET /api/v1/config` or observe server behavior.

The route is explicitly a write endpoint and requires `config:write`, but it only reads the body and constructs a response:

```ts
method: 'PATCH',
pattern: '/api/v1/config',
requireAuth: true,
permission: 'config:write',
handler: async ctx => {
  const body = (ctx.body || {}) as Record<string, unknown>;
  return {
    status: 200,
    json: {
      updated: true,
      config: {
        port: platformConfig.port,
        host: platformConfig.host,
        allowRemote: platformConfig.allowRemote,
        maxBodyBytes: body.maxBodyBytes || platformConfig.maxBodyBytes,
        projectsRoot: platformConfig.projectsRoot,
      },
    },
  };
},
```

Evidence: `src/server/routes/configRoutes.ts:35-54`. There is no assignment, config-store call, persistence call, or server restart/reconfiguration. `PlatformConfig` is passed into the route factory as a readonly configuration object (`src/server/types.ts:45-88`), while the GET endpoint reads the same object (`configRoutes.ts:8-32`). Therefore `updated: true` is only an echo; a subsequent GET and all runtime consumers still see the old values. `body.maxBodyBytes || ...` also changes an explicitly supplied zero to the old value, but the larger defect is that every accepted update is non-persistent/non-operative. This applies equally to every project because configuration is platform-wide, not project-local; it is not fixed by the route's project IDs (there are none).

### F-20 — Project PATCH and DELETE are success-only stubs and leave the registry unchanged

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Area:** project lifecycle API / multi-project correctness
- **Trigger:** register two projects, call authenticated `PATCH /api/v1/projects/:id` with a new name or `DELETE /api/v1/projects/:id`, then call `GET /api/v1/projects` or `GET /api/v1/projects/:id`.

The PATCH handler resolves the project and then returns a new name without calling a mutator:

```ts
const body = (ctx.body || {}) as { name?: string };
return {
  status: 200,
  json: {
    updated: true,
    id: project.id,
    name: body.name || project.name,
    status: project.status,
  },
};
```

Evidence: `src/server/routes/projectRoutes.ts:85-103`. The DELETE handler likewise resolves the project and returns success without invoking `ProjectService` or removing anything:

```ts
return {
  status: 200,
  json: { deleted: true, id: ctx.params.id },
};
```

Evidence: `src/server/routes/projectRoutes.ts:105-119`. `ProjectService` stores managed projects in private `projects` and `byId` maps (`src/services/ProjectService.ts:53-67`); its registration path is the operation that populates those maps (`ProjectService.ts:76-92`). The route handlers do not call any corresponding update/unregister operation, nor do they alter registry persistence. Consequently PATCH is an ephemeral response fabrication and DELETE is a no-op: subsequent list/get requests continue to expose the old project and its aliases. In a multi-project deployment this can leave deleted projects addressable by all aliases and makes a rename response disagree with the canonical registry/name returned elsewhere. No route-level call path repairs this after the handler returns.

## No additional confirmed findings

The remaining reviewed route/service paths had explicit project existence checks, delegated work to their named services, and coherent failure returns under the static review standard. In particular, source bundle staging/rollback and provider model endpoint fallback were traced; no additional non-security finding was promoted.

## Execution limitations

- No tests were run; conclusions are static source inspection.
- Security was intentionally excluded, including the network/source-input concerns in provider and source synchronization paths.
- The completion manifest records 20 paths; it follows the requested “not in semantic-completed” criterion even where the separate status table already says `کامل`.
