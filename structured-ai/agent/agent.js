const fs = require("fs");
const path = require("path");

const {
    WORKSPACE_ROOT,
    capResult
} = require("./lib/workspace");

const toolRuntime = require("./tools");

const {
    PolicyEngine,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler
} = require("./lib/policy");

const events = require("./lib/events");

const settings = require("./lib/storage");
const journal = require("./lib/journal");
const eventstore = require("./lib/eventstore");

const projects = require("./projects");

const projectRuntime = require("./runtime");

const {
    AgentRunContext,
    runManager,
    runContextMode,
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

/*
| Prompt kit wiring (EXECUTION_PLAN Phase 5). The injected builders and
| resolvers are created lazily on first use: every dependency they take
| is a closure over live registry/settings/run state, so nothing ages,
| and in PROMPT_BUILDER_MODE=legacy they are never constructed at all.
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


function promptBuilderMode() {

    return promptKit.promptBuilderMode();

}

journal.attach(events.bus);
eventstore.attach(events.bus);

const {
    conversationSize,
    compactConversation,
    findExchanges
} = require("./lib/context");

const memoryStore = require("./lib/memory");

const {
    _skillIndex: skillIndex,
    _isActiveSkill: isActiveSkill
} = require("./tools/skills");

const archive = require("./lib/archive");
const hookRegistry = require("./lib/hooks");

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


function currentBaseUrl() {

    return (
        settings.get("AGENT_BASE_URL") ||
        DEFAULT_BASE_URL
    );
}

function currentEndpoint() {

    return `${currentBaseUrl()}/chat/completions`;
}

function currentApiKey() {

    return settings.get("AGENT_API_KEY");
}


/*
|--------------------------------------------------------------------------
| Endpoint Profiles
|--------------------------------------------------------------------------
|
| Each role can talk to its own endpoint with its own key, model and
| temperature: a strong model for the orchestrator, cheaper ones deeper
| in the tree, and a small fast one for summarising. Anything left empty
| inherits, so a single AGENT_BASE_URL still configures everything.
|--------------------------------------------------------------------------
*/

const ROLES = ["MAIN", "L1", "L2", "L3", "SUMMARY"];


function roleForDepth(depth) {

    if (!depth || depth < 1) {
        return "MAIN";
    }

    return depth >= 3
        ? "L3"
        : `L${depth}`;
}


function endpointFor(role, agentDefinition) {

    const name =
        ROLES.includes(role)
            ? role
            : "MAIN";

    const baseUrl =
        settings.get(`ENDPOINT_${name}_BASE_URL`) ||
        currentBaseUrl();

    const apiKey =
        settings.get(`ENDPOINT_${name}_API_KEY`) ||
        currentApiKey();

    const roleModel =
        settings.get(`ENDPOINT_${name}_MODEL`);

    const roleTemperature =
        settings.get(`ENDPOINT_${name}_TEMPERATURE`);

    return {
        role: name,

        base_url: baseUrl,

        endpoint: `${baseUrl}/chat/completions`,

        api_key: apiKey,

        model:
            roleModel ||
            activeModel(agentDefinition),

        temperature:
            roleTemperature >= 0
                ? roleTemperature
                : activeTemperature(agentDefinition)
    };
}


function endpointOverview() {

    return ROLES.map(role => {

        const resolved =
            endpointFor(role, null);

        return {
            role,

            model: resolved.model,

            temperature: resolved.temperature,

            base_url: resolved.base_url,

            inherits:
                settings.get(`ENDPOINT_${role}_BASE_URL`) === "",

            /*
            | Whether this endpoint is still being sent the response
            | schema. It stops once the endpoint has rejected it, and the
            | agent should know which contract it is answering under.
            */

            sends_schema:
                responseFormatAllowed(
                    schemaKeyFor(resolved, role)
                )
        };
    });
}


/*
| A model chosen at runtime, from the console or a session command,
| outranks the model named by a profile. Otherwise the profile wins and
| the configured default is the fallback.
*/

function setModelOverride(model) {

    if (!model) {

        if (settings.sourceOf("AGENT_MODEL") === "override") {
            settings.reset("AGENT_MODEL");
        }

        return settings.get("AGENT_MODEL");
    }

    return settings.set("AGENT_MODEL", model);
}


function activeTemperature(agentDefinition) {

    if (settings.sourceOf("AGENT_TEMPERATURE") === "override") {
        return settings.get("AGENT_TEMPERATURE");
    }

    return (
        agentDefinition && agentDefinition.temperature !== undefined &&
        agentDefinition.temperature !== null
            ? agentDefinition.temperature
            : settings.get("AGENT_TEMPERATURE")
    );
}


function activeModel(agentDefinition) {

    if (settings.sourceOf("AGENT_MODEL") === "override") {
        return settings.get("AGENT_MODEL");
    }

    return (
        (agentDefinition && agentDefinition.model) ||
        settings.get("AGENT_MODEL")
    );
}


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

    LOG_STREAM(
        `${logScope(scope)} ${label}:\n${
            JSON.stringify(
                value,
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

const TEXT_CACHE = new Map();


function readTextLive(filePath) {

    let stamp = "missing";

    try {

        const stats = fs.statSync(filePath);

        stamp = `${stats.mtimeMs}:${stats.size}`;

    } catch {

        /* fall through and let readText report it */
    }

    const cached = TEXT_CACHE.get(filePath);

    if (
        cached &&
        cached.stamp === stamp
    ) {
        return cached.text;
    }

    const text = readText(filePath);

    TEXT_CACHE.set(filePath, { stamp, text });

    return text;
}


/*
| The rules are shared by every agent, but not every rule applies to
| every agent: git_analysis has no plan tools and was still told, in
| 1,424 characters of every request, how to keep a plan. A section may
| therefore declare what it needs:
|
|   PLAN AND PROGRESS [needs: plan_get, plan_update]
|
| The marker never reaches the model, and a section with no marker is
| always included, so the default stays "everyone reads everything".
| Which tools an agent has is what decides, and the special condition
| "approval" means it holds a tool the policy does not simply allow.
*/

const RULE_MARKER =
    /^([A-Z][A-Z ]*?)\s*\[needs:\s*([^\]]+)\]\s*$/;


function ruleSectionApplies(condition, toolNames, hasGatedTool) {

    const wanted =
        condition.split(",").map(item => item.trim()).filter(Boolean);

    return wanted.some(need => {

        if (need === "approval") {
            return hasGatedTool;
        }

        return toolNames.includes(need);
    });
}


function filterExecutionRules(text, toolNames, hasGatedTool) {

    const lines = text.split("\n");

    const output = [];

    let skipping = false;

    for (const line of lines) {

        const match = RULE_MARKER.exec(line);

        if (match) {

            skipping =
                !ruleSectionApplies(
                    match[2],
                    toolNames,
                    hasGatedTool
                );

            if (!skipping) {

                /* the condition is bookkeeping, not instruction */
                output.push(match[1]);
            }

            continue;
        }

        /*
        | A section ends at the next unmarked heading, which is a line
        | of capitals on its own.
        */

        if (
            skipping &&
            /^[A-Z][A-Z ]+$/.test(line) &&
            line.trim() !== ""
        ) {
            skipping = false;
        }

        if (!skipping) {
            output.push(line);
        }
    }

    return output.join("\n").replace(/\n{4,}/g, "\n\n\n");
}


function executionRules(agentDefinition) {

    const text =
        readTextLive(
            path.join(CONFIG_DIR, "execution_rules.txt")
        );

    if (!agentDefinition) {

        return filterExecutionRules(
            text,
            TOOLS_OF().map(tool => tool.function.name),
            true
        );
    }

    const toolNames =
        resolveTools(agentDefinition.tools).map(
            tool => tool.function.name
        );

    const hasGatedTool =
        toolNames.some(
            name =>
                POLICY_ENGINE.evaluate(name, {}, agentDefinition.name)
                    .decision !== "allow"
        );

    return filterExecutionRules(
        text,
        toolNames,
        hasGatedTool
    );
}


function systemPrompt() {

    return readTextLive(
        path.join(CONFIG_DIR, "system_prompt.txt")
    );
}


function schemaFileName() {

    return settings.get("AGENT_SCHEMA") === "strict"
        ? "response_format.strict.json"
        : "response_format.json";
}


const REGISTRY_FILES = {
    PERSONAS: path.join(REGISTRY_DIR, "personas.json"),
    SKILLS: path.join(REGISTRY_DIR, "skills.json"),
    TOOLS: path.join(REGISTRY_DIR, "tools.json"),
    TOOL_GROUPS: path.join(REGISTRY_DIR, "tool_groups.json"),
    POLICY: path.join(REGISTRY_DIR, "policy.json"),
    AGENTS: path.join(REGISTRY_DIR, "agents.json"),
    RESPONSE_FORMAT: path.join(SCHEMA_DIR, schemaFileName()),
    CONFIGURED_RUNTIME: path.join(RUNTIME_DIR, "runtime_context.json")
};

const REGISTRY = {
    loaded_at: 0,
    signature: null,
    data: {}
};


function registryFiles() {

    return {
        ...REGISTRY_FILES,

        RESPONSE_FORMAT:
            path.join(SCHEMA_DIR, schemaFileName())
    };
}


function registrySignature() {

    return registryLoader.signatureOf(schemaFileName());

}


function loadRegistries(force) {

    const signature =
        registrySignature();

    if (
        !force &&
        REGISTRY.signature === signature
    ) {
        return REGISTRY.data;
    }

    const data =
        registryLoader.load(schemaFileName());

    data.PERSONA_REGISTRY =
        new Map(
            data.PERSONAS.map(
                persona => [persona.name, persona]
            )
        );

    data.SKILL_REGISTRY =
        SkillRegistry.fromList(data.SKILLS);

    data.TOOL_REGISTRY =
        ToolRegistry.fromList(data.TOOLS);

    data.AGENT_REGISTRY =
        AgentRegistry.fromList(data.AGENTS);

    REGISTRY.data = data;
    REGISTRY.signature = signature;
    REGISTRY.loaded_at = Date.now();

    if (POLICY_ENGINE_HOLDER.engine) {

        POLICY_ENGINE_HOLDER.engine.reload({
            policy: data.POLICY,
            toolGroups: data.TOOL_GROUPS
        });
    }

    events.emit("registry:loaded", {
        at: REGISTRY.loaded_at,
        forced: Boolean(force)
    });

    return data;
}


const POLICY_ENGINE_HOLDER = {
    engine: null
};


/*
| Named accessors so call sites read the current registry rather than a
| value captured when this module was first required.
*/

const registry = () => loadRegistries(false);

const PERSONAS_OF = () => registry().PERSONAS;
const SKILLS_OF = () => registry().SKILLS;
const TOOLS_OF = () => registry().TOOLS;
const TOOL_GROUPS_OF = () => registry().TOOL_GROUPS;
const POLICY_OF = () => registry().POLICY;
const AGENTS_OF = () => registry().AGENTS;
const RESPONSE_FORMAT_OF = () => registry().RESPONSE_FORMAT;
const CONFIGURED_RUNTIME_OF = () => registry().CONFIGURED_RUNTIME;
const PERSONA_REGISTRY_OF = () => registry().PERSONA_REGISTRY;
const SKILL_REGISTRY_OF = () => registry().SKILL_REGISTRY;
const TOOL_REGISTRY_OF = () => registry().TOOL_REGISTRY;
const AGENT_REGISTRY_OF = () => registry().AGENT_REGISTRY;


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

    const problems = [];

    for (const tool of TOOLS_OF()) {

        if (tool?.type !== "function") {

            problems.push(
                "tools.json contains an entry that is not a function tool."
            );

            continue;
        }

        if (!toolRuntime.hasTool(tool.function.name)) {

            problems.push(
                `Tool "${tool.function.name}" is declared in tools.json but has no implementation.`
            );
        }
    }

    for (const name of toolRuntime.implementedToolNames()) {

        if (!TOOL_REGISTRY_OF().has(name)) {

            problems.push(
                `Tool "${name}" is implemented but not declared in tools.json.`
            );
        }
    }

    /*
    | An MCP tool is declared by the server that offers it, not by this
    | repository, so it is deliberately absent from tools.json and the
    | two checks above must not look for it there.
    */

    for (
        const [group, definition]
        of Object.entries(TOOL_GROUPS_OF())
    ) {

        for (const name of definition.tools) {

            if (!TOOL_REGISTRY_OF().has(name)) {

                problems.push(
                    `Tool group "${group}" references unknown tool "${name}".`
                );
            }
        }
    }

    for (const rule of POLICY_OF().rules || []) {

        for (const name of rule.tools || []) {

            if (
                !name.includes("*") &&
                !TOOL_REGISTRY_OF().has(name)
            ) {

                problems.push(
                    `Policy rule "${rule.id}" references unknown tool "${name}".`
                );
            }
        }

        for (const group of rule.groups || []) {

            if (!TOOL_GROUPS_OF()[group]) {

                problems.push(
                    `Policy rule "${rule.id}" references unknown tool group "${group}".`
                );
            }
        }

        if (
            ![
                "allow",
                "deny",
                "require_approval"
            ].includes(rule.action)
        ) {

            problems.push(
                `Policy rule "${rule.id}" has an unknown action "${rule.action}".`
            );
        }
    }

    for (const skill of SKILLS_OF()) {

        for (const name of skill.tools || []) {

            if (!TOOL_REGISTRY_OF().has(name)) {

                problems.push(
                    `Skill "${skill.name}" references unknown tool "${name}".`
                );
            }
        }
    }

    for (const agent of AGENTS_OF()) {

        if (
            agent.persona &&
            !PERSONA_REGISTRY_OF().has(agent.persona)
        ) {

            problems.push(
                `Agent "${agent.name}" references unknown persona "${agent.persona}".`
            );
        }

        for (const name of agent.skills || []) {

            if (!SKILL_REGISTRY_OF().has(name)) {

                problems.push(
                    `Agent "${agent.name}" references unknown skill "${name}".`
                );
            }
        }

        if (agent.tools !== "*") {

            for (const name of agent.tools || []) {

                if (!TOOL_REGISTRY_OF().has(name)) {

                    problems.push(
                        `Agent "${agent.name}" references unknown tool "${name}".`
                    );
                }
            }
        }
    }

    if (problems.length > 0) {

        throw new Error(
            `Registry validation failed:\n- ${problems.join("\n- ")}`
        );
    }
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

    const detectRoot = root || WORKSPACE_ROOT;

    const declared =
        CONFIGURED_RUNTIME_OF().repository || {};

    const run = argv => {

        try {

            return require("child_process")
                .execFileSync(
                    "git",
                    argv,
                    {
                        cwd: detectRoot,
                        stdio: ["ignore", "pipe", "ignore"],
                        timeout: settings.get("REPO_DETECT_TIMEOUT_MS")
                    }
                )
                .toString()
                .trim();

        } catch {

            return null;
        }
    };

    const toplevel =
        run(["rev-parse", "--show-toplevel"]);

    if (!toplevel) {

        return {
            ...declared,

            type: "none",

            available: false,

            root: null
        };
    }

    const status =
        run(["status", "--porcelain"]);

    return {
        ...declared,

        type: "git",

        available: true,

        root: toplevel,

        is_workspace_root:
            toplevel === detectRoot,

        branch:
            run(["rev-parse", "--abbrev-ref", "HEAD"]),

        head:
            run(["rev-parse", "--short", "HEAD"]),

        clean:
            status === "",

        changed_files:
            status
                ? status.split("\n").length
                : 0
    };
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


async function maintainContext(messages, scope) {

    return contextKit.maintainContext(messages, scope);

}


function refreshRuntimeContext(messages) {

    if (promptBuilderMode() === "modular") {

        return promptFacade().refreshRuntimeContext(messages);

    }


    for (const message of messages) {

        if (
            message.role !== "system" ||
            typeof message.content !== "string" ||
            !message.content.startsWith("{")
        ) {
            continue;
        }

        let parsed;

        try {

            parsed = JSON.parse(message.content);

        } catch {

            continue;
        }

        if (parsed.type !== "runtime_context") {
            continue;
        }

        message.content =
            JSON.stringify({
                type: "runtime_context",

                context: createRuntimeContext()
            });

        return true;
    }

    return false;
}


function currentPlanSummary() {

    try {

        const plan = require("./tools/plan");

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

        const planTools = require("./tools/plan");
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

    if (promptBuilderMode() === "modular") {

        return promptFacade().runtimeContextMessage();

    }


    return {
        ...CONFIGURED_RUNTIME_OF(),

        environment:
            detectEnvironment(),

        repository:
            detectRepository(),

        workspace: {
            ...(CONFIGURED_RUNTIME_OF().workspace || {}),

            root:
                WORKSPACE_ROOT
        },

        /*
        | The group catalogue used to travel here as well: 2.7K
        | characters describing tools whose full schemas are already in
        | the request. Groups are how the policy reasons, not how the
        | agent calls anything, so what the agent needs is the policy
        | summary below, not the taxonomy behind it.
        */

        plan:
            currentPlanSummary(),

        memory: {
            enabled:
                settings.get("MEMORY_ENABLED") === true,

            size_chars:
                memoryStore.memorySize(memoryStore.loadMemory()),

            chunk_chars:
                settings.get("MEMORY_CHUNK_CHARS"),

            max_summary_calls:
                settings.get("MEMORY_MAX_SUMMARY_CALLS"),

            summary_parallelism:
                settings.get("MEMORY_SUMMARY_PARALLELISM")
        },

        /*
        | The agent is told how much history is retrievable, otherwise
        | it has no reason to search an archive it cannot see.
        */

        archive:
            archive.stats(),

        policy:
            POLICY_ENGINE.summary(),

        endpoints:
            endpointOverview(),

        runtime: {
            workspace_root:
                WORKSPACE_ROOT,

            max_iterations:
                settings.get("MAX_ITERATIONS"),

            max_agent_depth:
                settings.get("MAX_AGENT_DEPTH"),

            max_parallel_tools:
                settings.get("MAX_PARALLEL_TOOLS"),

            max_parallel_agents:
                settings.get("MAX_PARALLEL_AGENTS"),

            max_total_agents:
                settings.get("MAX_TOTAL_AGENTS"),

            agents_spawned:
                currentAgentBudget().spawned,

            agents_remaining:
                Math.max(
                    0,
                    settings.get("MAX_TOTAL_AGENTS") - currentAgentBudget().spawned
                ),

            iterations_per_agent:
                settings.get("MAX_ITERATIONS"),

            max_run_ms:
                settings.get("MAX_RUN_MS"),

            max_request_ms:
                settings.get("MAX_REQUEST_MS"),

            max_context_chars:
                settings.get("MAX_CONTEXT_CHARS"),

            run_remaining_ms:
                currentRun().started_at
                    ? Math.max(0, runRemainingMs())
                    : settings.get("MAX_RUN_MS")
        },

        /*
        | Which external servers this run can reach. Named rather than
        | counted, because an agent that knows a "github" server exists
        | asks it something; one told there are two servers does not.
        */

        mcp:
            mcpContext()
    };
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

    currentRun().controller = new AbortController();
    currentRun().cancelled_reason = null;
    currentRun().inHook = false;
    currentRun().hook_phase = null;
    currentRun().hook_started_at = 0;
    currentRun().hook_deadline_at = null;
    currentRun().hook_results = {};
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
| Cancellation addressable by run id (RUN_CONTEXT_MODE=modular). A
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

    if (
        !context.controller ||
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

/*
| The tools an MCP server offers are not in tools.json, because the
| server is what declares them and it may not have been running when
| this process started. They are resolved from the live catalogue and
| only when the runtime is set to declare them by name.
*/

function mcpToolDeclarations() {

    if (settings.get("MCP_EXPOSE_TOOLS") === "gateway") {
        return [];
    }

    try {

        return toolRuntime
            .mcpToolDeclarations()
            .slice(0, settings.get("MCP_MAX_TOOLS"));

    } catch {

        return [];
    }
}


function mcpToolRegistry() {

    /* Moved to agent/prompt/ToolResolver.js (Phase 5). */
    return toolResolver().mcpRegistry();
}


/*
| Contacting the configured servers once, at the start of a run. It
| never rejects: a server that is down is a capability this run does
| not have, which the model is told about through mcp_servers, and not
| a reason for the run to fail before it began.
*/

async function discoverMcpTools() {

    if (
        settings.get("MCP_ENABLED") === false ||
        settings.get("MCP_AUTO_DISCOVER") === false
    ) {
        return [];
    }

    try {

        const discovered =
            await toolRuntime.discoverMcpTools();

        if (discovered.length > 0) {

            logLine(
                "main_agent",
                `${discovered.length} MCP tool(s) available from ${
                    new Set(discovered.map(entry => entry.server)).size
                } server(s).`
            );
        }

        return discovered;

    } catch (error) {

        logLine(
            "main_agent",
            `MCP discovery failed: ${error.message}`
        );

        return [];
    }
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

function resolvePersona(personaName) {

    if (!personaName) {
        return null;
    }

    const persona =
        PERSONA_REGISTRY_OF().get(
            personaName
        );

    if (!persona) {

        throw new Error(
            `Unknown persona: ${personaName}`
        );
    }

    return persona;
}


/*
|--------------------------------------------------------------------------
| Agent Profile Resolution
|--------------------------------------------------------------------------
*/

function resolveAgentProfile(
    agentName
) {

    const agent =
        AGENT_REGISTRY_OF().get(
            agentName
        );

    if (!agent) {

        throw new Error(
            `Unknown agent profile: ${agentName}`
        );
    }

    return agent;
}


/*
|--------------------------------------------------------------------------
| Ad-Hoc Agent Profile
|--------------------------------------------------------------------------
|
| A delegation may either reference a registered Agent Profile:
|
|     { "agent": "code_analysis" }
|
| or compose a new one from the registries:
|
|     { "persona": "code_architect",
|       "skills": ["codebase_analysis"],
|       "tools": ["fs_read", "search_start"] }
|
| An ad-hoc profile can never exceed the tools of the agent that
| created it, and is never allowed to delegate further.
|--------------------------------------------------------------------------
*/

function buildAdHocProfile(
    delegation,
    parentAllowedTools
) {

    const persona =
        resolvePersona(
            delegation.persona
        );

    if (!persona) {

        throw new Error(
            `An ad-hoc delegation requires either an agent profile or a persona. Personas: ${
                [...PERSONA_REGISTRY_OF().keys()].sort().join(", ")
            }.`
        );
    }

    const requestedTools =
        Array.isArray(delegation.tools)
            ? delegation.tools
            : [];

    for (
        const toolName
        of requestedTools
    ) {

        if (
            !TOOL_REGISTRY_OF().has(toolName) &&
            !toolRuntime.mcp._hasDiscoveredTool(toolName)
        ) {

            /*
            | Naming what exists costs nothing here and saves the agent
            | an iteration of guessing. A run once died on "fs_search",
            | a name this project's own prompt used to suggest.
            */

            throw new Error(
                `Tool is not available: ${toolName}. The tools that exist are: ${
                    [
                        ...TOOL_REGISTRY_OF().keys(),
                        ...toolRuntime.mcp._discoveredToolNames()
                    ].sort().join(", ")
                }.`
            );
        }

        if (
            !parentAllowedTools.has(
                toolName
            )
        ) {

            throw new Error(
                `Ad-hoc agent cannot be granted "${toolName}" because the delegating agent does not have it. It may be given any of: ${
                    [...parentAllowedTools].sort().join(", ")
                }.`
            );
        }
    }

    const requestedSkills =
        Array.isArray(delegation.skills)
            ? delegation.skills
            : [];

    for (
        const skillName
        of requestedSkills
    ) {

        if (!SKILL_REGISTRY_OF().has(skillName)) {

            throw new Error(
                `Unknown skill: ${skillName}. The skills that exist are: ${
                    [...SKILL_REGISTRY_OF().keys()].sort().join(", ")
                }.`
            );
        }
    }

    return {
        name:
            `adhoc:${persona.name}`,

        description:
            `Ad-hoc agent composed from persona "${persona.name}".`,

        persona:
            persona.name,

        skills:
            requestedSkills,

        tools:
            requestedTools,

        output_contract: [
            "Report only results confirmed by runtime execution."
        ],

        delegation: {
            enabled: false,
            max_depth: 0,
            max_children: 0
        }
    };
}


function resolveDelegationProfile(
    delegation,
    parentAllowedTools
) {

    if (delegation.agent) {

        return resolveAgentProfile(
            delegation.agent
        );
    }

    return buildAdHocProfile(
        delegation,
        parentAllowedTools
    );
}


/*
|--------------------------------------------------------------------------
| Agent Capabilities
|--------------------------------------------------------------------------
*/

function resolveAgentCapabilities(
    agentDefinition
) {

    const persona =
        resolvePersona(
            agentDefinition.persona
        );

    const skills =
        resolveSkills(
            agentDefinition.skills
        );

    const tools =
        resolveTools(
            agentDefinition.tools
        );

    return {
        persona,
        skills,
        tools
    };
}


/*
|--------------------------------------------------------------------------
| Agent System Prompt
|--------------------------------------------------------------------------
*/

function buildAgentSystemPrompt(
    agentDefinition
) {

    if (promptBuilderMode() === "modular") {

        return promptFacade().subAgentSystemPrompt(agentDefinition);

    }


    const capabilities =
        resolveAgentCapabilities(
            agentDefinition
        );

    const personaText =
        capabilities.persona?.system_prompt ||
        "";

    return [
        personaText,

        executionRules(agentDefinition),

        {
            type: "agent_runtime_rules",

            rules: [
                "You are an Agent inside a hierarchical Agent Runtime.",
                "You were given one task by a parent agent; complete that task and report back.",
                "Use only the tools provided by the runtime.",
                "Use only the skills assigned to your Agent Profile.",
                "Return your findings with the final action; the parent agent sees only that response.",
                "Never fabricate tool results.",
                "Never claim an operation succeeded unless runtime results confirm it."
            ]
        },

        /*
        | A specialist's own skills are its job, so they are in its
        | prompt by default: two to five of them, and one skipped
        | skill_get would cost it the expertise it was created for.
        | SKILLS_INLINE_FOR_SUBAGENTS trades that for the index when the
        | tokens matter more.
        */

        {
            type: "skills",

            note:
                settings.get("SKILLS_INLINE_FOR_SUBAGENTS") === true
                    ? undefined
                    : "Names only. Read one with skill_get before doing that kind of work.",

            skills:
                settings.get("SKILLS_INLINE_FOR_SUBAGENTS") === true
                    ? capabilities.skills
                    : capabilities.skills.map(
                        skill => ({
                            name: skill.name,
                            description: skill.description
                        })
                    )
        },

        {
            type: "output_contract",

            output_contract:
                agentDefinition.output_contract ||
                [
                    "Report only results confirmed by runtime execution."
                ]
        },

        {
            type: "delegation_policy",
            delegation:
                agentDefinition.delegation ||
                {
                    enabled: false,
                    max_depth: 0,
                    max_children: 0
                }
        }
    ]
        .map(
            item =>
                typeof item === "string"
                    ? item
                    : JSON.stringify(item)
        )
        .join("\n\n");
}


/*
|--------------------------------------------------------------------------
| Agent Request Builder
|--------------------------------------------------------------------------
*/

function buildAgentRequest(options) {

    /* Phase 5: the modular RequestBuilder produces the same body from
       injected closures. */
    if (promptBuilderMode() === "modular") {

        return promptFacade().request(options);

    }

    const {
        messages,
        agentDefinition,
        tools,
        responseFormat,
        role,
        withSchema = true
    } = options;

    const profile =
        endpointFor(role, agentDefinition);

    if (responseFormat === null) {

        /*
        | A plain completion, used by the summariser.
        */

        const request = {
            model:
                profile.model,

            messages,

            temperature:
                agentDefinition &&
                agentDefinition.temperature !== undefined
                    ? agentDefinition.temperature
                    : profile.temperature
        };

        if (
            agentDefinition &&
            agentDefinition.max_tokens
        ) {
            request.max_tokens = agentDefinition.max_tokens;
        }

        return request;
    }

    const request = {
        model:
            profile.model,

        messages,

        temperature:
            profile.temperature,

        tools,

        parallel_tool_calls:
            true
    };

    /*
    | The schema is sent unless this endpoint has already refused it.
    | Without it the model still has the contract in its instructions,
    | and the parser accepts a native tool call either way.
    */

    if (withSchema) {

        request.response_format =
            RESPONSE_FORMAT_OF();
    }

    /*
    | Left out by default, because a gateway that caps the answer for us
    | is easier to see than a ceiling we set silently. When an answer is
    | being cut off mid-write, this is the knob that fixes it.
    */

    const ceiling =
        settings.get("MAX_RESPONSE_TOKENS");

    if (ceiling > 0) {
        request.max_tokens = ceiling;
    }

    return request;
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


/* Phase 12: extra approval for writes that leave the Sub-Agent's
   project or that happen inside a task that already spans more than
   one project. Policy's own decision (if any) still runs first. */
async function enforceCrossProjectWrite(toolName, args, agent) {

    if (!delegationProjectSwitchEnabled()) {
        return null;
    }

    if (!FILE_MUTATING_TOOLS.includes(toolName)) {
        return null;
    }

    const run = currentRun();

    const effective = effectiveProject(run.project);

    const effectiveId =
        projectIdOf(effective) || run.projectId || null;

    const parentId =
        run.projectId || projectIdOf(run.project) || null;

    const cross =
        Boolean(effectiveId && parentId && effectiveId !== parentId);

    const multi = isMultiProjectTask(run);

    if (!cross && !multi) {
        return null;
    }

    const evaluation = {
        tool: toolName,
        agent: agent || "main_agent",
        groups: POLICY_ENGINE.groupsFor(toolName),
        decision: "require_approval",
        reason:
            cross
                ? `cross-project write on "${effectiveId}" (run project is "${parentId}")`
                : `write in a multi-project task (project "${effectiveId || parentId}")`,
        rule:
            cross
                ? "cross_project_write"
                : "multi_project_write",
        project_id: effectiveId
    };

    const approval =
        await POLICY_ENGINE.requestApproval(evaluation, args);

    POLICY_ENGINE.onDecision({
        ...evaluation,
        approved: approval.approved,
        approval_mode: approval.mode,
        gateway_cached: approval.gateway_cached === true
    });

    return approval;

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

    /* Phase 5: the injected builders assemble the same messages; the
       legacy branch below stays the reference until rollout. */
    if (promptBuilderMode() === "modular") {

        return promptFacade().mainMessages(task, {
            project: effectiveProject(currentRun().project)
        });

    }


    return [

        {
            role: "system",
            content:
                systemPrompt()
        },

        {
            role: "system",
            content:
                executionRules()
        },

        {
            role: "system",
            content:
                JSON.stringify({
                    type:
                        "runtime_context",

                    context:
                        createRuntimeContext()
                })
        },

        {
            role: "system",
            content:
                JSON.stringify({
                    type:
                        "available_skills",

                    note:
                        "Names and descriptions only. Call skill_get before doing that kind of work to read its procedure and constraints.",

                    skills:
                        skillIndex()
                })
        },

        /*
        | Personas exist so an ad-hoc agent can be composed. An agent
        | that may not delegate has no use for the catalogue, so it is
        | added below only when it can.
        |
        | Discussion personas are left out on purpose: they are not
        | delegation targets, they are run by the discussion engine
        | through discussion_start, and advertising all sixteen of
        | them would tax every request for a flow the orchestrator
        | reaches with a single tool call.
        */

        mayDelegate(mainAgentProfile())
            ? {
                role: "system",
                content:
                    JSON.stringify({
                        type:
                            "available_personas",

                        note:
                            "For composing an ad-hoc agent when no profile fits.",

                        personas:
                            PERSONAS_OF()
                                .filter(
                                    persona =>
                                        !discussionPersonaNames().has(
                                            persona.name
                                        )
                                )
                                .map(
                                    persona => ({
                                        name:
                                            persona.name,

                                        description:
                                            persona.description
                                    })
                                )
                    })
            }
            : null,

        {
            role: "system",
            content:
                JSON.stringify({
                    type:
                        "available_agents",

                    agents:
                        AGENTS_OF()
                            .filter(
                                agent =>
                                    agent.name !==
                                        "main_agent" &&
                                    !agent.name.startsWith(
                                        "discussion_"
                                    )
                            )
                            .map(
                            /*
                            | What choosing a specialist needs: what it
                            | is for and what it is allowed to do. Its
                            | output contract, its skills and its tool
                            | list are the sub-agent's own business, and
                            | were 3K characters of every request.
                            */

                            agent => ({
                                name:
                                    agent.name,

                                description:
                                    agent.description,

                                ...describeCapability(agent),

                                can_delegate:
                                    Boolean(agent.delegation?.enabled)
                            })
                        )
                })
        },

        {
            role: "user",
            content:
                task && task.trim() !== ""
                    ? task
                    : readTask()
        }
    ].filter(Boolean);
}


/*
|--------------------------------------------------------------------------
| Permission Boundary
|--------------------------------------------------------------------------
|
| Approval/Policy system is intentionally not implemented yet.
|
| This function is the future central enforcement point.
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


/*
| Some gateways validate the model's answer against the json_schema we
| sent and return 500 when it does not match, which is exactly what
| happens when the model answers a request carrying `tools` with a
| native tool call instead. The schema is a request for a shape, not a
| requirement of this runtime: the parser accepts a native tool call and
| fenced JSON just as well. So when an endpoint rejects on the schema,
| the runtime stops sending the schema to that endpoint and asks again.
*/

const SCHEMA_DEGRADED = new Set();


function schemaKeyFor(profile, role) {

    return `${role || "MAIN"}|${profile.endpoint}|${profile.model}`;
}


function responseFormatAllowed(key) {

    const mode =
        settings.get("RESPONSE_FORMAT_MODE");

    if (mode === "never") {
        return false;
    }

    if (mode === "always") {
        return true;
    }

    return !SCHEMA_DEGRADED.has(key);
}


function mentionsSchemaRejection(text) {

    return /json_?schema|response_format|jsonschemavalidation|schema validation|invalid response for the expected schema/i
        .test(String(text || ""));
}


async function sendAgentRequest(options) {

    const {
        agentDefinition,
        responseFormat,
        role
    } = options;

    const profile =
        endpointFor(role, agentDefinition);

    const key =
        schemaKeyFor(profile, role);

    try {

        return await performAgentRequest(options, profile, key);

    } catch (error) {

        /*
        | One immediate retry without the schema, and only once per
        | endpoint: after that the endpoint is known not to accept it and
        | nothing is spent discovering that again.
        */

        if (
            !error.schema_rejected ||
            responseFormat === null ||
            SCHEMA_DEGRADED.has(key)
        ) {
            throw error;
        }

        SCHEMA_DEGRADED.add(key);

        logLine(
            options.scope,
            `The endpoint rejected the response schema; continuing without it for ${
                profile.model
            }`
        );

        events.emit("endpoint:degraded", {
            role: role || "MAIN",
            model: profile.model,
            endpoint: profile.endpoint,
            reason: error.message.slice(0, 200),
            dropped: "response_format"
        });

        return performAgentRequest(options, profile, key);
    }
}


async function performAgentRequest({
    messages,
    agentDefinition,
    tools,
    responseFormat,
    timeoutMs,
    role
}, profile, schemaKey) {

    const request =
        buildAgentRequest({
            messages,
            agentDefinition,
            tools,
            responseFormat,
            role,
            withSchema:
                responseFormatAllowed(schemaKey)
        });

    assertRunActive("model request");

    /*
    | A request to a slow endpoint can take two minutes, and the console
    | had nothing to show for it. The runtime therefore says when it is
    | waiting and for how long it waited: not tokens as they arrive, but
    | an honest "this agent is thinking" that ends when the answer does.
    */

    const waitingSince = Date.now();

    events.emit("request:start", {
        agent: role === "SUMMARY"
            ? "summariser"
            : agentDefinition?.name || "main_agent",

        role: role || "MAIN",

        model: profile.model
    });

    const finishWaiting = outcome => {

        events.emit("request:end", {
            agent: role === "SUMMARY"
                ? "summariser"
                : agentDefinition?.name || "main_agent",

            role: role || "MAIN",

            outcome,

            duration_ms: Date.now() - waitingSince
        });
    };

    const requestSignal =
        createRequestSignal(timeoutMs);

    let response;

    let text;

    try {

        response =
            await fetch(
                profile.endpoint,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${profile.api_key}`
                    },

                    body:
                        JSON.stringify(
                            request
                        ),

                    signal:
                        requestSignal.signal
                }
            );

        text =
            await response.text();

    } catch (error) {

        if (error.name === "AbortError") {

            const aborted =
                new Error(
                    `Model request aborted: ${
                        requestSignal.reason || "unknown reason"
                    }`
                );

            /*
            | A timed-out request may succeed on a second try; a
            | cancelled run must not be retried.
            */

            aborted.retryable =
                !isRunCancelled();

            finishWaiting("aborted");

            throw aborted;
        }

        error.retryable = true;

        finishWaiting("failed");

        throw error;

    } finally {

        requestSignal.release();
    }

    finishWaiting(response.ok ? "answered" : `http ${response.status}`);

    let data;

    let parsed =
        true;

    try {

        data =
            JSON.parse(text);

    } catch {

        parsed =
            false;

        data =
            text;
    }

    if (!response.ok) {

        const failure =
            new Error(
                `API Error ${response.status}: ${
                    (parsed
                        ? JSON.stringify(data)
                        : data
                    ).slice(0, 300)
                }`
            );

        failure.status =
            response.status;

        failure.retryable =
            isRetryableStatus(response.status);

        failure.retryAfter =
            response.headers.get("retry-after");

        /*
        | A gateway that validates the schema for us reports it as a
        | server error, so the class has to be recognised by its text.
        */

        failure.schema_rejected =
            Boolean(request.response_format) &&
            mentionsSchemaRejection(text);

        throw failure;
    }

    if (!parsed) {

        throw new Error(
            `Invalid JSON response: ${text}`
        );
    }

    return data;
}


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


/*
| Some endpoints return the model's reasoning next to the answer. It is
| not part of the contract and never re-enters the conversation, but a
| console that shows it is far easier to debug, so it is reported as an
| event and nothing else.
*/

/*
| Providers do not agree on the name or shape of a reasoning field. OpenAI
| compatible gateways commonly use reasoning_content, OpenRouter responses
| may use reasoning, and newer APIs can return reasoning_details as an array
| of typed parts. Keep the normalisation here so the UI never has to know
| which provider produced a response.
*/
function reasoningText(message) {

    const parts = [];
    const seen = new Set();

    const add = value => {

        if (typeof value !== "string") {
            return;
        }

        const text = value.trim();

        if (text !== "" && !seen.has(text)) {
            seen.add(text);
            parts.push(text);
        }
    };

    const read = value => {

        if (typeof value === "string") {
            add(value);
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                read(item);
            }
            return;
        }

        if (value && typeof value === "object") {
            /* Different gateways call the useful part text, content,
               summary, or reasoning. Prefer the most specific value and
               do not stringify the metadata wrapper. */
            for (const key of ["text", "content", "summary", "reasoning"]) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    read(value[key]);
                }
            }
        }
    };

    read(message?.reasoning_content);
    read(message?.reasoning);
    read(message?.reasoning_details);

    return parts.join("\n\n");
}


function modelMessageText(message) {

    if (!message || typeof message !== "object") {
        return "";
    }

    if (typeof message.content === "string") {
        return message.content.trim();
    }

    if (message.content !== undefined && message.content !== null) {
        try {
            return JSON.stringify(message.content, null, 2);
        } catch {
            return String(message.content);
        }
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        try {
            return JSON.stringify({ tool_calls: message.tool_calls }, null, 2);
        } catch {
            return "";
        }
    }

    if (typeof message.refusal === "string") {
        return message.refusal.trim();
    }

    return "";
}


/*
| Report both halves of a model response before parsing it. This is
| deliberately before readModelAction(): a malformed action is still a
| valuable response to show in the console, and its reasoning is often the
| only clue explaining why validation failed.
*/
function reportModelResponse(data, scope, agent, depth, iteration) {

    const message =
        data?.choices?.[0]?.message;

    if (!message) {
        return null;
    }

    const thinking =
        reportThinking(message, scope, agent, depth, iteration);

    const raw =
        modelMessageText(message);

    const maxChars =
        Math.max(
            settings.get("THINKING_MAX_CHARS"),
            4000
        );

    const content =
        raw.length > maxChars
            ? `${raw.slice(0, maxChars)}…`
            : raw;

    const response =
        content === ""
            ? null
            : events.emit("agent:response", {
                agent: agent || "main_agent",
                scope: scope || "main_agent",
                depth: depth || 0,
                iteration: iteration || null,
                content,
                chars: raw.length,
                truncated: raw.length > maxChars,
                finish_reason:
                    data?.choices?.[0]?.finish_reason || null,
                model: data?.model || null
            });

    return response || thinking;
}


function reportThinking(message, scope, agent, depth, iteration) {

    const text = reasoningText(message);

    if (text === "") {
        return null;
    }

    const limit =
        settings.get("THINKING_MAX_CHARS");

    return events.emit("agent:thinking", {
        agent: agent || "main_agent",

        scope: scope || "main_agent",

        depth: depth || 0,

        iteration: iteration || null,

        content:
            text.length > limit
                ? `${text.slice(0, limit)}…`
                : text,

        chars: text.length
    });
}


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

    return (
        projects.projectContextMode() === "modular" &&
        runContextMode() === "modular"
    );

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

    if (promptBuilderMode() === "modular") {

        return promptFacade().subAgentMessages(
            agentDefinition,
            task,
            context,
            { project: effectiveProject(currentRun().project) }
        );

    }


    const systemPrompt =
        buildAgentSystemPrompt(
            agentDefinition
        );

    const capabilities =
        resolveAgentCapabilities(
            agentDefinition
        );

    return [

        {
            role: "system",

            content:
                systemPrompt
        },

        {
            role: "system",

            content:
                JSON.stringify({
                    type:
                        "runtime_context",

                    context:
                        createRuntimeContext()
                })
        },

        /*
        | The profile used to travel whole: its persona, its skills, its
        | output contract and its tool list, every one of which is
        | already in the system prompt above or in the request's tools.
        | What is left is what the agent cannot see anywhere else.
        */

        {
            role: "system",

            content:
                JSON.stringify({
                    type:
                        "agent_profile",

                    name:
                        agentDefinition.name,

                    description:
                        agentDefinition.description,

                    may_delegate:
                        mayDelegate(agentDefinition)
                })
        },

        {
            role: "system",

            content:
                JSON.stringify({
                    type:
                        "available_tools",

                    note:
                        "Full parameter schemas travel in the request's tools field.",

                    tools:
                        capabilities.tools.map(
                            tool => tool.function.name
                        )
                })
        },

        {
            role: "user",

            content:
                JSON.stringify({
                    task,
                    context:
                        context ?? null
                })
        }
    ];
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

function hookExecutionContext(extra = {}) {

    const plan = currentPlanSummary();

    return {
        task: currentRun().task,
        objective: plan.objective || currentRun().task,
        repository: detectRepository(),
        files_changed: toolRuntime.telemetry.changedFiles(),
        file_tracking_complete:
            toolRuntime.telemetry.changeTrackingComplete(),
        plan,
        hooks: currentRun().hook_results,
        ...extra
    };
}


function hookResultSummary(value) {

    if (value === null || value === undefined) {
        return "completed";
    }

    if (typeof value === "string") {
        return value.slice(0, 600);
    }

    if (typeof value?.response?.content === "string") {
        return value.response.content.slice(0, 600);
    }

    if (typeof value?.stdout === "string" && value.stdout.trim() !== "") {
        return value.stdout.trim().slice(0, 600);
    }

    const text = JSON.stringify(value);

    return text.length > 600
        ? `${text.slice(0, 600)}…`
        : text;
}


function dirtyPathsFromStatus(stdout) {

    return String(stdout || "")
        .split(/\r?\n/)
        .filter(line => line && !line.startsWith("## "))
        .flatMap(line => {

            const path = line.slice(3).trim();

            if (!path.includes(" -> ")) {
                return [path];
            }

            return path.split(" -> ").map(item => item.trim());
        })
        .filter(
            item =>
                item &&
                item !== ".agent" &&
                !item.startsWith(".agent/")
        );
}


async function executeHookTool(hook, context) {

    const args =
        hookRegistry.render(hook.arguments || {}, context);

    const results =
        await executeToolGraph(
            [
                {
                    id: `hook_${hook.id}`,
                    name: hook.tool,
                    arguments: args,
                    depends_on: []
                }
            ],
            new Set(TOOL_REGISTRY_OF().keys()),
            "main_agent",
            { hook: hook.id }
        );

    const result = results[0];
    const exitCode = result?.result?.exit_code;

    if (!result?.success || (Number.isInteger(exitCode) && exitCode !== 0)) {

        throw new Error(
            result?.error?.message ||
            `Hook tool "${hook.tool}" exited with code ${exitCode}.`
        );
    }

    return result.result;
}


async function executeGitCommitHook(hook, context) {

    if (
        hook.phase === "after_task" &&
        context.file_tracking_complete !== true
    ) {

        throw new Error(
            "The runtime cannot prove the complete set of files changed by this run, so it refused to commit. A shell or background process may have modified an already-dirty path."
        );
    }

    let paths =
        hook.paths === undefined
            ? context.files_changed
            : hookRegistry.render(hook.paths, context);

    if (typeof paths === "string") {
        paths = paths.split(",").map(item => item.trim()).filter(Boolean);
    }

    if (!Array.isArray(paths)) {
        paths = [];
    }

    /* A before_task safety commit explicitly snapshots the dirty tree. */
    if (hook.phase === "before_task" && paths.length === 0) {

        const status =
            await executeHookTool(
                {
                    id: `${hook.id}_status`,
                    type: "tool",
                    tool: "git_status",
                    arguments: { cwd: "." }
                },
                context
            );

        paths = toolRuntime.telemetry.dirtyFiles();

        if (paths.length === 0) {
            paths = dirtyPathsFromStatus(status.stdout);
        }
    }

    paths = [...new Set(paths.filter(item => typeof item === "string" && item !== ""))];

    if (paths.length === 0) {
        throw new Error("No safely attributable paths are available for this commit hook.");
    }

    const message =
        hookRegistry.render(hook.message, context);

    const results =
        await executeToolGraph(
            [
                {
                    id: `hook_${hook.id}_add`,
                    name: "git_add",
                    arguments: { cwd: ".", paths },
                    depends_on: []
                },
                {
                    id: `hook_${hook.id}_commit`,
                    name: "git_commit",
                    arguments: { cwd: ".", message, paths },
                    depends_on: [`hook_${hook.id}_add`]
                }
            ],
            new Set(TOOL_REGISTRY_OF().keys()),
            "main_agent",
            { hook: hook.id }
        );

    const failed = results.find(result => !result.success);

    if (failed) {
        throw new Error(failed.error?.message || "Git commit hook failed.");
    }

    return {
        paths,
        commit: results[1].result
    };
}


async function executeAgentHook(hook, context, mainAgentDefinition) {

    const task =
        hookRegistry.render(hook.task, context);

    const results =
        await executeDelegations(
            [
                {
                    id: `hook_${hook.id}`,
                    agent: hook.agent,
                    persona: null,
                    skills: null,
                    tools: null,
                    task,
                    hook: hook.id,
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

    if (!delegated?.success || !report?.success || report?.error) {

        throw new Error(
            delegated?.error?.message ||
            report?.error?.message ||
            `Agent hook "${hook.id}" failed.`
        );
    }

    if (
        (report.performed?.tools || 0) +
        (report.performed?.delegations || 0) === 0
    ) {

        throw new Error(
            `Agent hook "${hook.id}" returned without executing a tool or delegation, so its report is not runtime evidence.`
        );
    }

    return report;
}


async function executeOneHook(hook, baseContext, mainAgentDefinition) {

    const startedAt = Date.now();
    const context = {
        ...baseContext,
        hooks: currentRun().hook_results
    };

    events.emit("hook:start", {
        id: hook.id,
        phase: hook.phase,
        hook_type: hook.type,
        depends_on: hook.depends_on,
        on_failure: hook.on_failure
    });

    if (!hookRegistry.evaluateWhen(hook.when, context)) {

        const skipped = {
            id: hook.id,
            type: hook.type,
            phase: hook.phase,
            ok: false,
            skipped: true,
            status: "skipped",
            summary: `condition was false: ${hook.when}`,
            on_failure: hook.on_failure,
            duration_ms: Date.now() - startedAt
        };

        currentRun().hook_results[hook.id] = skipped;
        events.emit("hook:end", {
            id: skipped.id,
            phase: skipped.phase,
            hook_type: skipped.type,
            ok: skipped.ok,
            skipped: skipped.skipped,
            status: skipped.status,
            summary: skipped.summary,
            error: skipped.error,
            on_failure: skipped.on_failure,
            duration_ms: skipped.duration_ms
        });

        return skipped;
    }

    try {

        assertRunActive(`hook ${hook.id}`);

        const result =
            hook.type === "tool"
                ? await executeHookTool(hook, context)
                : hook.type === "agent"
                    ? await executeAgentHook(hook, context, mainAgentDefinition)
                    : await executeGitCommitHook(hook, context);

        assertRunActive(`hook ${hook.id} completion`);

        const completed = {
            id: hook.id,
            type: hook.type,
            phase: hook.phase,
            ok: true,
            skipped: false,
            status: "done",
            summary: hookResultSummary(result),
            result,
            on_failure: hook.on_failure,
            duration_ms: Date.now() - startedAt
        };

        currentRun().hook_results[hook.id] = completed;
        events.emit("hook:end", {
            id: completed.id,
            phase: completed.phase,
            hook_type: completed.type,
            ok: completed.ok,
            skipped: completed.skipped,
            status: completed.status,
            summary: completed.summary,
            error: completed.error,
            on_failure: completed.on_failure,
            duration_ms: completed.duration_ms
        });

        return completed;

    } catch (error) {

        const failed = {
            id: hook.id,
            type: hook.type,
            phase: hook.phase,
            ok: false,
            skipped: false,
            status: "failed",
            summary: error.message,
            error: error.message,
            on_failure: hook.on_failure,
            duration_ms: Date.now() - startedAt
        };

        currentRun().hook_results[hook.id] = failed;
        events.emit("hook:end", {
            id: failed.id,
            phase: failed.phase,
            hook_type: failed.type,
            ok: failed.ok,
            skipped: failed.skipped,
            status: failed.status,
            summary: failed.summary,
            error: failed.error,
            on_failure: failed.on_failure,
            duration_ms: failed.duration_ms
        });

        return failed;
    }
}


async function withHookBudget(phase, callback) {

    if (currentRun().inHook) {
        return {
            phase,
            skipped: true,
            stopped: false,
            results: [],
            reason: "nested hooks are disabled"
        };
    }

    const previous = {
        controller: currentRun().controller,
        cancelled_reason: currentRun().cancelled_reason
    };

    currentRun().inHook = true;
    currentRun().hook_phase = phase;
    currentRun().hook_started_at = Date.now();
    currentRun().hook_deadline_at = currentRun().hook_started_at + settings.get("HOOK_TIMEOUT_MS");
    currentRun().controller = new AbortController();
    currentRun().cancelled_reason = null;

    const timeout =
        setTimeout(
            () => cancelRun("hook deadline"),
            settings.get("HOOK_TIMEOUT_MS")
        );

    try {
        return await callback();
    } finally {
        clearTimeout(timeout);

        const hookCancellation =
            currentRun().cancelled_reason;

        currentRun().inHook = false;
        currentRun().hook_phase = null;
        currentRun().hook_started_at = 0;
        currentRun().hook_deadline_at = null;
        currentRun().controller = previous.controller;
        currentRun().cancelled_reason = previous.cancelled_reason;

        if (
            hookCancellation &&
            hookCancellation !== "hook deadline" &&
            currentRun().controller &&
            !currentRun().controller.signal.aborted
        ) {
            currentRun().cancelled_reason = hookCancellation;
            currentRun().controller.abort();
        }
    }
}


async function runHooks(phase, context, mainAgentDefinition) {

    const declarations = hookRegistry.enabledHooks(phase);

    if (declarations.length === 0 || currentRun().inHook) {

        return {
            phase,
            skipped: true,
            stopped: false,
            results: []
        };
    }

    return withHookBudget(
        phase,
        async () => {

            events.emit("hook:phase:start", {
                phase,
                hooks: declarations.map(item => item.id)
            });

            const scheduled =
                await executeDependencyGraph({
                    items: declarations,
                    maxParallel: settings.get("MAX_PARALLEL_TOOLS"),
                    executor:
                        hook => executeOneHook(
                            hook,
                            context,
                            mainAgentDefinition
                        )
                });

            const results = scheduled.map(item => item.result);
            const stopped =
                results.some(
                    item =>
                        item &&
                        item.status === "failed" &&
                        item.on_failure === "stop"
                );

            const report = {
                phase,
                skipped: false,
                stopped,
                results
            };

            events.emit("hook:phase:end", {
                phase,
                stopped,
                ok: results.every(item => item.ok || item.skipped),
                results: results.map(item => ({
                    id: item.id,
                    status: item.status,
                    ok: item.ok,
                    summary: item.summary
                }))
            });

            return report;
        }
    );
}


function hookReportText(report) {

    if (!report || report.results.length === 0) {
        return "";
    }

    return report.results
        .filter(item => !item.skipped)
        .map(
            item =>
                `- ${item.id}: ${item.ok ? "ok" : "failed"} — ${item.summary}`
        )
        .join("\n");
}


async function applyAfterTaskHooks(action, runError) {

    if (currentRun().after_hooks_ran) {
        return { action, report: null };
    }

    const context =
        hookExecutionContext({
            action: action || null,
            run_error:
                runError
                    ? { message: runError.message }
                    : action?.error || null
        });

    /* Freeze provenance before test/review hooks run their own commands. */
    context.files_changed = [...context.files_changed];
    context.file_tracking_complete = context.file_tracking_complete === true;

    const report =
        await runHooks(
            "after_task",
            context,
            currentRun().main_agent_definition || mainAgentProfile()
        );

    currentRun().after_hooks_ran = true;

    const combinedReport = {
        ...report,
        results:
            Object.values(currentRun().hook_results)
    };

    if (!action) {
        return { action: null, report: combinedReport };
    }

    const text = hookReportText(combinedReport);
    const next = {
        ...action,
        response: action.response
            ? { ...action.response }
            : {
                type: "text",
                content: runError?.message || "The run did not complete."
            }
    };

    if (text) {

        next.response.content =
            `${next.response.content}\n\nAutomated routine:\n${text}`;
    }

    if (report.stopped && !next.error) {

        const failed =
            report.results.find(
                item => item.status === "failed" && item.on_failure === "stop"
            );

        next.error = {
            code: "HOOK_FAILED",
            message:
                `Required after_task hook "${failed.id}" failed: ${failed.summary}`,
            retryable: true
        };
    }

    return { action: next, report: combinedReport };
}


async function autoroutePlanStep(mainAgentDefinition) {

    if (
        settings.get("PLAN_AUTOROUTE") !== true ||
        currentRun().inHook
    ) {
        return null;
    }

    const planTools = require("./tools/plan");
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

    if (projects.projectContextMode() !== "modular") {

        return null;

    }

    const context =
        projects.resolveProjectForRun(options, {
            registry: projects.registry(),
            workspaceRoot: WORKSPACE_ROOT
        });

    /*
    | A project rooted elsewhere than this process's workspace is
    | executable once every tool call carries the project context — that
    | is exactly what RUN_CONTEXT_MODE=modular guarantees (Phase 4). In
    | any other mode the tool layer still resolves against the global
    | WORKSPACE_ROOT, so a foreign root would silently mis-scope every
    | tool call and keeps failing loudly here.
    */

    if (runContextMode() !== "modular") {

        projects.assertWorkspaceMatch(context, WORKSPACE_ROOT);

    }

    return context;

}


async function runAgentCore(...args) {

    return await runtimeEngine.runAgentCore(...args);

}


/*
| Modular variant (EXECUTION_PLAN Phase 3, RUN_CONTEXT_MODE=modular):
| the run gets its own AgentRunContext before anything starts, the whole
| core executes inside the run's async scopes, and two such calls may
| interleave without sharing messages, budgets or cancellation.
|
| The error path mirrors the legacy wrapper: the after-task hooks only
| run for a failure of a run that actually started — a failure during
| context resolution or registry validation must not inherit them. The
| legacy wrapper detects that via its previousRunId comparison; here the
| run's started_at timestamp is the equivalent signal.
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

            throw error;

        }

        /* Leaving the async scopes restores the correlation context:
           nothing process-global needs the legacy wrapper's cleanup. */
    }));
}


async function runAgent(options = {}) {

    if (runContextMode() === "modular") {
        return await runAgentModular(options);
    }

    const previousRunId = currentRun().id;

    try {
        return await runAgentCore(options);
    } catch (error) {

        if (
            currentRun().id !== previousRunId &&
            !currentRun().after_hooks_ran
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

        throw error;

    } finally {

        /* Clear the correlation context so events emitted after the run
           (from hooks or the next run) are not mis-attributed. */
        events.setContext({
            run_id: null,
            turn_id: null,
            scope: null,
            iteration: null
        });
    }
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

                cancelRun(signalName.toLowerCase());

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
    summariseTranscript
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

    mcp: require("./mcp/manager").manager,
    mcpToolDeclarations,
    discoverMcpTools,

    createRuntimeContext,
    detectRepository,
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
    project: require("./lib/project"),

    /*
    | Multi-project surface (Phase 2). Named `projects` to stay distinct
    | from the legacy workspace-profile module above; the boundary is
    | documented in EXECUTION_PLAN Phase 2 step 3.
    */
    projects,
    sessions: require("./lib/sessions"),
    eventstore: require("./lib/eventstore"),
    openProject: () => require("./lib/project").openProject(),
    persistProject: () => require("./lib/project").persist(),
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
    | The request body builder (Phase 5 wrapper: inline in legacy, the
    | injected agent/prompt/RequestBuilder in modular).
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
    | Per-run context surface (Phase 3, gated by RUN_CONTEXT_MODE). The
    | legacy entry points above keep their exact signatures and
    | behavior; these exist so modular callers can address one specific
    | run out of several concurrent ones.
    */
    AgentRunContext,
    runManager,
    runContextMode,
    runScheduler,
    observability,
    cancelRunById,
    effectiveProject,
    effectiveProjectId,
    runWithProject,
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
    runtimeEngineMode: runtimeEngine.runtimeEngineMode,
    context: contextKit,

    /*
    | Read through the store so a caller never caches a stale limit.
    */

    get limits() {

        return settings.snapshot();
    }
};
