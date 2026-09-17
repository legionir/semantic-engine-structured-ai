# Structured AI audit batch 2

Scope: non-security correctness/reliability review of 20 directly read files from the local mirror at commit `3a20f3192e43c5cf2723cd524e08e013f941a4ed`. No source files modified. No tests are claimed as run in this batch.

## F-015 — modular project settings overlay always reads the process workspace's project file

- **Classification:** CONFIRMED
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Impact:** Opening a registered project whose root differs from `WORKSPACE_ROOT` can apply settings from the wrong project's `.agent/project.json`. The central project layer is selected by project ID, but the legacy/floor layer is always resolved from the process-global workspace. If a setting is absent from the selected project's central cap, it inherits the unrelated process workspace's value; `openProject` therefore produces cross-project configuration contamination. The same global path is returned to callers as the workspace layer.
- **Execution path:** `openProject(projectId)` calls `loadOverlay(openedProjectId)` (WorkspaceProfile.js:345-360) → `loadOverlay` calls `overlayFor` (WorkspaceProfile.js:175-182) → `overlayFor` obtains `workspaceFile: projectPath()` (WorkspaceProfile.js:92-99) → `projectPath()` uses `agentDirectory()` and the module-level `WORKSPACE_ROOT` imported from `WorkspaceBoundary` (WorkspaceProfile.js:1-6, 121-129). The project-aware filesystem boundary explicitly supports a caller-supplied `project.workspaceRoot` (WorkspaceBoundary.js:332-379), but WorkspaceProfile never uses it for the workspace layer.
- **Evidence (verbatim):** `agent/projects/WorkspaceProfile.js:1-6`
  ```js
  const fs = require("fs");
  const path = require("path");

  const settings = require("../config");

  const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");
  ```
  `agent/projects/WorkspaceProfile.js:92-99`
  ```js
  function overlayFor(projectId) {

      return {
          workspaceFile: projectPath(),
          centralFile: centralProjectPath(projectId)
      };
  }
  ```
  `agent/projects/WorkspaceProfile.js:121-129`
  ```js
  function agentDirectory() {

      return path.join(WORKSPACE_ROOT, ".agent");
  }


  function projectPath() {

      return path.join(agentDirectory(), "project.json");
  }
  ```
  `agent/projects/WorkspaceProfile.js:175-193`
  ```js
  function loadOverlay(projectId) {

      const { workspaceFile, centralFile } = overlayFor(projectId);

      const floor = normaliseProject(readProjectFile(workspaceFile));
      const cap = normaliseProject(readProjectFile(centralFile));

      return {
          ...floor,
          ...cap,

          settings: {
              ...floor.settings,
              ...cap.settings
          }
      };
  }
  ```
  `agent/projects/WorkspaceProfile.js:345-360`
  ```js
  function openProject(projectId) {
  ...
      openedProjectId = projectId || null;

      const { workspaceFile, centralFile } =
          overlayFor(openedProjectId);

      const project = loadOverlay(openedProjectId);
  ```
  `agent/context/WorkspaceBoundary.js:332-379`
  ```js
  | Project-relative Boundary ... anchored at a project root supplied by the
  | caller's ProjectContext instead of the process-wide WORKSPACE_ROOT.
  ...
  function resolveProjectPath(
      project,
      inputPath,
      options = {}
  ) {

      return resolvePathInRoot(
          projectRootOf(project),
          inputPath,
          options
      );
  }
  ```
- **Test gap:** `test/projects/projects.test.js` exercises registry and run context for an elsewhere-rooted project, but the reviewed project-profile path has no test that creates two workspace `.agent/project.json` layers and opens a second registered project rooted elsewhere, asserting that the second project's floor is its own root (or that no unrelated floor is inherited).
- **Multi-project check:** The defect is specifically triggered by two projects with different roots: process `WORKSPACE_ROOT=A`, registered project `B`; `openProject(B.id)` still reports/reads `A/.agent/project.json` as `workspaceFile`. The central cap path is B-specific, so only keys absent in B's cap expose the contamination.

## Reviewed implementation notes (no additional confirmed finding)

The other directly read modules were checked for callers/dependencies, error paths, tests, and project scoping: `ProjectContext`, `ProjectRegistry`, `ProjectStore`, `ProjectResolver`, `projects/index`, `RunManager`, `AgentRunContext`, `ToolGraphExecutor`, `RunScheduler`, `RunState`, `RetryController`, `RunBudget`, `RunCancellation`, `engineContext`, `WriteTools`, `DirectoryTools`, `filesystem/index`, and `PlanModel`. The existing settings bound `MAX_PARALLEL_TOOLS` has minimum 1, so the executor's `slice(0, maxParallel)` does not constitute a finding. Security review was intentionally excluded.
