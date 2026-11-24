const fs = require("fs");
const path = require("path");

const {
    WORKSPACE_ROOT,
    capResult
} = require("./context/WorkspaceBoundary");

const toolRuntime = require("./tools");

const {
    PolicyEngine,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler
} = require("./policy");

const events = require("./events");

const settings = require("./config");
const { RepositoryDetector } = require("./runtime/RepositoryDetector");
const repositoryDetector = new RepositoryDetector({
    timeoutMs: settings.get("REPO_DETECT_TIMEOUT_MS")
});
const journal = require("./persistence/JournalRepository");
const eventstore = require("./persistence/EventStoreRepository");

const projects = require("./projects");

const projectRuntime = require("./runtime");

const {
    AgentRunContext,
    runManager,
    runScheduler,
    observability,
    runWithProject,
    effectiveProject,
    effectiveProjectId,
    projectIdOf,
    noteDelegationProject,
    isMultiProjectTask
} = projectRuntime;

const promptKit = require("./prompt");
const { createAgentRequestExecutor } = require("./providers/AgentRequestExecutor");
const { createEndpointProfiles } = require("./providers/EndpointProfiles");
const { createMcpRuntime } = require("./mcp/McpRuntime");
const { createAgentProfileResolver } = require("./runtime/AgentProfileResolver");
const { createExecutionRules } = require("./prompt/ExecutionRules");
const { createResponseReporter } = require("./providers/ResponseReporter");
const { createAgentRegistries } = require("./registry/AgentRegistries");

/*
| Prompt kit wiring (EXECUTION_PLAN Phase 5). The injected builders and
| resolvers are created lazily on first use: every dependency they take
| is a closure over live registry/settings/run state, so nothing ages,
| and are constructed lazily so live registry/settings state is always used.
*/

let TOOL_RESOLVER = null;

let SKILL_RESOLVER = null;

let PROMPT_FACADE = null;


function toolResolver() {

    if (!TOOL_RESOLVER) {

        TOOL_RESOLVER =
            promptKit.createToolResolver({
                TOOL_REGISTRY_OF: () => TOOL_REGISTRY_OF(),
                mcpToolDeclarations: () => mcpToolDeclarations()
            });

    }

    return TOOL_RESOLVER;

}


function skillResolver() {

    if (!SKILL_RESOLVER) {

        SKILL_RESOLVER =
            promptKit.createSkillResolver({
                SKILL_REGISTRY_OF: () => SKILL_REGISTRY_OF(),
                isActiveSkill: skill => isActiveSkill(skill)
            });

    }

    return SKILL_RESOLVER;

}


function promptFacade() {

    if (!PROMPT_FACADE) {

        PROMPT_FACADE =
            promptKit.createPromptBuilder({
                listProjects:
                    () => projects.registry().list(),

                main: {
                    systemPrompt: () => systemPrompt(),
                    executionRules: () => executionRules(),
                    skillIndex: () => skillIndex(),
                    PERSONAS_OF: () => PERSONAS_OF(),
                    AGENTS_OF: () => AGENTS_OF(),
                    discussionPersonaNames: () => discussionPersonaNames(),
                    describeCapability: agent => describeCapability(agent),
                    mayDelegate: () => mayDelegate(mainAgentProfile()),
                    readTask: () => readTask()
                },

                subAgent: {
                    resolveAgentCapabilities:
                        agentDefinition =>
                            resolveAgentCapabilities(agentDefinition),
                    executionRules:
                        agentDefinition => executionRules(agentDefinition),
                    mayDelegate:
                        agentDefinition => mayDelegate(agentDefinition)
                },

                runtimeContext: {
                    CONFIGURED_RUNTIME_OF: () => CONFIGURED_RUNTIME_OF(),
                    detectEnvironment: () => detectEnvironment(),
                    detectRepository: () =>
                        detectRepository(
                            effectiveProject(currentRun().project)
                                ? effectiveProject(currentRun().project).workspaceRoot
                                : undefined
                        ),
                    workspaceRoot: () =>
                        effectiveProject(currentRun().project)
                            ? effectiveProject(currentRun().project).workspaceRoot
                            : WORKSPACE_ROOT,
                    planSummary: () => currentPlanSummary(),
                    memorySizeChars: () =>
                        memoryStore.memorySize(memoryStore.loadMemory()),
                    archiveStats: () => archive.stats(),
                    policySummary: () => POLICY_ENGINE.summary(),
                    endpointOverview: () => endpointOverview(),
                    agentsSpawned: () => currentAgentBudget().spawned,
                    runStartedAt: () => currentRun().started_at,
                    runRemainingMs: () => runRemainingMs(),
                    mcpContext: () => mcpContext()
                },

                request: {
                    endpointFor:
                        (role, agentDefinition) =>
                            endpointFor(role, agentDefinition),
                    RESPONSE_FORMAT_OF: () => RESPONSE_FORMAT_OF()
                }
            });

    }

    return PROMPT_FACADE;

}


journal.attach(events.bus);
eventstore.attach(events.bus);

const {
    conversationSize,
    compactConversation,
    findExchanges
} = require("./context");

const memoryStore = require("./context/Memory");

const {
    _skillIndex: skillIndex,
    _isActiveSkill: isActiveSkill
} = require("./tools/skills");

const archive = require("./persistence/ArchiveRepository");
const hookRegistry = require("./hooks");
const HookRunner = require("./hooks/HookRunner").HookRunner;

const application = require("./application");
const actionKit = require("./actions");
const runtimeEngine = require("./runtime/engine");
const contextKit = require("./context");
const registryLoader = require("./registry/RegistryLoader");
const registryValidator = require("./registry/RegistryValidator");
const AgentRegistry = require("./registry/AgentRegistry");
const ToolRegistry = require("./registry/ToolRegistry");
const SkillRegistry = require("./registry/SkillRegistry");


/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
|
| Nothing is captured here. Every value is read from the settings store
| at the moment it is used, so a change made from the console or the
| environment is picked up by the very next iteration.
|--------------------------------------------------------------------------
*/

const DEFAULT_BASE_URL =
    "http://localhost:4414/p/smart_routing/v1";


const endpointProfiles = createEndpointProfiles({
    settings,
    defaultBaseUrl: DEFAULT_BASE_URL,
    schemaAllowed: (endpoint, role) =>
        responseFormatAllowed(schemaKeyFor(endpoint, role))
});

const {
    currentBaseUrl,
    currentEndpoint,
    currentApiKey,
    roleForDepth,
    endpointFor,
    endpointOverview,
    setModelOverride,
    activeTemperature,
    activeModel
} = endpointProfiles;


/*
|--------------------------------------------------------------------------
| Paths
|--------------------------------------------------------------------------
*/

const ROOT =
    __dirname;

const CONFIG_DIR =
    path.join(ROOT, "config");

const REGISTRY_DIR =
    path.join(ROOT, "registry");

const RUNTIME_DIR =
    path.join(ROOT, "runtime");

const SCHEMA_DIR =
    path.join(ROOT, "schema");



/*
|--------------------------------------------------------------------------
| File Helpers
|--------------------------------------------------------------------------
*/

function readText(filePath) {
    return fs.readFileSync(
        filePath,
        "utf8"
    );
}


function readJSON(filePath) {
    return JSON.parse(
        readText(filePath)
    );
}


/*
|--------------------------------------------------------------------------
| Trace Logging
|--------------------------------------------------------------------------
|
| The runtime logs every decision, tool execution, and delegation so the
| actual execution can be audited instead of inferred from the final answer.
|--------------------------------------------------------------------------
*/

/*
| Progress goes to stdout by default, but a caller that wants machine
| readable output on stdout can push every log line to stderr instead.
*/

const LOG_STREAM =
    process.env.AGENT_LOG_STREAM === "stderr"
        ? console.error
        : console.log;

const PRINT_FINAL =
    process.env.AGENT_PRINT_FINAL !== "0";


function logScope(scope) {

    return scope
        ? `[${scope}]`
        : "[main_agent]";
}


function logLine(
    scope,
    text
) {

    if (!settings.get("AGENT_VERBOSE")) {
        return;
    }

    LOG_STREAM(
        `${logScope(scope)} ${text}`
    );
}


function logObject(
    scope,
    label,
    value
) {

    if (!settings.get("AGENT_VERBOSE")) {
        return;
    }

    const safeValue =
        typeof events.redactForLog === "function"
            ? events.redactForLog(value)
            : value;

    LOG_STREAM(
        `${logScope(scope)} ${label}:\n${
            JSON.stringify(
                safeValue,
                null,
                2
            )
        }`
    );
}


/*
|--------------------------------------------------------------------------
| Registry
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Registries
|--------------------------------------------------------------------------
|
| These come from files, so they are cached rather than re-read on every
| access, but the cache is invalidated when a file changes on disk. An
| operator editing policy.json or agents.json next to a running console
| gets the new behaviour on the next run instead of after a restart.
|--------------------------------------------------------------------------
*/

/*
| Prompt files are re-read when they change, so editing the orchestrator
| prompt or the execution rules does not need a restart either.
*/

const executionRuleRuntime = createExecutionRules({
    fs,
    path,
    configDir: CONFIG_DIR,
    readText,
    allTools: () => TOOLS_OF(),
    resolveTools,
    getPolicyEngine: () => POLICY_ENGINE
});

const {
    executionRules,
    systemPrompt,
    filterExecutionRules
} = executionRuleRuntime;


const POLICY_ENGINE_HOLDER = { engine: null };

const agentRegistries = createAgentRegistries({
    path,
    settings,
    registryLoader,
    AgentRegistry,
    ToolRegistry,
    SkillRegistry,
    events,
    policyEngineHolder: POLICY_ENGINE_HOLDER,
    registryDir: REGISTRY_DIR,
    schemaDir: SCHEMA_DIR,
    runtimeDir: RUNTIME_DIR
});

const {
    registrySignature,
    loadRegistries,
    PERSONAS_OF,
    SKILLS_OF,
    TOOLS_OF,
    TOOL_GROUPS_OF,
    POLICY_OF,
    AGENTS_OF,
    RESPONSE_FORMAT_OF,
    CONFIGURED_RUNTIME_OF,
    PERSONA_REGISTRY_OF,
    SKILL_REGISTRY_OF,
    TOOL_REGISTRY_OF,
    AGENT_REGISTRY_OF
} = agentRegistries;


/*
| The personas the discussion_* profiles point at. They exist in the
| registries for validation and tool mapping, but the prompt catalogues
| stay focused on delegation, so call sites that build those catalogues
| filter them out with this set.
*/

function discussionPersonaNames() {

    const names = new Set();

    for (const agent of AGENTS_OF()) {

        if (agent.name.startsWith("discussion_") && agent.persona) {
            names.add(agent.persona);
        }
    }

    return names;
}


/*
|--------------------------------------------------------------------------
| Policy Engine
|--------------------------------------------------------------------------
|
| The Agent Profile decides which capabilities an agent has. The policy
| engine decides whether a particular call may run, and is the only place
| that can deny or escalate to approval.
|--------------------------------------------------------------------------
*/

POLICY_ENGINE_HOLDER.engine =
    new PolicyEngine({
        policy: POLICY_OF(),

        toolGroups: TOOL_GROUPS_OF(),

        onDecision: decision => {

            events.emit("policy:decision", decision);

            if (decision.decision === "allow") {
                return;
            }

            logLine(
                decision.agent,
                `Policy ${decision.decision} for ${
                    decision.tool
                }${
                    decision.approved === undefined
                        ? ""
                        : decision.approved
                            ? ` (approved, ${decision.approval_mode})`
                            : " (rejected)"
                }: ${decision.reason}`
            );
        }
    });


const POLICY_ENGINE =
    POLICY_ENGINE_HOLDER.engine;


/*
|--------------------------------------------------------------------------
| Registry Validation
|--------------------------------------------------------------------------
|
| A typo in a profile used to be silently dropped, leaving an agent
| running without the tool it was supposed to have. The registries are
| now checked against each other before the first request is built.
|--------------------------------------------------------------------------
*/

function validateRegistries() {

    return registryValidator.validate({
        tools: TOOLS_OF(),
        groups: TOOL_GROUPS_OF(),
        skills: SKILLS_OF(),
        agents: AGENTS_OF(),
        personas: PERSONAS_OF(),
        policy: POLICY_OF(),
        hasTool: name => toolRuntime.hasTool(name),
        implementedToolNames: () => toolRuntime.implementedToolNames()
    });
}

/*
|--------------------------------------------------------------------------
| Runtime Context
|--------------------------------------------------------------------------
*/

function detectEnvironment() {

    /*
    | The declared environment is overridden by what is actually running,
    | so the model never generates commands for the wrong shell.
    */

    const platform =
        process.platform;

    const os =
        platform === "win32"
            ? "windows"
            : platform === "darwin"
                ? "macos"
                : "linux";

    const shell =
        platform === "win32"
            ? (
                process.env.COMSPEC
                    ? path.basename(process.env.COMSPEC)
                    : "cmd.exe"
            )
            : (
                process.env.SHELL
                    ? path.basename(process.env.SHELL)
                    : "sh"
            );

    return {
        ...(CONFIGURED_RUNTIME_OF().environment || {}),

        os,

        shell,

        platform,

        node_version:
            process.version
    };
}


/*
| The repository is discovered from the workspace rather than declared,
| so the model is never told there is a git repository when there is
| not, and never has to guess the branch.
*/

/* The repository is discovered from the workspace rather than declared,
| so the model is never told there is a git repository when there is
| not, and never has to guess the branch. In modular mode the runtime
| passes the calling run's project root, so a cross-root project sees
| its own repository rather than the process workspace's.
*/

function detectRepository(root) {

    return repositoryDetector.detect(
        root || WORKSPACE_ROOT,
        CONFIGURED_RUNTIME_OF().repository || {}
    );
}


async function refreshRepositoryContext() {

    const project = effectiveProject(currentRun().project);
    const root = project ? project.workspaceRoot : WORKSPACE_ROOT;

    return repositoryDetector.refresh(
        root,
        CONFIGURED_RUNTIME_OF().repository || {}
    );
}


/*
| The runtime context is written once, but the numbers inside it move:
| the plan advances, the deadline shrinks, agents are spent. The message
| is therefore rewritten in place at the start of every iteration, so an
| agent never reasons about a stale snapshot of its own run.
*/

/*
| Compaction used to run only after tool results were appended, so a run
| that mostly delegates never compacted at all, and a run that did
| compact only reacted once the budget was already exceeded. It is now a
| maintenance step at the top of every iteration, triggered at a share
| of the budget rather than at the limit.
*/

/*
| Asks the model to compress a slice of its own history. It is a plain
| completion, deliberately without tools or the action schema, so a
| failure here can never derail the run: the caller falls back to
| mechanical compression.
*/

async function summariseTranscript(transcript, instruction) {

    const response =
        await sendAgentRequest({
            messages: [
                {
                    role: "system",

                    content:
                        instruction ||
                        [
                            "You compress an agent's working memory.",
                            "Write a dense digest of the tool calls below for the agent that made them.",
                            "Keep: what was inspected or changed, the paths involved, the facts learned, the errors hit, and anything still unresolved.",
                            "Drop: raw file bodies, repeated output, and anything the agent can trivially re-read.",
                            "Write plain prose, no preamble, no markdown headings."
                        ].join(" ")
                },
                {
                    role: "user",

                    content: transcript
                }
            ],

            agentDefinition: {
                name: "context_summariser",

                /*
                | A dedicated model when one is configured, otherwise the
                | agent's own. Summarising is frequent and mechanical, so
                | pointing this at a small model is usually the cheapest
                | change available.
                */

                /*
                | The model comes from the SUMMARY endpoint profile,
                | so there is one place to configure it.
                */

                temperature: 0,

                max_tokens:
                    settings.get("CONTEXT_SUMMARY_MAX_TOKENS")
            },

            tools: undefined,

            responseFormat: null,

            role: "SUMMARY",

            timeoutMs:
                settings.get("CONTEXT_SUMMARY_MS")
        });

    const message =
        response?.choices?.[0]?.message;

    return typeof message?.content === "string"
        ? message.content
        : null;
}


/*
| Moves the oldest exchanges out of the transcript and into working
| memory, one chunk at a time, then rewrites the single memory message.
| The newest exchanges are never touched, so the agent keeps what it
| just read.
*/

/*
| One place that turns exchanges into archive records, used both when
| history is folded into memory and when compaction drops an exchange
| outright. Dropping is the only step that destroys material, so it must
| never happen without a copy landing here first.
*/

/*
| Context / memory / archive (EXECUTION_PLAN Phase 17). Implementation
| lives in agent/context/ and agent/persistence/; these stay as
| compatible wrappers so the runtime loop and the existing exports keep
| their names and signatures (law 7).
*/

function archiveExchanges(messages, exchanges, scope) {

    return contextKit.archiveExchanges(messages, exchanges, scope);

}


async function foldIntoMemory(messages, scope) {

    return contextKit.foldIntoMemory(messages, scope);

}


function refreshMemoryMessage(messages, memory) {

    return contextKit.refreshMemoryMessage(messages, memory);

}


async function maintainContext(messages, scope, tools, agentDefinition) {

    return contextKit.maintainContext(messages, scope, tools, agentDefinition);

}


function refreshRuntimeContext(messages) {
    return promptFacade().refreshRuntimeContext(messages);
}


function currentPlanSummary() {

    try {

        const plan = require("./tools/planning");

        return plan._summarise(plan._loadPlan());

    } catch (error) {

        return {
            exists: false,
            error: error.message
        };
    }
}


function currentPlanView() {

    try {

        const planTools = require("./tools/planning");
        const plan = planTools._loadPlan();

        return {
            ...planTools._summarise(plan),
            created_at: plan.created_at,
            updated_at: plan.updated_at,
            phases: plan.phases
        };

    } catch (error) {

        return {
            exists: false,
            phases: [],
            error: error.message
        };
    }
}


function createRuntimeContext() {
    return promptFacade().runtimeContextMessage();
}


function mcpContext() {

    if (settings.get("MCP_ENABLED") === false) {
        return { enabled: false, servers: [], tools: 0 };
    }

    try {

        const status =
            toolRuntime.mcp._manager.status();

        return {
            enabled: true,

            tools:
                status.tool_count,

            servers:
                status.servers
                    .filter(server => server.enabled)
                    .map(server => ({
                        name: server.name,
                        state: server.state,
                        tools: server.tool_count
                    }))
        };

    } catch {

        return { enabled: true, servers: [], tools: 0 };
    }
}


/*
|--------------------------------------------------------------------------
| Run Deadline and Cancellation
|--------------------------------------------------------------------------
|
| A run is bounded by wall-clock time, not only by iteration counts: a
| delegation tree of slow agents could otherwise spin for hours. Every
| model request, tool call, and sub-agent observes the same deadline, and
| an interrupt cancels all of them at once.
|--------------------------------------------------------------------------
*/

const RUN = {
    id: null,
    started_at: 0,
    controller: null,
    cancelled_reason: null,
    inHook: false,
    hook_phase: null,
    hook_started_at: 0,
    hook_deadline_at: null,
    hook_results: {},
    /*
    | The run-scoped verdict of a hook that failed with on_failure: stop.
    | Later phases short-circuit on it, so it belongs to the run, not to
    | the process: startRun() clears it exactly like hook_results, and the
    | hooks lifecycle suite locks that contract.
    */
    hooks_stopped: null,
    hooks_stopped_by: null,
    after_hooks_ran: false,
    main_agent_definition: null,
    task: "",
    turnCounter: 0,
    /*
    | The ProjectContext this run is scoped to (Phase 2). Null in legacy
    | mode: nothing downstream may branch on it yet — consumers arrive
    | with the project-aware tool runtime in Phase 4.
    */
    project: null
};


/*
| The compat accessors of EXECUTION_PLAN Phase 3: every read/write the
| engine used to aim at the global RUN and AGENT_BUDGET goes through
| these. In legacy mode (and anywhere outside a run's async scope) they
| resolve to the same globals as before, so behavior is unchanged; in
| modular mode each run's async chain resolves to its own
| AgentRunContext, which is what lets two runs share a process without
| sharing messages, budgets or cancellation.
*/

function currentRun() {

    return runManager.current() || RUN;

}


function currentAgentBudget() {

    const context = runManager.current();

    return context ? context.agentBudget : AGENT_BUDGET;

}


function startRun() {

    currentRun().started_at = Date.now();

    /*
    | Archived records outlive the process, so they carry the run they
    | came from; without it a later search cannot tell yesterday's
    | failure from this morning's.
    */

    /*
    | A modular run keeps the id the RunManager issued when its context
    | was created, so the run is addressable before startRun; the legacy
    | global RUN always regenerates its id from the fresh start
    | timestamp, exactly as it historically does.
    */

    if (
        !(currentRun() instanceof AgentRunContext) ||
        !currentRun().id
    ) {

        currentRun().id =
            `run-${new Date(currentRun().started_at).toISOString()
                .replace(/[:.]/g, "-")}`;

    }

    /* Every event emitted from now on carries this run_id in its
       correlation envelope, so the journal, session and archive can
       attribute events to the same run. */
    events.setContext({ run_id: currentRun().id });

    /* P0-7: a cancel that arrived before this point is kept, with its
       reason; attaching the controller aborts it immediately. */
    const cancelledEarly =
        Boolean(
            currentRun().cancellation &&
            currentRun().cancellation.requested
        );

    const earlyReason =
        cancelledEarly
            ? currentRun().cancelled_reason
            : null;

    currentRun().controller = new AbortController();
    currentRun().cancelled_reason = earlyReason;
    currentRun().inHook = false;
    currentRun().hook_phase = null;
    currentRun().hook_started_at = 0;
    currentRun().hook_deadline_at = null;
    currentRun().hook_results = {};
    currentRun().hooks_stopped = null;
    currentRun().hooks_stopped_by = null;
    currentRun().after_hooks_ran = false;
    currentRun().main_agent_definition = null;
    currentRun().task = "";
    currentRun().turnCounter = 0;
    currentRun().project = null;

    /*
    | Whatever belongs to a single run is cleared here, so every entry
    | point gets the same clean slate, not only runAgent.
    */

    /* A modular run resets only its own tool scope (search sessions,
       telemetry buckets); the legacy start resets process-wide state
       exactly as it always has. */
    currentRun().carried =
        toolRuntime.startRunScope(
            currentRun() instanceof AgentRunContext
                ? currentRun().id
                : undefined
        );

    return currentRun().carried;
}


/*
| The deadline is derived, never stored, so raising or lowering the
| budget from the console moves it for a run that is already going.
*/

function runDeadlineAt() {

    if (currentRun().inHook && currentRun().hook_deadline_at) {
        return currentRun().hook_deadline_at;
    }

    if (!currentRun().started_at) {
        return null;
    }

    return (
        currentRun().started_at +
        settings.get("MAX_RUN_MS")
    );
}


function cancelRun(reason) {

    if (
        !currentRun().controller ||
        currentRun().controller.signal.aborted
    ) {
        return;
    }

    currentRun().cancelled_reason = reason;

    if (reason === "deadline") {

        events.emit("run:deadline", {
            agent: "main_agent",
            max_run_ms: settings.get("MAX_RUN_MS"),
            elapsed_ms: runElapsedMs()
        });
    }

    currentRun().controller.abort();
}


/*
| Cancellation is addressable by run id. A
| caller that holds no async scope of the run — a web cancel endpoint,
| a test — names the run instead of whichever run happens to be current
| process-wide. Awaiting the run's promise still reports the failure to
| its own caller; every other run keeps going. Returns false when no
| tracked run has that id.
*/
function cancelRunById(runId, reason) {

    const context = runManager.get(runId);

    if (!context) {
        return false;
    }

    /* A run that is still waiting for admission has no controller yet: it
       is cancelled by removing it from the scheduler queue, and the caller
       of runAgent() gets RUN_CANCELLED. */
    if (context.status === "queued") {

        context.cancelled_reason = reason;

        context.cancellation.abort();

        return runScheduler.cancelQueuedRun(runId, reason) || true;
    }

    /*
    | P0-7: a run that is running but whose startRun has not attached its
    | controller yet keeps the cancel (RunCancellation remembers it and
    | aborts the controller attached next). Only an already-aborted run
    | is left alone.
    */
    if (
        context.controller &&
        context.controller.signal.aborted
    ) {
        return true;
    }

    context.cancelled_reason = reason;

    if (reason === "deadline") {

        events.emit("run:deadline", {
            run_id: context.runId,
            project_id: context.projectId,
            agent: "main_agent",
            max_run_ms: settings.get("MAX_RUN_MS"),
            elapsed_ms:
                context.started_at
                    ? Date.now() - context.started_at
                    : 0
        });
    }

    context.cancellation.abort();

    return true;
}


/*
| Signals must reach EVERY run: the legacy/global current run and each
| modular run, active or still queued. `cancelRun` alone only touched
| whichever run was current in the signal handler's (empty) scope.
*/
function cancelAllRuns(reason) {

    cancelRun(reason);

    for (const context of [...runManager.activeRuns(), ...runManager.queuedRuns()]) {

        cancelRunById(context.runId, reason);
    }
}


function runRemainingMs() {

    const deadline = runDeadlineAt();

    if (!deadline) {
        return settings.get("MAX_RUN_MS");
    }

    return deadline - Date.now();
}


function isRunCancelled() {

    return Boolean(
        currentRun().controller &&
        currentRun().controller.signal.aborted
    );
}


function runElapsedMs() {

    return currentRun().started_at
        ? Date.now() - currentRun().started_at
        : 0;
}


/*
| A stopped run has to say which limit stopped it and how much of it was
| spent, otherwise "cancelled" reads like a bug rather than a budget.
*/

function budgetSentence() {

    if (currentRun().inHook) {

        return `the ${currentRun().hook_phase || "hook"} budget of ${
            settings.get("HOOK_TIMEOUT_MS")
        } ms (HOOK_TIMEOUT_MS) was spent`;
    }

    return `the run budget of ${
        settings.get("MAX_RUN_MS")
    } ms (MAX_RUN_MS) was spent after ${runElapsedMs()} ms`;
}


function assertRunActive(what) {

    if (isRunCancelled()) {

        throw new Error(
            `Run cancelled${
                currentRun().cancelled_reason
                    ? ` (${currentRun().cancelled_reason})`
                    : ""
            }: ${what}${
                currentRun().cancelled_reason === "deadline"
                    ? ` — ${budgetSentence()}`
                    : ""
            }`
        );
    }

    if (runRemainingMs() <= 0) {

        cancelRun("deadline");

        throw new Error(
            `Run stopped at ${what}: ${budgetSentence()}`
        );
    }
}


/*
| A per-request signal that fires on the request timeout, the run
| deadline, or an explicit cancellation, whichever comes first.
*/

function createRequestSignal(timeoutOverride) {

    const controller =
        new AbortController();

    const remainingMs =
        runRemainingMs();

    const requestCeiling =
        timeoutOverride ||
        settings.get("MAX_REQUEST_MS");

    /*
    | Whichever limit is closer decides both the timer and the message,
    | so a run that dies from its deadline is not reported as a slow
    | endpoint.
    */

    const boundedByRun =
        remainingMs < requestCeiling;

    const timeoutMs =
        Math.max(
            1,
            Math.min(
                requestCeiling,
                remainingMs
            )
        );

    const state = {
        reason: null
    };

    const timer =
        setTimeout(
            () => {

                state.reason =
                    boundedByRun
                        ? budgetSentence()
                        : `request timed out after ${timeoutMs} ms (MAX_REQUEST_MS)`;

                if (boundedByRun) {
                    cancelRun("deadline");
                }

                controller.abort();
            },
            timeoutMs
        );

    const onRunAbort = () => {

        /*
        | A deadline is a budget, not a mystery, so the reason carries
        | the limit and what was spent rather than the word "deadline".
        */

        state.reason =
            currentRun().cancelled_reason === "deadline"
                ? budgetSentence()
                : `run cancelled (${
                    currentRun().cancelled_reason || "unknown"
                })`;

        controller.abort();
    };

    if (currentRun().controller) {

        if (currentRun().controller.signal.aborted) {
            onRunAbort();
        } else {

            currentRun().controller.signal.addEventListener(
                "abort",
                onRunAbort,
                {
                    once: true
                }
            );
        }
    }

    return {
        signal:
            controller.signal,

        get reason() {
            return state.reason;
        },

        release() {

            clearTimeout(timer);

            if (currentRun().controller) {

                currentRun().controller.signal.removeEventListener(
                    "abort",
                    onRunAbort
                );
            }
        }
    };
}


/*
|--------------------------------------------------------------------------
| Agent Budget
|--------------------------------------------------------------------------
|
| max_total_agents caps how many sub-agents a single run may spawn,
| across every depth and branch of the delegation tree.
|--------------------------------------------------------------------------
*/

const AGENT_BUDGET = {
    spawned: 0
};


function resetAgentBudget() {

    currentAgentBudget().spawned = 0;
}


function remainingAgentBudget() {

    return Math.max(
        0,
        settings.get("MAX_TOTAL_AGENTS") - currentAgentBudget().spawned
    );
}


function consumeAgentBudget(
    agentName
) {

    currentAgentBudget().spawned++;

    if (
        currentAgentBudget().spawned >
        settings.get("MAX_TOTAL_AGENTS")
    ) {

        throw new Error(
            `Total agent budget exceeded (${settings.get("MAX_TOTAL_AGENTS")}) while starting "${agentName}".`
        );
    }
}


/*
|--------------------------------------------------------------------------
| Tool Resolution
|--------------------------------------------------------------------------
*/

const mcpRuntime = createMcpRuntime({
    settings,
    tools: toolRuntime,
    logLine
});

const { mcpToolDeclarations, discoverMcpTools } = mcpRuntime;


function mcpToolRegistry() {

    /* Moved to agent/prompt/ToolResolver.js (Phase 5). */
    return toolResolver().mcpRegistry();
}




function resolveTools(toolNames) {

    /* Moved to agent/prompt/ToolResolver.js (Phase 5); the wrapper keeps
       every call site and the live-registry behavior identical. */
    return toolResolver().resolve(toolNames);
}


/*
|--------------------------------------------------------------------------
| Skill Resolution
|--------------------------------------------------------------------------
*/

function resolveSkills(skillNames) {

    /* Moved to agent/prompt/SkillResolver.js (Phase 5). */
    return skillResolver().resolve(skillNames);
}


/*
|--------------------------------------------------------------------------
| Persona Resolution
|--------------------------------------------------------------------------
*/

const profileResolver = createAgentProfileResolver({
    personaRegistry: PERSONA_REGISTRY_OF,
    agentRegistry: AGENT_REGISTRY_OF,
    toolRegistry: TOOL_REGISTRY_OF,
    skillRegistry: SKILL_REGISTRY_OF,
    hasDiscoveredTool: name => toolRuntime.mcp._hasDiscoveredTool(name),
    discoveredToolNames: () => toolRuntime.mcp._discoveredToolNames(),
    resolveTools,
    resolveSkills
});

const {
    resolvePersona,
    resolveAgentProfile,
    buildAdHocProfile,
    resolveDelegationProfile,
    resolveAgentCapabilities
} = profileResolver;


/*
|--------------------------------------------------------------------------
| Agent System Prompt
|--------------------------------------------------------------------------
*/

function buildAgentSystemPrompt(
    agentDefinition
) {
    return promptFacade().subAgentSystemPrompt(agentDefinition);
}


/*
|--------------------------------------------------------------------------
| Agent Request Builder
|--------------------------------------------------------------------------
*/

function buildAgentRequest(options) {
    return promptFacade().request(options);
}


/*
|--------------------------------------------------------------------------
| Initial Main Agent Messages
|--------------------------------------------------------------------------
*/

/*
| The task comes from the caller, or from AGENT_TASK for a shell that
| finds a flag awkward. There is no checked-in prompt file any more:
| editing a file in the repository to change what the agent should do
| was a leftover from the first prototype, and it made the repository
| carry one user's task.
*/

function readTask() {

    const provided =
        process.env.AGENT_TASK;

    return typeof provided === "string"
        ? provided
        : "";
}


/*
| What a profile can actually do, rather than leaving the orchestrator
| to infer it from a list of tool names. Reading git history is not the
| same capability as committing, and running a shell is not the same as
| editing a file, so the two are reported separately.
*/

const FILE_MUTATING_TOOLS = [
    "fs_write",
    "fs_edit",
    "fs_mkdir",
    "fs_move",
    "fs_delete"
];

const REPOSITORY_MUTATING_TOOLS = [
    "git_add",
    "git_commit",
    "git_checkout",
    "git_branch"
];

const COMMAND_TOOLS = [
    "terminal_exec",
    "process_start",
    "process_write"
];


function describeCapability(agentDefinition) {

    const tools =
        agentDefinition.tools === "*"
            ? [...TOOL_REGISTRY_OF().keys()]
            : agentDefinition.tools || [];

    return {
        can_write_files:
            tools.some(
                name => FILE_MUTATING_TOOLS.includes(name)
            ),

        can_change_repository:
            tools.some(
                name => REPOSITORY_MUTATING_TOOLS.includes(name)
            ),

        can_run_commands:
            tools.some(
                name => COMMAND_TOOLS.includes(name)
            )
    };
}


function canModifyWorkspace(agentDefinition) {

    const capability =
        describeCapability(agentDefinition);

    return (
        capability.can_write_files ||
        capability.can_change_repository ||
        capability.can_run_commands
    );
}


/* Phase 12: the policy engine owns the extra approval for writes that
   leave the Sub-Agent's project or happen in a multi-project task. */
async function enforceCrossProjectWrite(toolName, args, agent) {

    return POLICY_ENGINE.enforceCrossProjectWrite({
        toolName,
        args,
        agent,
        enabled: delegationProjectSwitchEnabled(),
        fileMutatingTools: FILE_MUTATING_TOOLS,
        currentRun,
        effectiveProject,
        projectIdOf,
        isMultiProjectTask
    });
}

/*
| The root profile, as configured, without running a whole agent to ask
| whether it may delegate.
*/

function mainAgentProfile() {

    return (
        AGENTS_OF().find(
            agent => agent.name === "main_agent"
        ) || {
            name: "main_agent",
            delegation: { enabled: true }
        }
    );
}


function mayDelegate(agentDefinition) {

    return Boolean(agentDefinition?.delegation?.enabled);
}


/*
| Sub-agents are the capacity this runtime has that a single loop does
| not: each one brings its own iteration budget and its own context. A
| real run spent 28 iterations doing implementation work alone with 15
| agents unused, which is not prudence, it is capacity left on the table.
|
| Telling the model that in the prompt did not work, so the runtime says
| it at the moment it is true: the plan has parallel work left, the
| agent budget is untouched, and the root has been working alone for a
| while. It is a notice, not a refusal, because forcing a delegation
| that does not fit would be worse than not delegating at all.
*/

function delegationHintMessage(...args) {

    return runtimeEngine.delegationHintMessage(...args);

}


function shouldHintDelegation(...args) {

    return runtimeEngine.shouldHintDelegation(...args);

}


/*
| A final answer may declare what it did. The runtime already knows what
| it executed, so the two can be compared, and the interesting case is
| the claim with nothing behind it: "I updated the config" when no write
| ever ran. The mismatch is reported, never silently corrected, because
| the runtime cannot know which of the two is the lie.
*/

function checkPerformedClaim(...args) {

    return runtimeEngine.checkPerformedClaim(...args);

}


function createMainAgentMessages(task) {
    return promptFacade().mainMessages(task, {
        project: effectiveProject(currentRun().project)
    });
}


/*
|--------------------------------------------------------------------------
| Permission Boundary
|--------------------------------------------------------------------------
|
| The policy boundary is enforced by the extracted policy engine. This
| function remains the allowlist/availability guard used before that
| boundary and is kept as a compatibility wrapper.
|--------------------------------------------------------------------------
*/

function assertToolAllowed(...args) {

    return runtimeEngine.assertToolAllowed(...args);

}


/*
|--------------------------------------------------------------------------
| Tool Call Normalization
|--------------------------------------------------------------------------
*/

function parseArguments(value, toolName) {

    return actionKit.parseArguments(value, toolName);
}


function normalizeToolCalls(...args) {

    return runtimeEngine.normalizeToolCalls(...args);

}


/*
|--------------------------------------------------------------------------
| Dependency Validation
|--------------------------------------------------------------------------
*/

function validateDependencyGraph(...args) {

    return runtimeEngine.validateDependencyGraph(...args);

}


/*
|--------------------------------------------------------------------------
| Generic Dependency Graph Executor
|--------------------------------------------------------------------------
*/

/*
| The scheduler decides the shape of an execution by itself, but nothing
| outside it could see that shape, so a console could not tell a
| dependency graph from three unrelated calls that happened to run
| together. The same ready-set rule is replayed here without executing
| anything, which gives the waves and a name for the shape.
*/

function describeGraph(...args) {

    return runtimeEngine.describeGraph(...args);

}


async function executeDependencyGraph(...args) {

    return await runtimeEngine.executeDependencyGraph(...args);

}


/*
|--------------------------------------------------------------------------
| Dependency References
|--------------------------------------------------------------------------
|
| depends_on orders the graph. A reference such as
|
|     { "path": "${call_1.result.entries.0.name}" }
|
| also carries the earlier result into the dependent call, so a two-step
| operation costs one iteration instead of two. A reference may only
| point at an id the call actually declared in depends_on.
|--------------------------------------------------------------------------
*/


function readReferencePath(...args) {

    return runtimeEngine.readReferencePath(...args);

}


function resolveReference(...args) {

    return runtimeEngine.resolveReference(...args);

}


function resolveArgumentReferences(...args) {

    return runtimeEngine.resolveArgumentReferences(...args);

}


/*
|--------------------------------------------------------------------------
| Tool Graph
|--------------------------------------------------------------------------
*/


async function executeToolGraph(...args) {

    return await runtimeEngine.executeToolGraph(...args);

}


/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/

/*
| A transient failure from the endpoint should not end a run that may
| have been working for minutes. Rate limits, gateway errors, and
| dropped connections are retried with exponential backoff and jitter;
| a request that the server rejected on its merits is not.
*/

function isRetryableStatus(...args) {

    return runtimeEngine.isRetryableStatus(...args);

}


function retryDelayMs(...args) {

    return runtimeEngine.retryDelayMs(...args);

}


async function callAI(...args) {

    return await runtimeEngine.callAI(...args);

}


const requestExecutor = createAgentRequestExecutor({
    settings,
    endpointFor,
    logLine,
    events,
    buildAgentRequest,
    assertRunActive,
    createRequestSignal,
    isRunCancelled,
    isRetryableStatus
});

const {
    schemaKeyFor,
    responseFormatAllowed,
    mentionsSchemaRejection,
    sendAgentRequest,
    performAgentRequest
} = requestExecutor;


/*
|--------------------------------------------------------------------------
| Response Parser
|--------------------------------------------------------------------------
|
| Implementation lives in agent/actions/ (EXECUTION_PLAN Phase 15). The
| functions below stay as compatible wrappers so the runtime loop and the
| existing exports keep their names and signatures.
|--------------------------------------------------------------------------
*/

/*
| Some OpenAI-compatible servers answer a request that carries `tools`
| with a native tool call instead of the structured content we asked
| for. That is a valid protocol answer, so the runtime adapts it to the
| internal action contract rather than failing the run.
*/

/*
| A model that answers with a native tool call has to serialise the
| arguments itself, and that string is where a small model goes wrong:
| it appends the shape of the previous tool RESULT, wraps the object in
| prose, or fences it. The object it meant to send is usually complete
| and intact, so the runtime reads it out instead of losing the run.
|
| Only trailing material is salvaged. Anything that changes the meaning
| of the arguments is refused, because writing a file with guessed
| arguments is worse than asking the model again.
*/

function parseToolArguments(raw) {

    return actionKit.parseToolArguments(raw);
}


/*
| An error the model itself can fix by answering again. The loop turns
| it into a notice and asks for another answer instead of ending the
| run, because one badly serialised call is not a failed objective.
*/

function keepDeclaredArguments(name, args) {

    return actionKit.keepDeclaredArguments(name, args);
}


function modelResponseError(message, code, details) {

    return actionKit.modelResponseError(message, code, details);
}


function isModelResponseError(error) {

    return actionKit.isModelResponseError(error);
}


function responsePreview(data, limit = 2400) {

    return actionKit.responsePreview(data, limit);
}


function truncatedResponseError(data) {

    return actionKit.truncatedResponseError(data);
}


function compactToolParameterSchema(name) {

    return actionKit.compactToolParameterSchema(name);
}


function canonicalActionExamples() {

    return actionKit.canonicalActionExamples();
}


function malformedRepairHint(reason, details) {

    return actionKit.malformedRepairHint(reason, details);
}


/*
| A malformed answer is the model's mistake, not a failed objective, so
| the runtime hands the rejected answer, the exact error, and valid shapes
| back to the model. This makes the next request a correction attempt,
| not a blind repetition of the same input.
*/

function malformedNoticeMessage(error, attempt, retryLimit) {

    return actionKit.malformedNoticeMessage(error, attempt, retryLimit);
}

/*
| A small model sometimes closes the action object one bracket too late and
| leaves top-level envelope pairs at the tail of the active array:
|
|   "tool_calls": [{...}, "version", "1.0"]
|
| Those string items can never be calls or delegations, and the version value
| is fixed by the protocol, so moving an unambiguous suffix is safer than
| spending every malformed retry on the same bracket mistake. Nothing in the
| middle of an array, and no ambiguous value, is guessed.
*/

function repairMarkdownPathArguments(name, args) {

    return actionKit.repairMarkdownPathArguments(name, args);
}


function repairStructuredAction(value) {

    return actionKit.repairStructuredAction(value);
}

/*
| Parses and validates one model answer. Everything that is the model's
| fault is tagged, so the loop can tell a bad answer apart from a broken
| endpoint.
*/

function readModelAction(data) {

    return actionKit.readModelAction(data);
}


const responseReporter = createResponseReporter({ settings, events });

const {
    reasoningText,
    modelMessageText,
    reportThinking,
    reportModelResponse
} = responseReporter;


function adaptNativeToolCalls(message) {

    return actionKit.adaptNativeToolCalls(message);
}


/*
| Models occasionally wrap the JSON object in a markdown fence even when
| a schema was requested. Unwrapping it is cheaper than losing the run.
*/

function stripCodeFence(text) {

    return actionKit.stripCodeFence(text);
}


function parseStructuredResponse(
    data
) {

    return actionKit.parseStructuredResponse(data);
}


/*
|--------------------------------------------------------------------------
| Action Validation
|--------------------------------------------------------------------------
*/

function validateActionGraph(items, noun) {

    return actionKit.validateActionGraph(items, noun);
}


function requireNullFields(action, fields) {

    return actionKit.requireNullFields(action, fields);
}


/* Phase 12: a delegation may name a project. Missing / null means
   inherit the active project. Both camelCase (implementation plan)
   and snake_case are accepted; conflicting values are rejected. */
function requestedDelegationProjectId(delegation) {

    return actionKit.requestedDelegationProjectId(delegation);
}


function delegationProjectSwitchEnabled() {

    return true;

}


function findingsFromReport(...args) {

    return runtimeEngine.findingsFromReport(...args);

}


function validateAction(
    action
) {

    return actionKit.validateAction(action);
}

/*
|--------------------------------------------------------------------------
| OpenAI Tool Conversation
|--------------------------------------------------------------------------
*/

function appendToolConversation(...args) {

    return runtimeEngine.appendToolConversation(...args);

}


/*
|--------------------------------------------------------------------------
| Delegation Validation
|--------------------------------------------------------------------------
*/

/* A delegation that violates the profile policy (disabled, too deep, or too
   many children) is the model's decision, not a broken objective. It used to
   be thrown as a plain Error from the delegate branch, which is outside the
   malformed-response retry loop, so a single oversized delegation killed the
   whole run instead of being handed back to the model for correction. These
   are now model-response errors so the loop returns them to the model with
   the same retry budget as any other invalid action. */

function validateDelegationPolicy(...args) {

    return runtimeEngine.validateDelegationPolicy(...args);

}


/*
|--------------------------------------------------------------------------
| Delegation Depth Budget
|--------------------------------------------------------------------------
|
| An agent may delegate as deep as its own policy allows, but never
| deeper than the budget inherited from its parent or the runtime cap.
|--------------------------------------------------------------------------
*/

function resolveDepthBudget(...args) {

    return runtimeEngine.resolveDepthBudget(...args);

}


/*
|--------------------------------------------------------------------------
| Unfinished Final Detection
|--------------------------------------------------------------------------
*/

function isUnfinishedFinal(...args) {

    return runtimeEngine.isUnfinishedFinal(...args);

}


function failureSignature(...args) {

    return runtimeEngine.failureSignature(...args);

}


function trackRepeatedFailure(...args) {

    return runtimeEngine.trackRepeatedFailure(...args);

}


/*
| A run that dies on its deadline throws away whatever it had. The last
| slice of the budget is therefore reserved for finishing: the agent is
| told to stop exploring and answer with what it has, which turns a
| cancelled run into a partial result and a named next step.
*/

function wrapUpMessage(...args) {

    return runtimeEngine.wrapUpMessage(...args);

}


function loopNoticeMessage(...args) {

    return runtimeEngine.loopNoticeMessage(...args);

}


function planContinuationMessage(...args) {

    return runtimeEngine.planContinuationMessage(...args);

}


function nudgeMessage(...args) {

    return runtimeEngine.nudgeMessage(...args);

}


/*
|--------------------------------------------------------------------------
| Sub-Agent Messages
|--------------------------------------------------------------------------
*/

function createSubAgentMessages(
    agentDefinition,
    task,
    context
) {
    return promptFacade().subAgentMessages(
        agentDefinition,
        task,
        context,
        { project: effectiveProject(currentRun().project) }
    );
}


/*
|--------------------------------------------------------------------------
| Sub-Agent Runtime
|--------------------------------------------------------------------------
*/

/*
| A sub-agent that dies mid-run, on its iteration limit, on a repeated
| failure or on the deadline, used to leave its node in the console
| running for ever, because agent:end was only emitted on a final
| answer. Whatever happens, the node now closes.
*/

async function runSubAgent(...args) {

    return await runtimeEngine.runSubAgent(...args);

}


async function runSubAgentLoop(...args) {

    return await runtimeEngine.runSubAgentLoop(...args);

}


/*
|--------------------------------------------------------------------------
| Delegation Graph
|--------------------------------------------------------------------------
*/

async function executeDelegations(...args) {

    return await runtimeEngine.executeDelegations(...args);

}


/*
|--------------------------------------------------------------------------
| Deterministic Runtime Hooks
|--------------------------------------------------------------------------
*/

let HOOK_RUNNER = null;


function hookRunner() {

    if (!HOOK_RUNNER) {

        HOOK_RUNNER = new HookRunner({
            settings,
            registry: hookRegistry,
            events,
            currentRun,
            assertRunActive,
            cancelRun,
            cancelAllRuns,
            currentPlanSummary,
            detectRepository,
            toolRuntime,
            executeToolGraph,
            executeDependencyGraph,
            executeDelegations,
            resolveDepthBudget,
            toolRegistryOf: () => TOOL_REGISTRY_OF(),
            mainAgentProfile
        });
    }

    return HOOK_RUNNER;
}


/* Compatibility wrappers: the runtime host and public agent facade retain
   their historical hook function names while the implementation lives in
   agent/hooks/HookRunner.js. */
function hookExecutionContext(...args) {
    return hookRunner().executionContext(...args);
}


async function runHooks(...args) {
    return hookRunner().runHooks(...args);
}


function hookReportText(...args) {
    return hookRunner().hookReportText(...args);
}


async function applyAfterTaskHooks(...args) {
    return hookRunner().applyAfterTaskHooks(...args);
}


async function autoroutePlanStep(mainAgentDefinition) {

    if (
        settings.get("PLAN_AUTOROUTE") !== true ||
        currentRun().inHook
    ) {
        return null;
    }

    const planTools = require("./tools/planning");
    const summary = currentPlanSummary();
    const step = summary.next_step;

    if (!step || !step.agent || step.agent === "main_agent") {
        return null;
    }

    events.emit("plan:autoroute:start", {
        step: step.id,
        title: step.title,
        agent: step.agent
    });

    await planTools.plan_update({
        updates: [
            {
                id: step.id,
                status: "in_progress",
                evidence: `Automatically routed to ${step.agent}.`
            }
        ]
    });

    const results =
        await executeDelegations(
            [
                {
                    id: `autoroute_${step.id}`,
                    agent: step.agent,
                    persona: null,
                    skills: null,
                    tools: null,
                    task:
                        `Complete plan step ${step.id}: ${step.title}. ` +
                        `Objective: ${summary.objective}. Verify the work and report exact evidence.`,
                    depends_on: []
                }
            ],
            1,
            mainAgentDefinition,
            Math.max(0, resolveDepthBudget(
                mainAgentDefinition,
                settings.get("MAX_AGENT_DEPTH")
            ) - 1),
            "main_agent"
        );

    const delegated = results[0];
    const report = delegated?.result;
    const didWork =
        (report?.performed?.tools || 0) +
        (report?.performed?.delegations || 0) > 0;
    const ok = Boolean(
        delegated?.success &&
        report?.success &&
        !report?.error &&
        didWork
    );
    const evidence =
        ok
            ? report.response?.content || "Assigned agent completed the step."
            : !didWork && report?.success
                ? "Assigned agent returned without executing a tool or delegation; no runtime evidence was produced."
                : delegated?.error?.message || report?.error?.message || "Assigned agent failed.";

    await planTools.plan_update({
        updates: [
            {
                id: step.id,
                status: ok ? "done" : "blocked",
                evidence:
                    `PLAN_AUTOROUTE (${step.agent}): ${evidence}`
            }
        ]
    });

    const outcome = {
        step: step.id,
        agent: step.agent,
        ok,
        evidence,
        summary: currentPlanSummary()
    };

    events.emit("plan:autoroute:end", outcome);

    return outcome;
}


/*
|--------------------------------------------------------------------------
| Main Agent
|--------------------------------------------------------------------------
*/

/*
| Resolve the ProjectContext for one run (EXECUTION_PLAN, Phase 2).
|
| legacy mode (default): returns null and the run behaves exactly as
| before — project options are ignored, nothing looks at RUN.project.
|
| modular mode: the explicit option wins ({project, projectId}), else the
| default project; while the tool layer still reads the process-wide
| WORKSPACE_ROOT, a project rooted elsewhere fails loudly here instead of
| silently mis-scoping tool calls (the cross-root execution lands with
| the project-aware tool runtime in Phase 4).
*/
function resolveRunProjectContext(options) {

    return projects.resolveProjectForRun(options, {
        registry: projects.registry(),
        workspaceRoot: WORKSPACE_ROOT
    });

}

async function runAgentCore(...args) {

    return await runtimeEngine.runAgentCore(...args);

}


/*
| Canonical run variant (EXECUTION_PLAN Phase 3):
| the run gets its own AgentRunContext before anything starts, the whole
| core executes inside the run's async scopes, and two such calls may
| interleave without sharing messages, budgets or cancellation.
|
| The error path runs after-task hooks only when a run actually started;
| failures during context resolution or registry validation do not inherit
| them.
*/
async function runAgentModular(options = {}) {

    /* Resolved before the context is created so a bad project reference
       still fails fast and no half-built run is ever tracked. */
    const projectContext =
        resolveRunProjectContext(options);

    const context =
        runManager.createRun({
            task: options.task || "",
            parentRunId: options.parent_run_id || null,
            project: projectContext
        });

    const projectId =
        projectContext && projectContext.projectId
            ? projectContext.projectId
            : null;

    runManager.enqueue(context);

    try {

    return await runScheduler.schedule(projectId, () =>
        runManager.execute(context, async () => {

        try {
            return await runAgentCore(options);
        } catch (error) {

            if (
                context.started_at &&
                !context.after_hooks_ran
            ) {

                try {

                    const finalized =
                        await applyAfterTaskHooks(null, error);

                    const report =
                        hookReportText(finalized.report);

                    if (report) {
                        error.message = `${error.message}\n\nAutomated routine:\n${report}`;
                    }

                } catch (hookError) {

                    error.message =
                        `${error.message}\n\nafter_task hooks could not finish: ${hookError.message}`;
                }
            }

            /*
            | Single terminal path (audit REL-013): a model / tool / cancel /
            | hook exception ends the run with run:error - the event
            | Observability, the journal and the event store count. Without
            | it the run stays "active" forever and the failure never reaches
            | metrics. A run that already emitted run:end is not ended twice.
            */
            if (context.run_open) {

                context.run_open = false;

                events.emit("run:error", {
                    run_id: context.id,
                    message: error.message,
                    cancelled: isRunCancelled(),
                    code: error.name || "RUNTIME_ERROR"
                });
            }

            /* callers that emit their own terminal event must not double it */
            if (context.started_at) {
                error.runTerminalEmitted = true;
            }

            throw error;

        }

        /* Leaving the async scopes restores the correlation context:
           run-local state is restored by RunManager's async scope. */
    }), { runId: context.runId });

    } catch (error) {

        /* rejected or cancelled before it ever started: settle its
           bookkeeping (queue entry, id) exactly once */
        if (context.status === "queued") {
            runManager.abandon(context, error);
        }

        throw error;
    }
}


async function runAgent(options = {}) {

    return await runAgentModular(options);

}

/*
|--------------------------------------------------------------------------
| Main
|--------------------------------------------------------------------------
*/

async function main() {

    /*
    | An interrupt cancels the in-flight request, the tool graph, and
    | every running sub-agent instead of leaving orphans behind.
    */

    for (const signalName of ["SIGINT", "SIGTERM"]) {

        process.on(
            signalName,
            () => {

                console.error(
                    `\nReceived ${signalName}, cancelling run...`
                );

                cancelAllRuns(signalName.toLowerCase());

                toolRuntime.shutdown();

                setTimeout(
                    () => process.exit(130),
                    2000
                ).unref();
            }
        );
    }

    try {

        const result =
            await runAgent();

        /*
        | Background processes must not keep the runtime alive.
        */

        toolRuntime.shutdown();

        try {
            await eventstore.flush();
        } catch {
            /* a store flush must never hide the run result */
        }

        /*
        | A final action that carries an error is a failed run,
        | even though the agent loop itself completed.
        */

        process.exit(
            result?.error
                ? 1
                : 0
        );

    } catch (error) {

        toolRuntime.shutdown();

        try {
            await eventstore.flush();
        } catch {
            /* a store flush must never hide the run result */
        }

        console.error(
            "\nAgent failed:\n"
        );

        console.error(
            error
        );

        process.exit(1);
    }
}


application.bind({
    runAgent,
    main,
    tools: toolRuntime,
    eventstore,
    cancelRun
});


actionKit.bind({
    toolsOf: () => TOOLS_OF(),
    events,
    logLine
});

contextKit.bind({
    events,
    logLine,
    currentRun,
    assertRunActive,
    summariseTranscript,
    buildAgentRequest
});

runtimeEngine.bind({
    settings,
    events,
    logLine,
    logObject,
    LOG_STREAM,
    PRINT_FINAL,
    currentRun,
    AgentRunContext,
    currentAgentBudget,
    toolRuntime,
    POLICY_ENGINE,
    FILE_MUTATING_TOOLS,
    assertRunActive,
    runRemainingMs,
    keepDeclaredArguments,
    parseArguments,
    repairMarkdownPathArguments,
    enforceCrossProjectWrite,
    effectiveProject,
    effectiveProjectId,
    projectIdOf,
    runWithProject,
    noteDelegationProject,
    isMultiProjectTask,
    consumeAgentBudget,
    remainingAgentBudget,
    mayDelegate,
    resolveTools,
    resolveAgentCapabilities,
    resolveDelegationProfile,
    createSubAgentMessages,
    sendAgentRequest,
    readModelAction,
    isModelResponseError,
    malformedNoticeMessage,
    reportModelResponse,
    maintainContext,
    refreshRuntimeContext,
    roleForDepth,
    requestedDelegationProjectId,
    delegationProjectSwitchEnabled,
    projects,
    modelResponseError,
    compactConversation,
    findExchanges,
    archiveExchanges,
    startRun,
    resetAgentBudget,
    discoverMcpTools,
    loadRegistries,
    validateRegistries,
    createMainAgentMessages,
    readTask,
    runHooks,
    hookExecutionContext,
    applyAfterTaskHooks,
    hookReportText,
    autoroutePlanStep,
    AGENT_REGISTRY_OF,
    TOOL_REGISTRY_OF,
    mainAgentProfile,
    currentPlanSummary,
    resolveRunProjectContext
});


/*
|--------------------------------------------------------------------------
| Entry Point
|--------------------------------------------------------------------------
|
| The runtime only starts when executed directly, so the internals can
| be imported and tested. Bindings above must run first: the extracted
| engine (Phase 16) and context kit (Phase 17) read live closures
| through host() from the first line of runAgentCore / maintainContext.
|--------------------------------------------------------------------------
*/

if (require.main === module) {
    main();
}


module.exports = {
    runAgent: application.runAgent,
    main: application.main,

    /*
    | A plain model call through the role-based endpoint resolution,
    | with the runtime's retries and request budget. The discussion
    | engine and its callers use it instead of reimplementing fetch,
    | so personas and observer speak the same endpoint configuration
    | as every other agent.
    */
    callAI,

    parseStructuredResponse,
    adaptNativeToolCalls,
    parseToolArguments,
    repairStructuredAction,
    readModelAction,
    isModelResponseError,
    validateAction,
    validateRegistries,

    resolveArgumentReferences,
    isUnfinishedFinal,
    trackRepeatedFailure,
    normalizeToolCalls,
    executeDependencyGraph,

    resolveDepthBudget,
    validateDelegationPolicy,
    resolveDelegationProfile,
    resolveAgentProfile,
    resolveTools,

    mcp: require("./mcp/McpManager").manager,
    mcpToolDeclarations,
    discoverMcpTools,

    createRuntimeContext,
    detectRepository,
    refreshRepositoryContext,
    parseArguments,
    currentEndpoint,
    endpointFor,
    endpointOverview,
    roleForDepth,
    currentPlanSummary,
    currentPlanView,
    runHooks,
    hookRegistry,
    refreshRuntimeContext,
    maintainContext,
    foldIntoMemory,
    refreshMemoryMessage,
    memoryStore,
    project: require("./projects/WorkspaceProfile"),

    /*
    | Multi-project surface (Phase 2). Named `projects` to stay distinct
    | from the legacy workspace-profile module above; the boundary is
    | documented in EXECUTION_PLAN Phase 2 step 3.
    */
    projects,
    sessions: require("./persistence/SessionRepository"),
    eventstore: require("./persistence/EventStoreRepository"),
    openProject: () => require("./projects/WorkspaceProfile").openProject(),
    persistProject: () => require("./projects/WorkspaceProfile").persist(),
    summariseTranscript,
    activeTemperature,
    runDeadlineAt,
    events,
    journal,
    createMainAgentMessages,
    createSubAgentMessages,
    checkPerformedClaim,
    canModifyWorkspace,
    describeCapability,
    buildAgentSystemPrompt,

    /*
    | The canonical request body builder from agent/prompt/RequestBuilder.
    */
    buildAgentRequest,
    executionRules,
    filterExecutionRules,
    systemPrompt,
    readTask,
    setModelOverride,
    activeModel,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler,
    policyEngine: POLICY_ENGINE,
    approvalManager: POLICY_ENGINE.approvalManager,
    /*
    | A live view: reading a property reloads the file if it changed.
    */

    get registries() {

        return {
            TOOLS: TOOLS_OF(),
            TOOL_GROUPS: TOOL_GROUPS_OF(),
            SKILLS: SKILLS_OF(),
            AGENTS: AGENTS_OF(),
            PERSONAS: PERSONAS_OF(),
            POLICY: POLICY_OF(),
            HOOKS: hookRegistry.load()
        };
    },

    loadRegistries,
    registrySignature,
    appendToolConversation,
    conversationSize,
    compactConversation,

    startRun,
    cancelRun,
    isRunCancelled,
    runRemainingMs,
    assertRunActive,

    /*
    | Per-run context surface (Phase 3). Each caller can address one
    | specific run out of several concurrent executions.
    */
    AgentRunContext,
    runManager,
    runScheduler,
    observability,
    cancelRunById,
    cancelAllRuns,
    effectiveProject,
    effectiveProjectId,
    runWithProject,
    resolveRunProjectContext,
    isMultiProjectTask,

    settings,

    /*
    | Application / config / registry surface (Phase 14). Additive;
    | existing export names keep their signatures.
    */
    application,
    registryLoader,
    registryValidator,
    actions: actionKit,
    runtimeEngine,
    context: contextKit,
    hooks: hookRegistry,

    /*
    | Read through the store so a caller never caches a stale limit.
    */

    get limits() {

        return settings.snapshot();
    }
};
