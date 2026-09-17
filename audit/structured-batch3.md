# Structured AI audit — batch 3

Snapshot: `3a20f3192e43c5cf2723cd524e08e013f941a4ed`. Scope: non-security correctness/reliability, implementation plus callers/dependencies, error paths, related tests, and multi-project behavior. No source files modified. Directly reviewed paths are listed in `structured-batch3-completed.txt` (22 paths), all selected from the inventory and absent from `structured-completed-paths.txt`.

## F-016 — Session persistence is not atomic despite the repository contract

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact:** Saving an enabled session writes directly to its final JSON path. A process/filesystem failure after truncation can leave the session document partial or invalid, losing the persisted conversation and making `loadSession` return `null` on the next load. This also contradicts the module's stated atomic-write contract and the existing test's name/intent.
- **Execution path:** `saveSession(session, root)` trims and then calls `fs.writeFileSync(sessionPath(...))`; unlike `JsonRepository.writeJson`, it never calls `AtomicFile.writeFile`. The load path uses `JsonRepository.readJson(..., null)`, so a torn file is silently treated as absent.
- **Evidence (verbatim, `agent/persistence/SessionRepository.js:229-248`):**
  ```js
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
- **Contract evidence:** The file header says whole-file persistence is atomic, while the repository test calls this “atomic session save”; `test/persistence/repositories.test.js` only checks valid output and temp-file absence, not an injected mid-write failure for `saveSession`.
- **Reproduction:** With a temporary workspace and an existing valid session, monkeypatching `fs.writeFileSync` for the session path to write `{"partial":` and throw `Error("crash")` produced the on-disk content exactly `{"partial":`. The original session was not preserved. The real test command `timeout 30s node test/persistence/repositories.test.js` ran and reported **9/9 passed**, but does not cover this failure mode.

## F-017 — Telemetry file provenance is process-workspace scoped, not project scoped

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact:** In modular runs for a registered project rooted outside the process `WORKSPACE_ROOT`, telemetry can omit valid absolute project file mutations (or collapse relative paths from different projects into one name), and `changedFiles()` always compares against the process workspace's Git status. Final `files_changed`/automatic-commit provenance can therefore be incomplete or attributed to the wrong workspace in multi-project runs.
- **Execution path:** `record()` calls `recordMutation()` for successful file mutations; `recordMutation()` calls `rememberChangedPath()`; `normalisePath()` converts an absolute path relative to the module-level `WORKSPACE_ROOT` and rejects paths that become `../...`. `changedFiles()` then reads `gitStatusMap()`, whose `cwd` is also the process-wide `WORKSPACE_ROOT`; neither function receives a project root or uses the run's `project_id`.
- **Evidence (verbatim, `agent/runtime/Telemetry.js:32-57`):**
  ```js
  function normalisePath(value) {

      if (typeof value !== "string") {
          return null;
      }

      const absolute =
          nodePath.isAbsolute(value)
              ? nodePath.relative(WORKSPACE_ROOT, value)
              : value;

      const path = absolute
          .replace(/\\/g, "/")
          .replace(/^\.\//, "")
          .trim();

      if (
          path === "" ||
          path === "." ||
          path === ".." ||
          path.startsWith("../")
      ) {
          return null;
      }

      return path;
  }
  ```
  **Evidence (verbatim, `agent/runtime/Telemetry.js:61-74`):**
  ```js
  function gitStatusMap() {

      try {

          const output =
              execFileSync(
                  "git",
                  ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                  {
                      cwd: WORKSPACE_ROOT,
  ```
  **Evidence (verbatim, `agent/runtime/Telemetry.js:291-315`):**
  ```js
  function changedFiles(runId) {

      const bucket = runId ? RUN_BUCKETS.get(runId) : null;
      const changed = new Set(bucket ? bucket.changed_files : STATE.changed_files);
      const baseline = bucket ? bucket.baseline_git : STATE.baseline_git;
      const current = gitStatusMap();

      for (const [file, code] of current) {
  ...
      return [...changed].sort();
  }
  ```
- **Reproduction:** With `WORKSPACE_ROOT=A` and a separate project root `B`, calling `Telemetry.record({name:"fs_write", success:true, arguments:{path:"/tmp/B/p.txt"}, run_id:"run-b", ...})` leaves the run bucket's `changed_files` empty because `path.relative(A,B/p.txt)` starts with `../`; `changedFiles("run-b")` cannot recover it because Git status is executed only with `cwd: A`. Existing reviewed tests cover persistence and parser contracts, but no reviewed test exercises telemetry with two roots or asserts project-specific changed-file provenance.

## Validation

The only test executed in this batch was the real command `timeout 30s node test/persistence/repositories.test.js`; it completed successfully with 9/9 tests. No claim is made for tests not executed. No repository source files were modified.

## Accounting / status mismatch

`structured-completed-paths.txt` contains only the prior 30 listed structured paths; all 22 batch-3 paths were absent from it. The supplied `AUDIT_FILE_STATUS.md` is a broader semantic-engine/structured status table, but it does not list these `structured-ai/...` paths individually, so their “درانتظار/complete” status cannot be reconciled from that table. I therefore did not alter or fabricate its status; the batch manifest above is the authoritative record of this pass.
