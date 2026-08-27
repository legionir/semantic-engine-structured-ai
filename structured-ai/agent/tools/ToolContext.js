/*
|--------------------------------------------------------------------------
| Tool Execution Context
|--------------------------------------------------------------------------
|
| What a tool needs to act on the right project: the agent on whose
| behalf it runs, the run it belongs to, and the ProjectContext that
| supplies the filesystem boundary.
|
| The context is BUILT BY THE RUNTIME from its own run state and handed
| to executeTool as the third argument — a tool call's arguments never
| carry identity fields, so the model can neither name another project
| nor forge one (EXECUTION_PLAN rule 9).
|
| Modes:
|   legacy  — no project context: every helper is pinned to the
|             process-wide WORKSPACE_ROOT via the historical workspace
|             functions, so behaviour is bit-identical to before.
|   modular — PROJECT_CONTEXT_MODE=modular makes a valid project context
|             mandatory: a tool that runs without one has no boundary
|             and must fail loudly instead of resolving against the
|             wrong root.
|
|--------------------------------------------------------------------------
*/

const fs = require("fs");

const {
    WORKSPACE_ROOT,
    realpath,
    isInsideRoot,
    resolveWorkspacePath,
    assertWorkspacePathSafe,
    toWorkspaceRelative,
    resolvePathInRoot,
    assertPathSafeInRoot,
    toRelativeInRoot
} = require("../lib/workspace");

const settings = require("../lib/storage");


class ToolContext {

    constructor({ agent, runId, project }) {

        this.agent = agent;

        this.runId = runId || null;

        this.project = project || null;

        this.scoped = Boolean(project);

        /* Best-effort canonicalisation: an existing root is resolved
           through symlinks so prefix comparisons match what the kernel
           will open; a missing root stays textual and simply fails the
           first real resolution with the documented error text. */
        this.root =

            canonicalRoot(
                this.scoped
                    ? project.workspaceRoot
                    : WORKSPACE_ROOT
            );

    }


    get projectId() {

        return (
            this.project
                ? (this.project.projectId ?? this.project.id ?? null)
                : null
        );

    }


    resolvePath(inputPath, options = {}) {

        return (
            this.scoped
                ? resolvePathInRoot(this.root, inputPath, options)
                : resolveWorkspacePath(inputPath, options)
        );

    }


    assertSafe(target, options = {}) {

        return (
            this.scoped
                ? assertPathSafeInRoot(this.root, target, options)
                : assertWorkspacePathSafe(target, options)
        );

    }


    isInside(target) {

        return isInsideRoot(this.root, target);

    }


    relative(target) {

        return (
            this.scoped
                ? toRelativeInRoot(this.root, target)
                : toWorkspaceRelative(target)
        );

    }


    /* The workspace pin is used for "in this process the two roots are
       the same directory" checks (pending tool awareness gate). */
    sharesWorkspaceRoot() {

        return this.root === canonicalRoot(WORKSPACE_ROOT);

    }

}


function canonicalRoot(root) {

    try {

        if (fs.existsSync(root)) {
            return realpath(root);
        }

    } catch {
        /* fall through to the textual root */
    }

    return root;

}


/* Rule 9 enforcement: identity may arrive via the runtime context, and
   nowhere else — a project id that shows up as a tool ARGUMENT (i.e.
   came from the model) is a failure, not an override. */
const ARGUMENT_IDENTITY_FIELDS =
    Object.freeze(["projectId", "project_id", "project", "projectRoot", "root"]);


function assertNoIdentityArguments(args) {

    if (!args || typeof args !== "object") {
        return;
    }

    for (const field of ARGUMENT_IDENTITY_FIELDS) {

        if (Object.prototype.hasOwnProperty.call(args, field)) {

            throw new Error(
                `Tool argument "${field}" is not allowed: project identity is ` +
                "supplied by the run context, never by model or user arguments (rule 9)."
            );

        }
    }
}


/* Normalizes the raw executeTool context into a ToolContext. In legacy
   mode an absent one simply means the historical workspace-pinned
   context, so tools can use the helpers unconditionally. A raw context
   that CONTRADICTS itself (a project id with no context, a context
   without a root) fails loudly — that only happens through a runtime
   bug or a forged call, and both deserve errors, not entropy. */
function from(raw) {

    /* executeTool hands implementations the normalized context
       already; re-wrapping it is an identity no-op. */
    if (raw instanceof ToolContext) {
        return raw;
    }

    if (!raw || typeof raw !== "object") {

        if (settings.get("PROJECT_CONTEXT_MODE") === "modular") {

            throw new Error(
                "Tool execution requires a valid project context in modular project mode; " +
                "the runtime must pass { agent, runId, projectId, projectContext } to executeTool."
            );

        }

        return new ToolContext({
            agent: undefined,
            runId: null,
            project: null
        });

    }

    const project =
        raw.projectContext ??
        raw.project_context ??
        null;

    if (project) {

        if (
            typeof project !== "object" ||
            typeof project.workspaceRoot !== "string" ||
            project.workspaceRoot === ""
        ) {

            throw new Error(
                "Invalid tool context: the project context carries no workspaceRoot; " +
                "a tool cannot determine its filesystem boundary."
            );

        }

    } else if (raw.projectId || raw.project_id) {

        throw new Error(
            "Invalid tool context: a projectId without a project context; " +
            "the id alone cannot resolve anything (rule 9)."
        );

    } else if (settings.get("PROJECT_CONTEXT_MODE") === "modular") {

        throw new Error(
            "Tool execution requires a valid project context in modular project mode; " +
            `tool call for agent "${raw.agent || "unknown"}" arrived without one.`
        );

    }

    return new ToolContext({
        agent: raw.agent,
        runId: raw.runId ?? raw.run_id ?? null,
        project
    });

}


module.exports = {
    ToolContext,
    from,
    assertNoIdentityArguments
};
