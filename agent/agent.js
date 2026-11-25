const fs = require("fs");
const path = require("path");

const {
    capResult
} = require("./context/WorkspaceBoundary");

/*
| Loaded here, before the policy, events and project modules, as it always
| was; the binding itself is used by ./host.
*/
require("./tools");

const {
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

const { createEndpointProfiles } = require("./providers/EndpointProfiles");


journal.attach(events.bus);
eventstore.attach(events.bus);

const {
    conversationSize,
    compactConversation
} = require("./context");

const memoryStore = require("./context/Memory");

const hookRegistry = require("./hooks");

const application = require("./application");
const actionKit = require("./actions");
const runtimeEngine = require("./runtime/engine");
const contextKit = require("./context");
const registryLoader = require("./registry/RegistryLoader");
const registryValidator = require("./registry/RegistryValidator");

const createPromptWiring = require("./host/prompt-wiring");
const createLogging = require("./host/logging");
const createRegistries = require("./host/registries");
const createRuntimeContextKit = require("./host/runtime-context");
const createRunLifecycle = require("./host/run-lifecycle");
const createRunLimits = require("./host/run-limits");
const createProfiles = require("./host/profiles");
const createCapabilities = require("./host/capabilities");
const createToolGraph = require("./host/tool-graph");
const createModelRequests = require("./host/model-requests");
const createActionValidation = require("./host/action-validation");
const createHooks = require("./host/hooks");
const createRunAgent = require("./host/run-agent");
const bindKits = require("./host/bindings");


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
    getRunEffort: () => runManager.current()?.reasoningEffort || null,
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
| The runtime's helpers live in ./host. Each factory reads what it needs
| from `host` and adds what it returns; the calls below run in dependency
| order, at the place the code used to be.
*/
const host = {
    readText
};

Object.assign(host, {
    AgentRunContext,
    CONFIG_DIR,
    REGISTRY_DIR,
    RUNTIME_DIR,
    SCHEMA_DIR,
    effectiveProject,
    effectiveProjectId,
    endpointFor,
    endpointOverview,
    isMultiProjectTask,
    noteDelegationProject,
    projectIdOf,
    repositoryDetector,
    roleForDepth,
    runManager,
    runScheduler,
    runWithProject
});

Object.assign(host, createLogging(host));


const {
    AGENTS_OF,
    PERSONAS_OF,
    POLICY_ENGINE,
    POLICY_OF,
    SKILLS_OF,
    TOOLS_OF,
    TOOL_GROUPS_OF,
    executionRules,
    filterExecutionRules,
    loadRegistries,
    registrySignature,
    systemPrompt
} = Object.assign(host, createRegistries(host));


const {
    createRuntimeContext,
    currentPlanSummary,
    currentPlanView,
    detectRepository,
    foldIntoMemory,
    maintainContext,
    refreshMemoryMessage,
    refreshRepositoryContext,
    refreshRuntimeContext,
    summariseTranscript,
    validateRegistries
} = Object.assign(host, createRuntimeContextKit(host));


const {
    assertRunActive,
    isRunCancelled,
    runRemainingMs
} = Object.assign(host, createRunLimits(host));

const {
    cancelAllRuns,
    cancelRun,
    cancelRunById,
    runDeadlineAt,
    startRun
} = Object.assign(host, createRunLifecycle(host));


const {
    buildAgentRequest,
    buildAgentSystemPrompt,
    discoverMcpTools,
    mcpToolDeclarations,
    resolveAgentProfile,
    resolveDelegationProfile,
    resolveTools
} = Object.assign(host, createProfiles(host));


Object.assign(host, createPromptWiring(host));

const {
    canModifyWorkspace,
    checkPerformedClaim,
    createMainAgentMessages,
    describeCapability,
    readTask
} = Object.assign(host, createCapabilities(host));


const {
    callAI,
    executeDependencyGraph,
    normalizeToolCalls,
    parseArguments,
    resolveArgumentReferences
} = Object.assign(host, createToolGraph(host));


const {
    isModelResponseError,
    parseToolArguments,
    readModelAction,
    repairStructuredAction,
    responseFormatAllowed,
    schemaKeyFor
} = Object.assign(host, createModelRequests(host));


const {
    adaptNativeToolCalls,
    appendToolConversation,
    createSubAgentMessages,
    isUnfinishedFinal,
    parseStructuredResponse,
    resolveDepthBudget,
    trackRepeatedFailure,
    validateAction,
    validateDelegationPolicy
} = Object.assign(host, createActionValidation(host));


const {
    resolveRunProjectContext,
    runHooks
} = Object.assign(host, createHooks(host));


const {
    main
} = Object.assign(host, createRunAgent(host));


Object.assign(host, bindKits(host));


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
