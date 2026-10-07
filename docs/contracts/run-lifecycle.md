# Run lifecycle contract (plan phase 7)

A *run* is one `runAgent()` call. It gets its own `AgentRunContext` (id, cancellation, budgets) and is never reused:
a retry is a new call and therefore a new run id.

## States and transitions

| From | To | Trigger | Bookkeeping |
|---|---|---|---|
| — | `queued` | `runAgent()` creates the context and hands it to the scheduler (`RunManager.enqueue`) | tracked in `queued`, addressable by id |
| `queued` | `running` | scheduler admits it (`RunManager.execute`) | moved to `active` |
| `queued` | `cancelled` | `cancelRunById` / `cancelAllRuns` while waiting (`RunScheduler.cancelQueuedRun`) | removed from queue, `schedule()` rejects with `RUN_CANCELLED`, moved to `finished` (`RunManager.abandon`) |
| `queued` | `failed` | queue full / project memory limit (`RUN_QUEUE_FULL`, `PROJECT_MEMORY_LIMIT`) | same `abandon` path; no stale id or queue entry |
| `running` | `completed` | the run returned | moved to `finished` |
| `running` | `failed` | any model / tool / hook exception | `run:error` emitted once, moved to `finished` |
| `running` | `cancelled` | cancellation reached the run | `run:error{cancelled:true}`, moved to `finished` |

A terminal state (`completed`, `failed`, `cancelled`) is final: nothing overwrites it.

## Events

* Every `run:start` is followed by **exactly one** terminal event: `run:end` (normal finish) or `run:error` (exception or cancel).
  `AgentRunContext.run_open` is `true` between them; the error path emits `run:error` only while it is `true`.
* `run:error` carries `run_id`, `message`, `cancelled`, `code`; the thrown error is tagged `runTerminalEmitted` so an outer
  layer (the web server) does not emit a second one. A failure *before* the run started has no terminal event from the
  runtime, and the web server emits its own.
* Metrics (`Observability`): `run:start` increments the active gauge; `run:end` / `run:error` decrement it and count failures.

## Cancellation

* `cancelRunById(id)` works for queued and active runs.
* `cancelAllRuns(reason)` (SIGINT / SIGTERM) cancels the legacy current run, every active run and every queued run.
* A pending approval is bound to the owning run's cancellation signal (SA-POL-002): when the run is cancelled the
  pending request is removed and the approval promise rejects with `RUN_CANCELLED`. A run already cancelled before the
  ask never registers a pending approval. A denied or cancelled approval is still emitted through the policy audit
  callback with `approved:false` before the throw (SA-POL-004).

## Processes and sessions

* Background session: a spawn `error` makes the session `failed`; the `close` that Node emits afterwards keeps it `failed`.
* Output buffers are bounded: chunks older than `MAX_PROCESS_BUFFER_CHARS` are dropped and the read cursor moves with them;
  foreground `terminal_exec` caps stdout **and** stderr at `MAX_TOOL_RESULT_TOTAL_CHARS`.
* Session, plan and project-profile files are written by temp file + rename.

## Scheduling (web API)

* Distinct projects run concurrently; the scheduler enforces `MAX_CONCURRENT_PROJECT_RUNS`, `MAX_RUNS_PER_PROJECT`,
  `MAX_WORKERS_PER_USER`.
* A second run for a project that already has one is refused with 409 (per-project slot); the legacy default-project
  route keeps its single-run gate. When the foreground conversation is busy, a project run starts in the background slot
  (`GET /api/projects/:id/run` reports it). Background runs do not auto-continue (decision D-12).

Enforced by: `test/runs/run-terminal.test.js`, `test/runs/queued-cancel.test.js`, `test/web/project-concurrency.test.js`,
`test/tools/process-reliability.test.js`.
