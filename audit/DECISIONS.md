# Autonomous decisions log

Decisions taken without user input (user was asleep; instruction: "pick the best option and log it for later review").
Each entry: id, date, phase/step, decision, why, how to reverse.

| id | phase/step | decision | why | reverse by |
|---|---|---|---|---|
| D-1 | P2/S2 | `PATCH /api/v1/config` mutates only `maxBodyBytes` in memory (`persisted:false`); startup-only keys → 409; unknown → 400. | No persistent config file exists in the repo; `HttpServer` reads `maxBodyBytes` per request so it is the only key with a real runtime effect. | Add a config file + persistence layer if wanted. |
| D-2 | P2/S1 | Gateway `PATCH enabled:false` stops the running worker. | Otherwise registry says disabled while a worker still serves. | Remove the `supervisor.stop` line in `GatewayServer` PATCH handler. |
| D-3 | P2/S2 | `ProjectService.indexProject()` keeps reload-only semantics but says so (`mode:'reload'`, `reindexed:false`); `IndexingWorker` reports `shadowSwapped:false`. | Wiring `IndexPipeline` into `ProjectService` is a rewrite (rule 8 forbids it) and would need caller inventory. | Wire IndexPipeline later; the `mode` field makes callers detect it. |
| D-4 | P1 | Main and branch were merged by taking the branch's `EXECUTION_PLAN.md` (main had only the pristine plan). | Only status markers differed. | — |
