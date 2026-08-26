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

    return Object.values(registryFiles())
        .map(file => {

            try {

                const stats = fs.statSync(file);

                return `${file}:${stats.mtimeMs}:${stats.size}`;

            } catch {

                return `${file}:missing`;
            }
        })
        .join("|");
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

    const data = {};

    for (
        const [name, file]
        of Object.entries(registryFiles())
    ) {
        data[name] = readJSON(file);
    }

    data.PERSONA_REGISTRY =
        new Map(
            data.PERSONAS.map(
                persona => [persona.name, persona]
            )
        );

    data.SKILL_REGISTRY =
        new Map(
            data.SKILLS.map(
                skill => [skill.name, skill]
            )
        );

    data.TOOL_REGISTRY =
        new Map(
            data.TOOLS
                .filter(item => item?.type === "function")
                .map(item => [item.function.name, item])
        );

    data.AGENT_REGISTRY =
        new Map(
            data.AGENTS.map(
                agent => [agent.name, agent]
            )
        );

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

const ARCHIVED_EXCHANGES = new WeakSet();


function archiveExchanges(messages, exchanges, scope) {

    /*
    | An exchange is archived once, at the moment it is complete, so the
    | stored body is the full tool result rather than whatever survived
    | compression. The set is keyed on the assistant message object, so
    | nothing is added to what gets serialised into a request.
    */

    const fresh =
        exchanges.filter(
            exchange =>
                !ARCHIVED_EXCHANGES.has(messages[exchange.start])
        );

    if (fresh.length === 0) {
        return null;
    }

    try {

        const report = archive.archiveEvents(
            archive.eventsFromExchanges(
                messages,
                fresh,
                {
                    agent: scope || "main_agent",
                    run: currentRun().id
                }
            )
        );

        for (const exchange of fresh) {

            ARCHIVED_EXCHANGES.add(messages[exchange.start]);
        }

        return report;

    } catch (error) {

        logLine(
            scope,
            `Could not archive exchanges: ${error.message}`
        );

        return null;
    }
}


async function foldIntoMemory(messages, scope) {

    const exchanges =
        findExchanges(messages);

    const keep =
        Math.max(
            1,
            settings.get("KEEP_RECENT_EXCHANGES")
        );

    const foldable =
        exchanges.slice(
            0,
            Math.max(0, exchanges.length - keep)
        );

    if (foldable.length === 0) {
        return null;
    }

    /*
    | The material leaves the transcript whether or not the summariser
    | succeeds, but it is only removed after a successful absorption.
    */

    const material =
        foldable.map(exchange => {

            const lines = [];

            for (
                let index = exchange.start;
                index <= exchange.end;
                index++
            ) {

                const message = messages[index];

                if (message.role === "assistant") {

                    lines.push(
                        `called: ${
                            (message.tool_calls || [])
                                .map(call => call.function.name)
                                .join(", ")
                        }`
                    );

                    continue;
                }

                lines.push(`result: ${message.content}`);
            }

            return lines.join("\n");
        }).join("\n");

    const before =
        conversationSize(messages);

    /*
    | The archive is written before the summariser is called, and it is
    | written whether or not the summariser answers. Working memory is a
    | lossy view of these exchanges; the archive is the copy that keeps
    | the exact error text and the exact path, retrievable later with
    | archive_search.
    */

    const archived =
        archiveExchanges(messages, foldable, scope);

    const absorbed =
        await memoryStore.absorb(
            memoryStore.loadMemory(),
            material,
            summariseTranscript,
            {
                getSignal: () => {
                    assertRunActive("folding history into memory");
                    return currentRun().controller?.signal;
                }
            }
        );

    if (absorbed.absorbed === 0) {

        logLine(
            scope,
            `Could not fold history into memory (${
                absorbed.failures[0] || "no chunk absorbed"
            }); compressing mechanically instead.`
        );

        return null;
    }

    const condensed =
        await memoryStore.condense(
            absorbed.memory,
            summariseTranscript
        );

    memoryStore.saveMemory(condensed.memory);

    /*
    | Drop the folded exchanges and refresh the memory message.
    */

    const first = foldable[0].start;

    const last =
        foldable[foldable.length - 1].end;

    messages.splice(first, last - first + 1);

    refreshMemoryMessage(messages, condensed.memory);

    const report = {
        folded_exchanges:
            foldable.length,

        chunks:
            absorbed.chunks,

        summary_calls:
            absorbed.attempted,

        skipped_chunks:
            absorbed.skipped,

        absorbed:
            absorbed.absorbed,

        condensed:
            condensed.condensed,

        archived:
            archived
                ? archived.added
                : 0,

        archive_duplicates:
            archived
                ? archived.duplicates
                : 0,

        before,

        after:
            conversationSize(messages)
    };

    logLine(
        scope,
        `Folded ${report.folded_exchanges} exchanges into memory with ${
            report.summary_calls
        } summariser call(s) across ${report.chunks} chunk(s)${
            report.skipped_chunks
                ? ` (${report.skipped_chunks} archive-only)`
                : ""
        }, ${
            Math.round(report.before / 1000)
        }k to ${
            Math.round(report.after / 1000)
        }k${
            report.condensed
                ? ", memory condensed"
                : ""
        }${
            report.archived
                ? `, ${report.archived} archived`
                : ""
        }`
    );

    events.emit("context:memory", {
        agent: scope || "main_agent",
        ...report
    });

    return report;
}


/*
| One memory message, kept just after the task so it reads as
| established knowledge rather than as a late correction.
*/

function refreshMemoryMessage(messages, memory) {

    const message =
        memoryStore.memoryMessage(memory);

    const existing =
        messages.findIndex(memoryStore.isMemoryMessage);

    if (existing !== -1) {

        messages[existing] = message;

        return;
    }

    const firstUser =
        messages.findIndex(
            item => item.role === "user"
        );

    messages.splice(
        firstUser === -1
            ? messages.length
            : firstUser + 1,
        0,
        message
    );
}


async function maintainContext(messages, scope) {

    const budget =
        settings.get("MAX_CONTEXT_CHARS");

    const threshold =
        budget * settings.get("CONTEXT_COMPACT_AT");

    const size =
        conversationSize(messages);

    if (size < threshold) {
        return null;
    }

    /*
    | First try a real summary of the oldest material, then fall back to
    | mechanical compression for whatever is still over budget.
    */

    if (
        settings.get("CONTEXT_SUMMARY") === true &&
        settings.get("MEMORY_ENABLED") === true
    ) {

        await foldIntoMemory(messages, scope);
    }

    const report =
        compactConversation(messages, {
            maxChars: threshold,

            onDrop: (current, exchange) =>
                archiveExchanges(current, [exchange], scope)
        });

    if (report.compacted) {

        logLine(
            scope,
            `Context ${
                Math.round(report.before / 1000)
            }k of ${
                Math.round(budget / 1000)
            }k, compacted to ${
                Math.round(report.after / 1000)
            }k (light ${report.light}, medium ${
                report.medium
            }, heavy ${report.heavy}, dropped ${
                report.dropped_exchanges
            })`
        );

        events.emit("context:compacted", {
            agent: scope || "main_agent",
            ...report
        });
    }

    return report;
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

function delegationHintMessage(planSummary, remainingAgents) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type: "runtime_notice",

                notice: "delegation_available",

                agents_remaining: remainingAgents,

                open_steps:
                    planSummary.pending + planSummary.in_progress,

                assigned_steps:
                    planSummary.assigned_open_steps || [],

                instruction:
                    (planSummary.assigned_open_steps || []).length > 0
                        ? `The plan already assigns open work to agent profiles: ${
                            planSummary.assigned_open_steps
                                .map(step => `${step.id} → ${step.agent}`)
                                .join(", ")
                        }. Delegate independent assigned steps to those exact profiles in one action instead of continuing alone. Keep only sequential work that depends on state you hold.`
                        : "You have been working alone while the plan still has open steps and the whole agent budget is unspent. Steps that do not depend on each other can run at the same time, each in its own context: hand them to sub-agents in one delegate action, and keep for yourself only what depends on state you hold. If the remaining work really is one sequential thread, say so in your next answer and carry on."
            })
    };
}


function shouldHintDelegation(progress, planSummary, agentDefinition) {

    const after =
        settings.get("DELEGATION_NUDGE_AFTER");

    if (
        after === 0 ||
        !mayDelegate(agentDefinition) ||
        progress.delegations > 0 ||
        (progress.delegationHints || 0) >=
            settings.get("MAX_DELEGATION_NUDGES")
    ) {
        return false;
    }

    if (progress.tools < after) {
        return false;
    }

    if (
        !planSummary.exists ||
        planSummary.pending + planSummary.in_progress < 2
    ) {
        return false;
    }

    return remainingAgentBudget() >= 2;
}


/*
| A final answer may declare what it did. The runtime already knows what
| it executed, so the two can be compared, and the interesting case is
| the claim with nothing behind it: "I updated the config" when no write
| ever ran. The mismatch is reported, never silently corrected, because
| the runtime cannot know which of the two is the lie.
*/

function checkPerformedClaim(action, progress, scope) {

    const claim = action?.performed;

    if (!claim || typeof claim !== "object") {
        return null;
    }

    /* A modular run is checked against its own tool history; a legacy
       run against the process-wide one, as before. */
    const executed =
        toolRuntime.executedToolNames
            ? toolRuntime.executedToolNames(
                  currentRun() instanceof AgentRunContext
                      ? currentRun().runId
                      : undefined
              )
            : [];

    const problems = [];

    for (const tool of claim.tools || []) {

        if (!executed.includes(tool)) {

            problems.push(
                `claimed ${tool}, which the runtime never executed`
            );
        }
    }

    if (
        (claim.agents || []).length > 0 &&
        progress.delegations === 0
    ) {

        problems.push(
            `claimed ${
                (claim.agents || []).join(", ")
            }, but nothing was delegated`
        );
    }

    if (
        (claim.files_changed || []).length > 0 &&
        !executed.some(
            name => FILE_MUTATING_TOOLS.includes(name)
        )
    ) {

        problems.push(
            `claimed ${
                claim.files_changed.length
            } changed file(s), but no write ran`
        );
    }

    if (problems.length === 0) {
        return null;
    }

    logLine(
        scope || "main_agent",
        `The answer claims work the runtime did not do: ${
            problems.join("; ")
        }`
    );

    events.emit("report:mismatch", {
        agent: scope || "main_agent",
        problems,
        claimed: claim,
        executed
    });

    return problems;
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

function assertToolAllowed(
    toolName,
    allowedTools
) {

    if (
        !TOOL_REGISTRY_OF().has(toolName) &&
        !toolRuntime.mcp._hasDiscoveredTool(toolName)
    ) {

        throw new Error(
            `Tool is not available: ${toolName}`
        );
    }

    if (!toolRuntime.hasTool(toolName)) {

        throw new Error(
            `Tool is declared but not implemented: ${toolName}`
        );
    }

    if (!allowedTools.has(toolName)) {

        throw new Error(
            `Tool "${toolName}" is not allowed for this agent.`
        );
    }
}


/*
|--------------------------------------------------------------------------
| Tool Call Normalization
|--------------------------------------------------------------------------
*/

function parseArguments(value, toolName) {

    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value;
    }

    if (typeof value === "string") {

        if (value.trim() === "") {
            return {};
        }

        try {

            const parsed =
                JSON.parse(value);

            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed;
            }

            throw new Error("not an object");

        } catch {

            throw new Error(
                `Arguments for "${toolName}" are a string that is not a JSON object.`
            );
        }
    }

    return {};
}


function normalizeToolCalls(
    toolCalls
) {

    /*
    | A generated id must not collide with one the model chose, or the
    | whole action would be rejected for a duplicate it never wrote.
    */

    const taken =
        new Set(
            toolCalls
                .map(call => call && call.id)
                .filter(Boolean)
        );

    const generateId = index => {

        let candidate =
            `call_${index + 1}`;

        let suffix = 1;

        while (taken.has(candidate)) {

            candidate = `call_${index + 1}_${suffix}`;

            suffix++;
        }

        taken.add(candidate);

        return candidate;
    };

    return toolCalls.map(
        (call, index) => {

            const parsedArguments =
                parseArguments(
                    call.arguments,
                    call.name
                );

            const pathRepair =
                repairMarkdownPathArguments(
                    call.name,
                    parsedArguments
                );

            if (pathRepair.repaired_fields.length > 0) {

                events.emit("response:repaired", {
                    repair: "markdown_path",
                    tool: call.name,
                    repaired_fields: pathRepair.repaired_fields
                });

                logLine(
                    null,
                    `Repaired Markdown links in ${call.name}.${
                        pathRepair.repaired_fields.join(`, ${call.name}.`)
                    }.`
                );
            }

            return {
                id:
                    call.id ||
                    generateId(index),

                name:
                    call.name,

                /* Arguments may arrive as an object or, under a strict
                   schema, as a JSON encoded string. */
                arguments:
                    pathRepair.arguments,

                depends_on:
                    Array.isArray(call.depends_on)
                        ? call.depends_on
                        : []
            };
        }
    );
}


/*
|--------------------------------------------------------------------------
| Dependency Validation
|--------------------------------------------------------------------------
*/

function validateDependencyGraph(
    items
) {

    const ids =
        new Set();

    for (
        const item
        of items
    ) {

        if (ids.has(item.id)) {

            throw new Error(
                `Duplicate dependency id: ${item.id}`
            );
        }

        ids.add(item.id);
    }

    for (
        const item
        of items
    ) {

        for (
            const dependency
            of item.depends_on
        ) {

            if (!ids.has(dependency)) {

                throw new Error(
                    `Unknown dependency: ${dependency}`
                );
            }

            if (
                dependency === item.id
            ) {

                throw new Error(
                    `Item cannot depend on itself: ${item.id}`
                );
            }
        }
    }
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

function describeGraph(items, maxParallel) {

    const remaining =
        new Map(items.map(item => [item.id, item]));

    const done = new Set();

    const waves = [];

    while (remaining.size > 0) {

        const ready =
            [...remaining.values()].filter(
                item =>
                    (item.depends_on || []).every(
                        dependency => done.has(dependency)
                    )
            );

        if (ready.length === 0) {

            /* a cycle: the executor will report it, this is only a view */
            break;
        }

        const batch =
            ready.slice(0, Math.max(1, maxParallel));

        waves.push(batch.map(item => item.id));

        for (const item of batch) {

            done.add(item.id);

            remaining.delete(item.id);
        }
    }

    const dependent =
        items.some(
            item => (item.depends_on || []).length > 0
        );

    const shape =
        items.length <= 1
            ? "single"
            : !dependent
                ? "parallel"
                : waves.every(wave => wave.length === 1)
                    ? "sequential"
                    : "graph";

    return {
        shape,

        waves,

        widest:
            waves.reduce(
                (widest, wave) =>
                    Math.max(widest, wave.length),
                0
            )
    };
}


async function executeDependencyGraph({
    items,
    executor,
    maxParallel
}) {

    validateDependencyGraph(
        items
    );

    const remaining =
        new Map(
            items.map(
                item => [
                    item.id,
                    item
                ]
            )
        );

    const results =
        new Map();

    while (
        remaining.size > 0
    ) {

        const ready = [];

        for (
            const item
            of remaining.values()
        ) {

            const dependenciesComplete =
                item.depends_on.every(
                    dependency =>
                        results.has(
                            dependency
                        )
                );

            if (
                dependenciesComplete
            ) {
                ready.push(item);
            }
        }

        if (
            ready.length === 0
        ) {

            throw new Error(
                "Dependency graph contains a cycle or unresolved dependency."
            );
        }

        const batch =
            ready.slice(
                0,
                maxParallel
            );

        const batchResults =
            await Promise.all(
                batch.map(
                    async item => {

                        try {

                            const result =
                                await executor(
                                    item,
                                    results
                                );

                            return {
                                id:
                                    item.id,

                                success:
                                    true,

                                result
                            };

                        } catch (error) {

                            return {
                                id:
                                    item.id,

                                success:
                                    false,

                                result:
                                    null,

                                error: {
                                    code:
                                        error.name ||
                                        "EXECUTION_ERROR",

                                    message:
                                        error.message,

                                    retryable:
                                        false
                                }
                            };
                        }
                    }
                )
            );

        for (
            const result
            of batchResults
        ) {

            results.set(
                result.id,
                result
            );

            remaining.delete(
                result.id
            );
        }
    }

    return items.map(
        item =>
            results.get(
                item.id
            )
    );
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

const REFERENCE_PATTERN =
    /\$\{([A-Za-z0-9_.-]+)\}/g;


function readReferencePath(
    value,
    segments,
    expression
) {

    let current = value;

    for (const segment of segments) {

        if (
            current === null ||
            current === undefined
        ) {

            throw new Error(
                `Reference "${expression}" cannot be resolved: "${segment}" is not reachable.`
            );
        }

        if (Array.isArray(current)) {

            const index =
                Number(segment);

            if (!Number.isInteger(index)) {

                throw new Error(
                    `Reference "${expression}" expects a numeric index for an array, received "${segment}".`
                );
            }

            current = current[index];

            continue;
        }

        if (typeof current !== "object") {

            throw new Error(
                `Reference "${expression}" cannot descend into "${segment}".`
            );
        }

        current = current[segment];
    }

    return current;
}


function resolveReference(
    expression,
    results,
    allowedIds
) {

    const [id, ...segments] =
        expression.split(".");

    if (!allowedIds.includes(id)) {

        throw new Error(
            `Reference "${expression}" points at "${id}", which is not listed in depends_on.`
        );
    }

    void 0;

    const entry =
        results.get(id);

    if (!entry) {

        throw new Error(
            `Reference "${expression}" points at an unknown call: ${id}`
        );
    }

    if (!entry.success) {

        throw new Error(
            `Reference "${expression}" points at "${id}", which failed: ${
                entry.error?.message || "unknown error"
            }`
        );
    }

    return readReferencePath(
        entry,
        segments,
        expression
    );
}


function resolveArgumentReferences(
    value,
    results,
    allowedIds,
    knownIds
) {

    /*
    | Only an expression that names a call in this action is a
    | reference. Anything else is ordinary text: file content routinely
    | contains ${...}, for example a JavaScript template literal, and
    | rewriting or rejecting that would corrupt the file.
    */

    const isReference = expression => {

        const id =
            expression.split(".")[0];

        return (
            allowedIds.includes(id) ||
            (
                knownIds
                    ? knownIds.has(id)
                    : false
            )
        );
    };

    if (typeof value === "string") {

        /*
        | $${...} is an explicit escape for a literal ${...}. It is
        | protected before the scan and restored afterwards.
        */

        const ESCAPE = "\u0000ESCAPED_REFERENCE\u0000";

        const guarded =
            value.replace(/\$\$\{/g, ESCAPE);

        const restore = text =>
            text.split(ESCAPE).join("${");

        const matches =
            [...guarded.matchAll(REFERENCE_PATTERN)]
                .filter(
                    match => isReference(match[1])
                );

        if (matches.length === 0) {
            return restore(guarded);
        }

        /*
        | A string that is exactly one reference keeps the original
        | type, so an object or number is not stringified.
        */

        if (
            matches.length === 1 &&
            matches[0][0] === guarded
        ) {

            return resolveReference(
                matches[0][1],
                results,
                allowedIds
            );
        }

        return restore(
            guarded.replace(
                REFERENCE_PATTERN,
                (match, expression) => {

                    if (!isReference(expression)) {
                        return match;
                    }

                    const resolved =
                        resolveReference(
                            expression,
                            results,
                            allowedIds
                        );

                    return typeof resolved === "string"
                        ? resolved
                        : JSON.stringify(resolved);
                }
            )
        );
    }

    if (Array.isArray(value)) {

        return value.map(
            item =>
                resolveArgumentReferences(
                    item,
                    results,
                    allowedIds,
                    knownIds
                )
        );
    }

    if (
        value &&
        typeof value === "object"
    ) {

        const output = {};

        for (
            const [key, item]
            of Object.entries(value)
        ) {

            output[key] =
                resolveArgumentReferences(
                    item,
                    results,
                    allowedIds,
                    knownIds
                );
        }

        return output;
    }

    return value;
}


/*
|--------------------------------------------------------------------------
| Tool Graph
|--------------------------------------------------------------------------
*/

let GRAPH_SEQUENCE = 0;


async function executeToolGraph(
    toolCalls,
    allowedTools,
    scope,
    context = {}
) {

    const calls =
        normalizeToolCalls(
            toolCalls
        );

    const callIds =
        new Set(
            calls.map(call => call.id)
        );

    const maxParallel =
        settings.get("MAX_PARALLEL_TOOLS");

    const graph =
        describeGraph(calls, maxParallel);

    const graphId =
        `graph_${++GRAPH_SEQUENCE}`;

    /*
    | Which wave a call belongs to is what makes "parallel" visible
    | afterwards: two calls in the same wave really did run together.
    */

    const waveOf = new Map();

    graph.waves.forEach((wave, index) => {

        for (const id of wave) {
            waveOf.set(id, index);
        }
    });

    logLine(
        scope,
        `Executing tool graph (${calls.length} call(s), ${
            graph.shape
        }, ${graph.waves.length} wave(s)).`
    );

    events.emit("tool:graph", {
        agent:
            scope || "main_agent",

        scope:
            scope || "main_agent",

        graph_id:
            graphId,

        iteration:
            context.iteration || null,

        hook:
            context.hook || null,

        shape:
            graph.shape,

        waves:
            graph.waves,

        max_parallel:
            maxParallel,

        calls:
            calls.map(call => ({
                id: call.id,
                name: call.name,
                depends_on: call.depends_on,
                wave: waveOf.get(call.id) ?? null
            }))
    });

    const results =
        await executeDependencyGraph({

            items: calls,

            maxParallel:
                settings.get("MAX_PARALLEL_TOOLS"),

            executor:
                async (
                    call,
                    results
                ) => {

                    assertRunActive(
                        `tool ${call.name}`
                    );

                    assertToolAllowed(
                        call.name,
                        allowedTools
                    );

                    const resolved =
                        resolveArgumentReferences(
                            call.arguments,
                            results,
                            call.depends_on,
                            callIds
                        );

                    /*
                    | An argument the tool does not declare used to be
                    | dropped in silence, so "fs_read with a content
                    | field" looked like a successful read instead of the
                    | mistake it is. The call still runs, and the result
                    | says what was ignored.
                    */

                    const checked =
                        keepDeclaredArguments(call.name, resolved);

                    const resolvedArguments =
                        checked.dropped.length > 0
                            ? checked.arguments
                            : resolved;

                    if (checked.dropped.length > 0) {

                        logLine(
                            scope,
                            `${call.name} does not take ${
                                checked.dropped.join(", ")
                            }; ignored`
                        );

                        events.emit("tool:arguments_ignored", {
                            agent: scope || "main_agent",
                            scope: scope || "main_agent",
                            id: call.id,
                            name: call.name,
                            dropped: checked.dropped
                        });
                    }

                    /*
                    | Policy is evaluated on the resolved arguments, so a
                    | value injected by a dependency cannot slip past a
                    | rule that inspects arguments.
                    */

                    await POLICY_ENGINE.enforce(
                        call.name,
                        resolvedArguments,
                        scope || "main_agent"
                    );

                    await enforceCrossProjectWrite(
                        call.name,
                        resolvedArguments,
                        scope || "main_agent"
                    );

                    logObject(
                        scope,
                        `Tool ${call.id} -> ${call.name}`,
                        resolvedArguments
                    );

                    events.emit("tool:start", {
                        agent:
                            scope || "main_agent",

                        scope:
                            scope || "main_agent",

                        id:
                            call.id,

                        name:
                            call.name,

                        graph_id:
                            graphId,

                        shape:
                            graph.shape,

                        wave:
                            waveOf.get(call.id) ?? null,

                        depends_on:
                            call.depends_on,

                        iteration:
                            context.iteration || null,

                        hook:
                            context.hook || null,

                        arguments:
                            resolvedArguments
                    });

                    const startedAt = Date.now();

                    try {

                        const result =
                            await toolRuntime.executeTool(
                                call.name,
                                resolvedArguments,

                                /*
                                | Identity comes from the run context,
                                | never from the call's arguments
                                | (rule 9). Legacy runs keep the exact
                                | historical { agent } shape.
                                */
                                (
                                    currentRun() instanceof AgentRunContext
                                        ? (() => {

                                              const project =
                                                  effectiveProject(currentRun().project);

                                              return {
                                                  agent: scope || "main_agent",
                                                  runId: currentRun().runId,
                                                  projectId:
                                                      projectIdOf(project) ??
                                                      currentRun().projectId ??
                                                      undefined,
                                                  projectContext:
                                                      project ?? undefined
                                              };

                                          })()
                                        : {
                                              agent: scope || "main_agent"
                                          }
                                )
                            );

                        /*
                        | Loading a skill is a decision, not plumbing,
                        | so the operator sees which agent took it.
                        */

                        if (
                            call.name === "skill_get" &&
                            result &&
                            Array.isArray(result.skills)
                        ) {

                            logLine(
                                scope,
                                `Loaded skill ${
                                    result.skills
                                        .map(skill => skill.name)
                                        .join(", ")
                                }`
                            );
                        }

                        /*
                        | The warning travels with the result, because
                        | that is the only place the model reliably
                        | reads.
                        */

                        if (
                            checked.dropped.length > 0 &&
                            result &&
                            typeof result === "object" &&
                            !Array.isArray(result)
                        ) {

                            result.ignored_arguments =
                                checked.dropped;

                            result.note =
                                `${call.name} does not take ${
                                    checked.dropped.join(", ")
                                }. Those arguments were ignored; use the tool that does, or drop them.`;
                        }

                        /*
                        | A command that exits non-zero is data, not a
                        | tool failure, so the runtime keeps going. The
                        | console said "ok" for it, which is how a build
                        | that never ran looked like a build that
                        | passed, so the code travels with the event.
                        */

                        events.emit("tool:end", {
                            agent:
                                scope || "main_agent",

                            scope:
                                scope || "main_agent",

                            id:
                                call.id,

                            name:
                                call.name,

                            graph_id:
                                graphId,

                            wave:
                                waveOf.get(call.id) ?? null,

                            iteration:
                                context.iteration || null,

                            hook:
                                context.hook || null,

                            arguments:
                                resolvedArguments,

                            exit_code:
                                result &&
                                typeof result === "object"
                                    ? result.exit_code
                                    : undefined,

                            warning:
                                result &&
                                typeof result === "object"
                                    ? result.warning
                                    : undefined,

                            success: true,

                            duration_ms:
                                Date.now() - startedAt,

                            result
                        });

                        return result;

                    } catch (error) {

                        events.emit("tool:end", {
                            agent:
                                scope || "main_agent",

                            scope:
                                scope || "main_agent",

                            id:
                                call.id,

                            name:
                                call.name,

                            graph_id:
                                graphId,

                            wave:
                                waveOf.get(call.id) ?? null,

                            iteration:
                                context.iteration || null,

                            hook:
                                context.hook || null,

                            arguments:
                                resolvedArguments,

                            success: false,

                            duration_ms:
                                Date.now() - startedAt,

                            error:
                                error.message
                        });

                        throw error;
                    }
                }
        });

    /*
    | Each result carries the tool name so the model can read the
    | tool message without correlating ids by itself.
    */

    const named =
        results.map(
            (result, index) => ({
                ...result,

                name:
                    calls[index].name
            })
        );

    for (
        const result
        of named
    ) {

        logObject(
            scope,
            `Tool result ${result.id} (${
                result.success
                    ? "success"
                    : "failed"
            })`,
            result.success
                ? result.result
                : result.error
        );
    }

    return named;
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

function isRetryableStatus(status) {

    return (
        status === 408 ||
        status === 409 ||
        status === 425 ||
        status === 429 ||
        status >= 500
    );
}


function retryDelayMs(attempt, retryAfterHeader) {

    if (retryAfterHeader) {

        const seconds =
            Number(retryAfterHeader);

        if (Number.isFinite(seconds)) {

            return Math.min(
                seconds * 1000,
                30000
            );
        }
    }

    const backoff =
        settings.get("RETRY_BASE_MS") * Math.pow(2, attempt - 1);

    return Math.min(
        backoff + Math.floor(Math.random() * settings.get("RETRY_BASE_MS")),
        30000
    );
}


async function callAI(options) {

    let lastError;

    for (
        let attempt = 1;
        attempt <= settings.get("MAX_REQUEST_RETRIES") + 1;
        attempt++
    ) {

        try {

            return await sendAgentRequest(options);

        } catch (error) {

            lastError = error;

            const retryable =
                error.retryable === true;

            if (
                !retryable ||
                attempt > settings.get("MAX_REQUEST_RETRIES")
            ) {
                throw error;
            }

            const delay =
                retryDelayMs(
                    attempt,
                    error.retryAfter
                );

            if (runRemainingMs() <= delay) {

                throw new Error(
                    `${error.message} (no time left in the run budget to retry)`
                );
            }

            logLine(
                options.scope,
                `Request failed (${
                    error.message.slice(0, 120)
                }); retrying in ${delay} ms [attempt ${
                    attempt
                }/${settings.get("MAX_REQUEST_RETRIES")}]`
            );

            await new Promise(
                resolve =>
                    setTimeout(resolve, delay)
            );
        }
    }

    throw lastError;
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

    const text =
        stripCodeFence(String(raw)).trim();

    try {

        const parsed = JSON.parse(text);

        /*
        | Arguments are always an object. An array or a bare value parses
        | cleanly and would then reach a tool as nonsense, so it is
        | refused here rather than deeper in.
        */

        if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {

            return {
                arguments: parsed,
                repaired: false
            };
        }

        return { failed: "the arguments are not a JSON object" };

    } catch {

        /* fall through to the salvage pass */
    }

    const start = text.indexOf("{");

    if (start === -1) {

        return { failed: "there is no JSON object in the arguments" };
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index++) {

        const character = text[index];

        if (escaped) {

            escaped = false;

            continue;
        }

        if (character === "\\" && inString) {

            escaped = true;

            continue;
        }

        if (character === '"') {

            inString = !inString;

            continue;
        }

        if (inString) {
            continue;
        }

        if (character === "{") {

            depth++;

            continue;
        }

        if (character !== "}") {
            continue;
        }

        depth--;

        if (depth !== 0) {
            continue;
        }

        const candidate =
            text.slice(start, index + 1);

        try {

            const parsed = JSON.parse(candidate);

            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                return { failed: "the arguments are not a JSON object" };
            }

            return {
                arguments: parsed,

                repaired: true,

                ignored:
                    text.slice(index + 1).trim()
            };

        } catch {

            return { failed: "the arguments are not valid JSON" };
        }
    }

    return { failed: "the arguments are not valid JSON" };
}


/*
| An error the model itself can fix by answering again. The loop turns
| it into a notice and asks for another answer instead of ending the
| run, because one badly serialised call is not a failed objective.
*/

function keepDeclaredArguments(name, args) {

    const declared =
        TOOLS_OF().find(
            tool => tool.function.name === name
        );

    const properties =
        declared?.function?.parameters?.properties;

    if (!properties) {

        return { arguments: args, dropped: [] };
    }

    const kept = {};
    const dropped = [];

    for (const [key, value] of Object.entries(args)) {

        if (Object.prototype.hasOwnProperty.call(properties, key)) {

            kept[key] = value;

            continue;
        }

        dropped.push(key);
    }

    return { arguments: kept, dropped };
}


function modelResponseError(message, code, details) {

    const error = new Error(message);

    error.model_response = true;

    error.code = code || "MALFORMED_RESPONSE";

    error.details =
        details && typeof details === "object"
            ? details
            : {};

    return error;
}


function isModelResponseError(error) {

    return Boolean(error && error.model_response === true);
}


function responsePreview(data, limit = 2400) {

    const message =
        data?.choices?.[0]?.message;

    if (!message) {
        return null;
    }

    let value;

    if (
        typeof message.content === "string" &&
        message.content.trim() !== ""
    ) {

        value = message.content.trim();

    } else if (
        message.content &&
        typeof message.content === "object"
    ) {

        value = message.content;

    } else if (Array.isArray(message.tool_calls)) {

        value = {
            tool_calls:
                message.tool_calls
        };
    }

    if (value === undefined) {
        return null;
    }

    const text =
        typeof value === "string"
            ? value
            : JSON.stringify(value);

    return text.length > limit
        ? `${text.slice(0, limit)}…[truncated]`
        : text;
}


function truncatedResponseError(data) {

    const choice = data?.choices?.[0];
    const finishReason = choice?.finish_reason;

    if (!["length", "max_tokens"].includes(finishReason)) {
        return null;
    }

    const content =
        typeof choice?.message?.content === "string"
            ? choice.message.content
            : "";

    const nativeCalls =
        Array.isArray(choice?.message?.tool_calls)
            ? choice.message.tool_calls
            : [];

    const detectedAction =
        /"action"\s*:\s*"(tool_call|delegate|final)"/.exec(content)?.[1] ||
        (nativeCalls.length > 0 ? "tool_call" : null);

    const detectedTool =
        detectedAction === "tool_call"
            ? (
                /"name"\s*:\s*"([^"]+)"/.exec(content)?.[1] ||
                nativeCalls[0]?.function?.name ||
                null
            )
            : null;

    const completionTokens =
        Number.isFinite(data?.usage?.completion_tokens)
            ? data.usage.completion_tokens
            : null;

    return modelResponseError(
        `The endpoint truncated the model response${
            completionTokens !== null
                ? ` after ${completionTokens} completion tokens`
                : ""
        } (finish_reason: "${finishReason}"); the partial action was not executed. Raise MAX_RESPONSE_TOKENS if this endpoint supports a larger output, or return a smaller complete action.`,
        "TRUNCATED_RESPONSE",
        {
            truncated: true,
            finish_reason: finishReason,
            completion_tokens: completionTokens,
            output_chars:
                content.length || JSON.stringify(nativeCalls).length,
            detected_action: detectedAction,
            tool: detectedTool,
            rejected_response: responsePreview(data)
        }
    );
}


function compactToolParameterSchema(name) {

    const tool =
        TOOLS_OF().find(
            item => item.function.name === name
        );

    const parameters =
        tool?.function?.parameters;

    if (!parameters) {
        return null;
    }

    const properties = {};

    for (
        const [key, definition]
        of Object.entries(parameters.properties || {})
    ) {

        properties[key] = {
            type:
                definition.type ||
                (
                    definition.anyOf
                        ? definition.anyOf.map(item => item.type).filter(Boolean)
                        : undefined
                ),

            enum:
                definition.enum,

            description:
                typeof definition.description === "string"
                    ? definition.description.slice(0, 300)
                    : undefined
        };

        for (const field of Object.keys(properties[key])) {

            if (properties[key][field] === undefined) {
                delete properties[key][field];
            }
        }
    }

    return {
        tool: name,
        arguments_must_be:
            settings.get("AGENT_SCHEMA") === "strict"
                ? "one JSON object encoded as a string"
                : "one JSON object",
        required:
            parameters.required ||
            [],
        properties,
        additional_properties_allowed:
            parameters.additionalProperties !== false
    };
}


function canonicalActionExamples() {

    const argumentsValue =
        settings.get("AGENT_SCHEMA") === "strict"
            ? JSON.stringify({
                path: "IMPLEMENTATION_PLAN.md"
            })
            : {
                path: "IMPLEMENTATION_PLAN.md"
            };

    return {
        tool_call: {
            version: "1.0",
            action: "tool_call",
            tool_calls: [
                {
                    id: "read_plan",
                    name: "fs_read",
                    arguments: argumentsValue,
                    depends_on: []
                }
            ],
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        },

        delegate: {
            version: "1.0",
            action: "delegate",
            tool_calls: null,
            delegations: [
                {
                    id: "analyze_1",
                    agent: "code_analysis",
                    persona: null,
                    skills: null,
                    tools: null,
                    task:
                        "Inspect the relevant files and report findings with evidence.",
                    depends_on: []
                }
            ],
            response: null,
            data: null,
            error: null,
            performed: null
        },

        final: {
            version: "1.0",
            action: "final",
            tool_calls: null,
            delegations: null,
            response: {
                type: "text",
                content: "The actual result for the user."
            },
            data: null,
            error: null,
            performed: null
        }
    };
}


function malformedRepairHint(reason, details) {

    const action =
        details?.detected_action;

    if (details?.truncated) {

        return "The endpoint cut the previous answer off before its JSON closed. Return one much smaller complete action now; do not resend the full oversized payload. Prefer a concise change or a localized fs_edit. For a genuinely large new file, write a temporary path in bounded chunks across iterations (overwrite first, append later), then move it into place only after it is complete.";
    }

    const missingTopLevel =
        /missing required top-level field "([^"]+)"/i.exec(reason);

    if (missingTopLevel) {

        return `Return the complete top-level ${action || "action"} envelope. The field "${missingTopLevel[1]}" was absent; copy the closest valid shape exactly and replace only its example values.`;
    }

    const missingCallFields =
        /Tool call is missing required field\(s\): ([^.]+)\./i.exec(reason);

    if (missingCallFields) {

        return `Every tool_calls item must contain id, name, arguments and depends_on. This item is missing ${missingCallFields[1]}; use one arguments object and use depends_on: [] only when the call is genuinely independent.`;
    }

    if (/Each tool call must be an object/i.test(reason)) {

        return "Every tool_calls item must be one object with exactly id, name, arguments and depends_on. Remove prose and misplaced envelope values from the array, but do not omit an intended call.";
    }

    if (
        action === "delegate" &&
        /delegations/i.test(reason)
    ) {

        return "You selected delegate but did not provide a delegation. If you really need a sub-agent, keep action=delegate and add at least one complete delegation. If your next step is reading, searching, running, or writing, change action to tool_call and call the tool now.";
    }

    if (
        action === "tool_call" &&
        /tool_calls/i.test(reason)
    ) {

        return "You selected tool_call but did not provide a call. Add at least one complete tool call. Do not describe the intended call in data, response, or prose.";
    }

    if (
        action === "final" ||
        /Final response/i.test(reason)
    ) {

        return "action=final requires a non-null response object with type and content. If an operation is still needed, do not use final; return tool_call or delegate with a non-empty active array.";
    }

    if (details?.tool) {

        return `Rewrite the arguments for "${details.tool}" as exactly one JSON object containing only that tool's declared parameters. Do not append prose, result fields, or another object.`;
    }

    return "Rebuild the whole response from one canonical example. Choose the action from the operation you are returning now, replace the example values, and keep every inactive field null.";
}


/*
| A malformed answer is the model's mistake, not a failed objective, so
| the runtime hands the rejected answer, the exact error, and valid shapes
| back to the model. This makes the next request a correction attempt,
| not a blind repetition of the same input.
*/

function malformedNoticeMessage(error, attempt, retryLimit) {

    const reason =
        typeof error === "string"
            ? error
            : error?.message || "Malformed model response.";

    const code =
        typeof error === "object" && error?.code
            ? error.code
            : "MALFORMED_RESPONSE";

    const details =
        typeof error === "object" && error?.details
            ? error.details
            : {};

    const examples =
        canonicalActionExamples();

    const detectedAction =
        ["tool_call", "delegate", "final"].includes(
            details.detected_action
        )
            ? details.detected_action
            : null;

    const maximumAttempts =
        retryLimit + 1;

    return {
        role: "user",

        content:
            JSON.stringify({
                type: "runtime_notice",
                notice: "malformed_response",

                correction_attempt: {
                    attempt,
                    maximum_attempts: maximumAttempts,
                    attempts_left:
                        Math.max(0, maximumAttempts - attempt)
                },

                error: {
                    code,
                    message: reason
                },

                response_diagnostics:
                    details.truncated
                        ? {
                            finish_reason: details.finish_reason,
                            completion_tokens: details.completion_tokens,
                            output_chars: details.output_chars
                        }
                        : null,

                rejected_response:
                    details.rejected_response ||
                    null,

                detected_action: detectedAction,

                repair: {
                    instruction:
                        "Your previous answer was rejected before any action ran. Do not repeat it. Return a corrected replacement as exactly one JSON object, with no Markdown fence or prose before or after it.",

                    issue_specific:
                        malformedRepairHint(reason, details),

                    action_field_matrix: {
                        tool_call:
                            "tool_calls must be a non-empty array; delegations, response, data, error and performed must be null.",
                        delegate:
                            "delegations must be a non-empty array; tool_calls, response, data, error and performed must be null.",
                        final:
                            "response must be a non-null {type, content} object; tool_calls and delegations must be null. data, error and performed are final-only."
                    },

                    closest_valid_shape:
                        detectedAction
                            ? examples[detectedAction]
                            : null,

                    canonical_complete_examples:
                        examples,

                    expected_tool_arguments:
                        details.tool
                            ? compactToolParameterSchema(details.tool)
                            : null,

                    checklist: [
                        "version is the top-level literal string 1.0, never an item inside tool_calls or delegations",
                        "action matches the one active field",
                        "the active array is not empty, or final response is non-null",
                        "all inactive and non-final fields are null",
                        "all required nested fields are present",
                        "the output contains one JSON object and nothing else"
                    ]
                }
            })
    };
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

    if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args)
    ) {
        return { arguments: args, repaired_fields: [] };
    }

    const declared =
        TOOLS_OF().find(
            tool => tool.function.name === name
        );

    const properties =
        declared?.function?.parameters?.properties || {};

    const pathFields =
        new Set([
            "path",
            "paths",
            "cwd",
            "source",
            "destination"
        ]);

    const repaired = { ...args };
    const fields = [];

    const clean = value => {

        if (typeof value !== "string") {
            return value;
        }

        return value.replace(
            /\[([^\]\r\n]+)\]\(https?:\/\/[^)\s]+\)/g,
            "$1"
        );
    };

    for (const [field, value] of Object.entries(args)) {

        if (
            !pathFields.has(field) ||
            !Object.prototype.hasOwnProperty.call(properties, field)
        ) {
            continue;
        }

        const next =
            Array.isArray(value)
                ? value.map(clean)
                : clean(value);

        if (JSON.stringify(next) !== JSON.stringify(value)) {
            repaired[field] = next;
            fields.push(field);
        }
    }

    return {
        arguments: repaired,
        repaired_fields: fields
    };
}


function repairStructuredAction(value) {

    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !["tool_call", "delegate", "final"].includes(value.action)
    ) {

        return {
            action: value,
            repaired: false,
            moved_fields: [],
            defaulted_fields: [],
            removed_items: [],
            argument_repairs: []
        };
    }

    const activeField =
        value.action === "tool_call"
            ? "tool_calls"
            : value.action === "delegate"
                ? "delegations"
                : null;

    const action = {
        ...value,

        ...(activeField && Array.isArray(value[activeField])
            ? { [activeField]: [...value[activeField]] }
            : {})
    };

    const moved = [];
    const defaulted = [];
    const removed = [];
    const argumentRepairs = [];

    if (activeField && Array.isArray(action[activeField])) {

        const expectedNull =
            value.action === "tool_call"
                ? new Set(["delegations", "response", "data", "error", "performed"])
                : new Set(["tool_calls", "response", "data", "error", "performed"]);

        const canMove = (field, fieldValue) => {

            if (
                Object.prototype.hasOwnProperty.call(action, field) ||
                field === activeField
            ) {
                return false;
            }

            if (field === "version") {
                return fieldValue === "1.0";
            }

            return expectedNull.has(field) && fieldValue === null;
        };

        while (action[activeField].length > 0) {

            const last =
                action[activeField][action[activeField].length - 1];

            let field;
            let fieldValue;
            let remove = 0;

            if (
                Array.isArray(last) &&
                last.length === 2 &&
                typeof last[0] === "string"
            ) {

                [field, fieldValue] = last;
                remove = 1;

            } else if (
                action[activeField].length >= 2 &&
                typeof action[activeField][action[activeField].length - 2] === "string"
            ) {

                field = action[activeField][action[activeField].length - 2];
                fieldValue = last;
                remove = 2;

            } else if (
                typeof last === "string"
            ) {

                /* The model sometimes closes the object one bracket too
                   late and drops the envelope pair as a single trailing
                   string item instead of two tokens or an array pair, e.g.
                   "version": "1.0". Version's value is protocol-fixed, so
                   recovering it deterministically (never guessing) is safe
                   and avoids burning a malformed retry on the same bracket
                   mistake. Only version is treated this way; any other
                   trailing string is left alone. */
                const leakedVersion =
                    /^"?version"?\s*:\s*"?([^"]*)"?$/.exec(
                        last
                    );

                if (
                    leakedVersion &&
                    leakedVersion[1] === "1.0"
                ) {

                    field = "version";
                    fieldValue = "1.0";
                    remove = 1;
                }
            }

            if (!remove || !canMove(field, fieldValue)) {
                break;
            }

            action[activeField].splice(-remove, remove);
            action[field] = fieldValue;
            moved.unshift(field);
        }

        /* A dangling "version" item is also impossible array content. The
           value is protocol-fixed, so removing it and defaulting below is
           deterministic rather than a guess. */
        if (
            !Object.prototype.hasOwnProperty.call(action, "version") &&
            action[activeField][action[activeField].length - 1] === "version"
        ) {

            action[activeField].pop();
            removed.push(`${activeField}[-1]:version`);
        }
    }

    /* Version 1.0 is runtime metadata with one legal value. Requiring a weak
       model to repeat it correctly adds failure surface but no information. */
    if (!Object.prototype.hasOwnProperty.call(action, "version")) {
        action.version = "1.0";
        defaulted.push("version");
    }

    /* Missing inactive envelope fields carry no model-owned information: for
       the selected branch their only valid value is null. The final-only data,
       error and performed fields also define absence as null. Filling those
       deterministic values is safe; active fields such as tool_calls,
       delegations and response are deliberately never invented. */
    const envelopeDefaults = {
        tool_call: {
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        },
        delegate: {
            tool_calls: null,
            response: null,
            data: null,
            error: null,
            performed: null
        },
        final: {
            tool_calls: null,
            delegations: null,
            data: null,
            error: null,
            performed: null
        }
    };

    for (
        const [field, fieldValue]
        of Object.entries(envelopeDefaults[action.action])
    ) {

        if (!Object.prototype.hasOwnProperty.call(action, field)) {
            action[field] = fieldValue;
            defaulted.push(field);
        }
    }

    if (action.action === "tool_call" && Array.isArray(action.tool_calls)) {

        action.tool_calls =
            action.tool_calls.map(call => {

                if (
                    !call ||
                    typeof call !== "object" ||
                    Array.isArray(call)
                ) {
                    return call;
                }

                /* depends_on is fixed protocol metadata whose only legal
                   value for an independent call is []. normalizeToolCalls
                   and adaptNativeToolCalls both already default a missing
                   depends_on, so rejecting it here only spends a retry on
                   a value the runtime can derive deterministically. Only a
                   genuinely absent field is defaulted; a malformed value
                   (e.g. a plain string) is left alone so it still fails
                   loudly rather than silently dropping a dependency the
                   model meant to declare. */
                let normalized = call;

                if (
                    !Object.prototype.hasOwnProperty.call(call, "depends_on")
                ) {

                    normalized = {
                        ...call,
                        depends_on: []
                    };

                    defaulted.push(
                        `${activeField}.${call.id || "?"}.depends_on`
                    );
                }

                const pathRepair =
                    repairMarkdownPathArguments(
                        normalized.name,
                        normalized.arguments
                    );

                if (pathRepair.repaired_fields.length > 0) {

                    argumentRepairs.push({
                        call_id: normalized.id || null,
                        tool: normalized.name,
                        fields: pathRepair.repaired_fields
                    });

                    return {
                        ...normalized,
                        arguments: pathRepair.arguments
                    };
                }

                return normalized;
            });
    }

    /* Delegations have the same fixed-protocol depends_on default as tool
       calls, and executeDelegations already defaults a missing depends_on to
       []. validateAction would otherwise reject it and spend a retry on a
       value the runtime can derive, so the same repair is applied here. The
       model-owned fields (agent, persona, task, tools, skills) are never
       invented; only a genuinely absent depends_on is defaulted. */
    if (action.action === "delegate" && Array.isArray(action.delegations)) {

        action.delegations =
            action.delegations.map(delegation => {

                if (
                    !delegation ||
                    typeof delegation !== "object" ||
                    Array.isArray(delegation)
                ) {
                    return delegation;
                }

                if (
                    !Object.prototype.hasOwnProperty.call(delegation, "depends_on")
                ) {

                    defaulted.push(
                        `${activeField}.${delegation.id || "?"}.depends_on`
                    );

                    return {
                        ...delegation,
                        depends_on: []
                    };
                }

                return delegation;
            });
    }

    return {
        action,
        repaired:
            moved.length > 0 ||
            defaulted.length > 0 ||
            removed.length > 0 ||
            argumentRepairs.length > 0,
        moved_fields: moved,
        defaulted_fields: defaulted,
        removed_items: removed,
        argument_repairs: argumentRepairs,
        source_field: activeField
    };
}

/*
| Parses and validates one model answer. Everything that is the model's
| fault is tagged, so the loop can tell a bad answer apart from a broken
| endpoint.
*/

function readModelAction(data) {

    let parsed;

    try {

        parsed = parseStructuredResponse(data);

    } catch (error) {

        /* A response capped mid-JSON is not an unexplained parser failure.
           The finish reason is authoritative and lets the correction prompt
           ask for a bounded write instead of repeating the same large action. */
        const truncated = truncatedResponseError(data);

        if (truncated) {
            throw truncated;
        }

        const rejectedResponse =
            responsePreview(data);

        if (isModelResponseError(error)) {

            error.details = {
                ...(error.details || {}),

                rejected_response:
                    error.details?.rejected_response ||
                    rejectedResponse
            };

            throw error;
        }

        throw modelResponseError(
            error.message,
            "UNREADABLE_RESPONSE",
            {
                rejected_response:
                    rejectedResponse
            }
        );
    }

    const envelopeRepair =
        repairStructuredAction(parsed.structured);

    if (envelopeRepair.repaired) {

        parsed.structured = envelopeRepair.action;

        /* The corrected action, not the malformed source string, belongs in
           the following tool conversation and any persisted session. */
        parsed.message.content =
            JSON.stringify(parsed.structured);

        const reportableRepair =
            envelopeRepair.moved_fields.length > 0 ||
            envelopeRepair.removed_items.length > 0 ||
            envelopeRepair.argument_repairs.length > 0;

        /* Defaulting fixed protocol metadata is normalisation, not an error.
           DeepSeek omits version routinely, so emitting a warning for every
           iteration only floods the event log with "repaired" noise. */
        if (reportableRepair) {

            events.emit("response:repaired", {
                repair: "action_envelope",
                tool: "action_envelope",
                dropped: [],
                source_field: envelopeRepair.source_field,
                moved_fields: envelopeRepair.moved_fields,
                defaulted_fields: envelopeRepair.defaulted_fields,
                removed_items: envelopeRepair.removed_items,
                argument_repairs: envelopeRepair.argument_repairs
            });

            const repairs = [
                envelopeRepair.moved_fields.length > 0
                    ? `moved ${envelopeRepair.moved_fields.join(", ")} out of ${envelopeRepair.source_field}`
                    : null,
                envelopeRepair.defaulted_fields.length > 0
                    ? `defaulted ${envelopeRepair.defaulted_fields.join(", ")}`
                    : null,
                envelopeRepair.removed_items.length > 0
                    ? `removed ${envelopeRepair.removed_items.join(", ")}`
                    : null,
                envelopeRepair.argument_repairs.length > 0
                    ? `cleaned Markdown links from ${
                        envelopeRepair.argument_repairs
                            .flatMap(item => item.fields.map(field => `${item.tool}.${field}`))
                            .join(", ")
                    }`
                    : null
            ].filter(Boolean);

            logLine(
                null,
                `Repaired the action envelope: ${repairs.join("; ")}.`
            );
        }
    }

    try {

        validateAction(parsed.structured);

    } catch (error) {

        throw modelResponseError(
            error.message,
            "INVALID_ACTION",
            {
                detected_action:
                    parsed.structured?.action ||
                    null,

                tool:
                    parsed.structured?.action === "tool_call" &&
                    Array.isArray(parsed.structured.tool_calls) &&
                    parsed.structured.tool_calls.length === 1
                        ? parsed.structured.tool_calls[0]?.name || null
                        : null,

                rejected_response:
                    responsePreview(data) ||
                    JSON.stringify(parsed.structured).slice(0, 2400)
            }
        );
    }

    return parsed;
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

    const nativeCalls =
        Array.isArray(message.tool_calls)
            ? message.tool_calls
            : [];

    if (nativeCalls.length === 0) {
        return null;
    }

    return {
        version: "1.0",

        action: "tool_call",

        tool_calls:
            nativeCalls.map(
                (call, index) => {

                    const name =
                        call?.function?.name;

                    if (!name) {

                        throw modelResponseError(
                            "Native tool call is missing a function name.",
                            "MISSING_TOOL_NAME"
                        );
                    }

                    let parsedArguments = {};

                    const rawArguments =
                        call.function.arguments;

                    if (
                        typeof rawArguments === "string" &&
                        rawArguments.trim() !== ""
                    ) {

                        const read =
                            parseToolArguments(rawArguments);

                        if (read.failed) {

                            throw modelResponseError(
                                `Native tool call "${name}" has arguments that are not valid JSON: ${
                                    read.failed
                                }.`,
                                "MALFORMED_TOOL_ARGUMENTS",
                                {
                                    detected_action:
                                        "tool_call",

                                    tool:
                                        name,

                                    rejected_arguments:
                                        String(rawArguments).slice(0, 1200)
                                }
                            );
                        }

                        parsedArguments = read.arguments;

                        if (read.repaired) {

                            /*
                            | A salvaged object often carries the keys of
                            | the result the model was copying, so only
                            | the parameters the tool declares are kept.
                            */

                            const cleaned =
                                keepDeclaredArguments(
                                    name,
                                    parsedArguments
                                );

                            parsedArguments = cleaned.arguments;

                            events.emit("response:repaired", {
                                tool: name,

                                dropped:
                                    cleaned.dropped,

                                ignored:
                                    (read.ignored || "").slice(0, 200)
                            });

                            logLine(
                                null,
                                `Repaired the arguments of "${name}"${
                                    cleaned.dropped.length > 0
                                        ? `, ignoring ${cleaned.dropped.join(", ")}`
                                        : ""
                                }`
                            );
                        }

                    } else if (
                        rawArguments &&
                        typeof rawArguments === "object"
                    ) {

                        parsedArguments = rawArguments;
                    }

                    const pathRepair =
                        repairMarkdownPathArguments(
                            name,
                            parsedArguments
                        );

                    if (pathRepair.repaired_fields.length > 0) {

                        parsedArguments = pathRepair.arguments;

                        events.emit("response:repaired", {
                            repair: "markdown_path",
                            tool: name,
                            repaired_fields: pathRepair.repaired_fields
                        });

                        logLine(
                            null,
                            `Repaired Markdown links in ${name}.${
                                pathRepair.repaired_fields.join(`, ${name}.`)
                            }.`
                        );
                    }

                    return {
                        id:
                            call.id ||
                            `call_${index + 1}`,

                        name,

                        arguments:
                            parsedArguments,

                        depends_on: []
                    };
                }
            ),

        delegations: null,

        response: null,

        data: null,

        error: null,

        performed: null
    };
}


/*
| Models occasionally wrap the JSON object in a markdown fence even when
| a schema was requested. Unwrapping it is cheaper than losing the run.
*/

function stripCodeFence(text) {

    const match =
        /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);

    return match
        ? match[1]
        : text;
}


function parseStructuredResponse(
    data
) {

    const message =
        data?.choices?.[0]?.message;

    if (!message) {

        throw new Error(
            "AI response does not contain a message."
        );
    }

    if (
        typeof message.content === "object" &&
        message.content !== null
    ) {

        return {
            message,

            structured:
                message.content,

            source:
                "structured_content"
        };
    }

    if (typeof message.content === "string") {

        const candidate =
            stripCodeFence(message.content).trim();

        if (candidate !== "") {

            try {

                return {
                    message,

                    structured:
                        JSON.parse(candidate),

                    source:
                        "structured_content"
                };

            } catch {

                /* fall through to the native protocol adapter */
            }
        }
    }

    const adapted =
        adaptNativeToolCalls(message);

    if (adapted) {

        return {
            message,

            structured:
                adapted,

            source:
                "native_tool_calls"
        };
    }

    throw new Error(
        `AI returned neither structured JSON nor a native tool call. Content: ${
            typeof message.content === "string"
                ? message.content.slice(0, 200)
                : typeof message.content
        }`
    );
}


/*
|--------------------------------------------------------------------------
| Action Validation
|--------------------------------------------------------------------------
*/

function validateActionGraph(items, noun) {

    const ids =
        new Set();

    for (const item of items) {

        if (
            typeof item.id !== "string" ||
            item.id.trim() === ""
        ) {

            throw new Error(
                `${noun}.id is required and must be non-empty.`
            );
        }

        if (ids.has(item.id)) {

            throw new Error(
                `Duplicate ${noun} id: ${item.id}`
            );
        }

        ids.add(item.id);

        if (!Array.isArray(item.depends_on)) {

            throw new Error(
                `${noun}.depends_on must be an array; use [] when there is no dependency.`
            );
        }
    }

    for (const item of items) {

        for (const dependency of item.depends_on) {

            if (
                typeof dependency !== "string" ||
                dependency.trim() === ""
            ) {

                throw new Error(
                    `${noun}.depends_on entries must be non-empty ids.`
                );
            }

            if (!ids.has(dependency)) {

                throw new Error(
                    `${noun} "${item.id}" depends on unknown id "${dependency}".`
                );
            }

            if (dependency === item.id) {

                throw new Error(
                    `${noun} "${item.id}" cannot depend on itself.`
                );
            }
        }
    }

    const visiting = new Set();
    const visited = new Set();
    const byId =
        new Map(items.map(item => [item.id, item]));

    const visit = id => {

        if (visiting.has(id)) {

            throw new Error(
                `${noun} dependency graph contains a cycle at "${id}".`
            );
        }

        if (visited.has(id)) {
            return;
        }

        visiting.add(id);

        for (const dependency of byId.get(id).depends_on) {
            visit(dependency);
        }

        visiting.delete(id);
        visited.add(id);
    };

    for (const id of ids) {
        visit(id);
    }
}


function requireNullFields(action, fields) {

    for (const field of fields) {

        if (action[field] !== null) {

            throw new Error(
                `${field} must be null when action is "${action.action}".`
            );
        }
    }
}


/* Phase 12: a delegation may name a project. Missing / null means
   inherit the active project. Both camelCase (implementation plan)
   and snake_case are accepted; conflicting values are rejected. */
function requestedDelegationProjectId(delegation) {

    if (!delegation || typeof delegation !== "object") {

        return { value: null, error: null };

    }

    const hasCamel =
        Object.prototype.hasOwnProperty.call(delegation, "projectId");

    const hasSnake =
        Object.prototype.hasOwnProperty.call(delegation, "project_id");

    const rawCamel = hasCamel ? delegation.projectId : undefined;

    const rawSnake = hasSnake ? delegation.project_id : undefined;

    const normalize = value => {

        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value !== "string") {

            return { error: "delegation.projectId must be a string or null." };

        }

        const trimmed = value.trim();

        if (trimmed === "") {

            return { error: "delegation.projectId must be a non-empty string when set." };

        }

        return { value: trimmed };

    };

    const camel = normalize(rawCamel);

    if (camel && camel.error) {
        return { value: null, error: camel.error };
    }

    const snake = normalize(rawSnake);

    if (snake && snake.error) {
        return { value: null, error: snake.error };
    }

    const camelValue = camel ? camel.value : null;

    const snakeValue = snake ? snake.value : null;

    if (
        hasCamel &&
        hasSnake &&
        camelValue &&
        snakeValue &&
        camelValue !== snakeValue
    ) {

        return {
            value: null,
            error: "delegation.projectId and project_id disagree."
        };

    }

    return {
        value: camelValue || snakeValue || null,
        error: null
    };

}


function delegationProjectSwitchEnabled() {

    return (
        projects.projectContextMode() === "modular" &&
        runContextMode() === "modular"
    );

}


function findingsFromReport(report) {

    if (!report || typeof report !== "object") {
        return [];
    }

    if (Array.isArray(report.findings)) {
        return report.findings;
    }

    const content =
        report.response &&
        typeof report.response.content === "string"
            ? report.response.content.trim()
            : "";

    if (content !== "") {
        return [report.response.content];
    }

    if (Array.isArray(report.data)) {
        return report.data;
    }

    if (report.data !== undefined && report.data !== null) {
        return [report.data];
    }

    return [];

}


function validateAction(
    action
) {

    if (
        !action ||
        typeof action !== "object" ||
        Array.isArray(action)
    ) {

        throw new Error(
            "Empty agent action."
        );
    }

    const requiredFields = [
        "version",
        "action",
        "tool_calls",
        "delegations",
        "response",
        "data",
        "error"
    ];

    for (const field of requiredFields) {

        if (!Object.prototype.hasOwnProperty.call(action, field)) {

            throw new Error(
                `Agent action is missing required top-level field "${field}".`
            );
        }
    }

    const allowedFields =
        new Set([
            ...requiredFields,
            "performed"
        ]);

    const extraFields =
        Object.keys(action).filter(
            field => !allowedFields.has(field)
        );

    if (extraFields.length > 0) {

        throw new Error(
            `Agent action contains unknown top-level field(s): ${extraFields.join(", ")}.`
        );
    }

    if (action.version !== "1.0") {

        throw new Error(
            'version must be the literal string "1.0".'
        );
    }

    if (
        ![
            "tool_call",
            "delegate",
            "final"
        ].includes(
            action.action
        )
    ) {

        throw new Error(
            `Invalid action: ${action.action}`
        );
    }

    if (
        action.action ===
        "tool_call"
    ) {

        if (
            !Array.isArray(
                action.tool_calls
            ) ||
            action.tool_calls.length === 0
        ) {

            throw new Error(
                "tool_calls must contain at least one call."
            );
        }

        requireNullFields(
            action,
            [
                "delegations",
                "response",
                "data",
                "error"
            ]
        );

        if (
            action.performed !== undefined &&
            action.performed !== null
        ) {

            throw new Error(
                'performed must be null when action is "tool_call".'
            );
        }

        for (
            const call
            of action.tool_calls
        ) {

            if (
                !call ||
                typeof call !== "object" ||
                Array.isArray(call)
            ) {

                throw new Error(
                    "Each tool call must be an object."
                );
            }

            const callFields =
                ["id", "name", "arguments", "depends_on"];

            const missing =
                callFields.filter(
                    field =>
                        !Object.prototype.hasOwnProperty.call(call, field)
                );

            if (missing.length > 0) {

                throw new Error(
                    `Tool call is missing required field(s): ${missing.join(", ")}.`
                );
            }

            const extras =
                Object.keys(call).filter(
                    field => !callFields.includes(field)
                );

            if (extras.length > 0) {

                throw new Error(
                    `Tool call contains unknown field(s): ${extras.join(", ")}.`
                );
            }

            if (
                typeof call.name !== "string" ||
                call.name.trim() === ""
            ) {

                throw new Error(
                    "tool_call.name is required."
                );
            }

            try {

                parseArguments(
                    call.arguments,
                    call.name
                );

            } catch (error) {

                throw new Error(
                    error.message
                );
            }

            if (
                !call.arguments ||
                (
                    typeof call.arguments !== "object" &&
                    typeof call.arguments !== "string"
                ) ||
                Array.isArray(call.arguments)
            ) {

                throw new Error(
                    `tool_call.arguments is required for "${call.name}" and must be one JSON object${
                        settings.get("AGENT_SCHEMA") === "strict"
                            ? " encoded as a string"
                            : ""
                    }.`
                );
            }
        }

        validateActionGraph(
            action.tool_calls,
            "tool_call"
        );
    }

    if (
        action.action ===
        "delegate"
    ) {

        if (
            !Array.isArray(
                action.delegations
            ) ||
            action.delegations.length === 0
        ) {

            throw new Error(
                "delegations must contain at least one delegation."
            );
        }

        requireNullFields(
            action,
            [
                "tool_calls",
                "response",
                "data",
                "error"
            ]
        );

        if (
            action.performed !== undefined &&
            action.performed !== null
        ) {

            throw new Error(
                'performed must be null when action is "delegate".'
            );
        }

        for (
            const delegation
            of action.delegations
        ) {

            if (
                !delegation ||
                typeof delegation !== "object" ||
                Array.isArray(delegation)
            ) {

                throw new Error(
                    "Each delegation must be an object."
                );
            }

            const delegationFields = [
                "id",
                "agent",
                "persona",
                "skills",
                "tools",
                "task",
                "depends_on"
            ];

            /* Phase 12: optional additive project selector. camelCase
               matches the implementation-plan contract; project_id is
               accepted as an alias. Neither is required. */
            const optionalDelegationFields = [
                "projectId",
                "project_id"
            ];

            const missing =
                delegationFields.filter(
                    field =>
                        !Object.prototype.hasOwnProperty.call(
                            delegation,
                            field
                        )
                );

            if (missing.length > 0) {

                throw new Error(
                    `Delegation is missing required field(s): ${missing.join(", ")}.`
                );
            }

            const extras =
                Object.keys(delegation).filter(
                    field =>
                        !delegationFields.includes(field) &&
                        !optionalDelegationFields.includes(field)
                );

            if (extras.length > 0) {

                throw new Error(
                    `Delegation contains unknown field(s): ${extras.join(", ")}.`
                );
            }

            const requestedProject =
                requestedDelegationProjectId(delegation);

            if (requestedProject.error) {

                throw new Error(requestedProject.error);

            }

            const hasAgent =
                typeof delegation.agent === "string" &&
                delegation.agent.trim() !== "";

            const hasPersona =
                typeof delegation.persona === "string" &&
                delegation.persona.trim() !== "";

            if (!hasAgent && !hasPersona) {

                throw new Error(
                    "A delegation requires either agent or persona."
                );
            }

            if (hasAgent && hasPersona) {

                throw new Error(
                    "A delegation must use either a registered agent or an ad-hoc persona, not both."
                );
            }

            if (
                hasAgent &&
                (
                    delegation.skills !== null ||
                    delegation.tools !== null
                )
            ) {

                throw new Error(
                    "A registered-agent delegation must set persona, skills and tools to null."
                );
            }

            if (
                hasAgent &&
                delegation.persona !== null
            ) {

                throw new Error(
                    "A registered-agent delegation must set persona, skills and tools to null."
                );
            }

            if (
                !hasAgent &&
                (
                    !Array.isArray(delegation.skills) ||
                    !Array.isArray(delegation.tools)
                )
            ) {

                throw new Error(
                    "An ad-hoc delegation must provide skills and tools arrays."
                );
            }

            if (
                typeof delegation.task !== "string" ||
                delegation.task.trim() === ""
            ) {

                throw new Error(
                    `delegation.task is required for agent "${
                        delegation.agent ||
                        delegation.persona
                    }".`
                );
            }
        }

        validateActionGraph(
            action.delegations,
            "delegation"
        );
    }

    if (
        action.action ===
        "final"
    ) {

        requireNullFields(
            action,
            [
                "tool_calls",
                "delegations"
            ]
        );

        if (
            !action.response ||
            typeof action.response !==
            "object" ||
            Array.isArray(action.response)
        ) {

            throw new Error(
                "Final response is missing."
            );
        }

        const responseFields =
            ["type", "content"];

        const missing =
            responseFields.filter(
                field =>
                    !Object.prototype.hasOwnProperty.call(
                        action.response,
                        field
                    )
            );

        if (missing.length > 0) {

            throw new Error(
                `Final response is missing required field(s): ${missing.join(", ")}.`
            );
        }

        const extras =
            Object.keys(action.response).filter(
                field => !responseFields.includes(field)
            );

        if (extras.length > 0) {

            throw new Error(
                `Final response contains unknown field(s): ${extras.join(", ")}.`
            );
        }

        if (
            !["text", "code", "json", "markdown"].includes(
                action.response.type
            )
        ) {

            throw new Error(
                "Final response type must be text, code, json, or markdown."
            );
        }

        if (
            typeof action.response.content !==
            "string" ||
            action.response.content.trim() === ""
        ) {

            throw new Error(
                "Final response content must be a non-empty string."
            );
        }

        if (
            action.error !== null &&
            (
                typeof action.error !== "object" ||
                Array.isArray(action.error) ||
                Object.keys(action.error).some(
                    field =>
                        !["code", "message", "retryable"].includes(field)
                ) ||
                typeof action.error.code !== "string" ||
                action.error.code.trim() === "" ||
                typeof action.error.message !== "string" ||
                action.error.message.trim() === "" ||
                typeof action.error.retryable !== "boolean"
            )
        ) {

            throw new Error(
                "Final error must be null or exactly {code, message, retryable}."
            );
        }

        if (
            action.performed !== undefined &&
            action.performed !== null
        ) {

            if (
                typeof action.performed !== "object" ||
                Array.isArray(action.performed)
            ) {

                throw new Error(
                    "performed must be null or an object on a final action."
                );
            }

            const allowedClaimFields =
                ["tools", "agents", "files_changed"];

            const unknownClaimFields =
                Object.keys(action.performed).filter(
                    field => !allowedClaimFields.includes(field)
                );

            if (unknownClaimFields.length > 0) {

                throw new Error(
                    `performed contains unknown field(s): ${unknownClaimFields.join(", ")}.`
                );
            }

            for (const field of allowedClaimFields) {

                if (
                    action.performed[field] !== undefined &&
                    (
                        !Array.isArray(action.performed[field]) ||
                        action.performed[field].some(
                            value => typeof value !== "string"
                        )
                    )
                ) {

                    throw new Error(
                        `performed.${field} must be an array of strings.`
                    );
                }
            }
        }
    }
}

/*
|--------------------------------------------------------------------------
| OpenAI Tool Conversation
|--------------------------------------------------------------------------
*/

function appendToolConversation(
    messages,
    message,
    toolCalls,
    results,
    scope
) {

    messages.push({

        role: "assistant",

        content:
            message.content ??
            null,

        tool_calls:
            toolCalls.map(
                call => ({
                    id:
                        call.id,

                    type:
                        "function",

                    function: {
                        name:
                            call.name,

                        arguments:
                            JSON.stringify(
                                call.arguments
                            )
                    }
                })
            )
    });

    for (
        const result
        of results
    ) {

        messages.push({

            role: "tool",

            tool_call_id:
                result.id,

            content:
                JSON.stringify(
                    result
                )
        });
    }

    /*
    | Archived before compaction touches it, because a compressed result
    | is exactly the thing the archive exists to replace.
    */

    const appended =
        findExchanges(messages);

    archiveExchanges(
        messages,
        appended.slice(appended.length - 1),
        scope
    );

    const compaction =
        compactConversation(messages, {

            onDrop: (current, exchange) =>
                archiveExchanges(current, [exchange], scope)
        });

    if (compaction.compacted) {

        events.emit("context:compacted", {
            agent: scope || "main_agent",
            ...compaction
        });

        logLine(
            scope,
            `Context compacted: ${
                Math.round(compaction.before / 1000)
            }k -> ${
                Math.round(compaction.after / 1000)
            }k chars (${
                compaction.elided_results
            } results elided, ${
                compaction.dropped_exchanges
            } exchanges dropped)`
        );
    }
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

function validateDelegationPolicy(
    agentDefinition,
    depthBudget,
    delegations
) {

    const policy =
        agentDefinition.delegation || {
            enabled: false,
            max_depth: 0,
            max_children: 0
        };

    if (!policy.enabled) {

        throw modelResponseError(
            `Agent "${agentDefinition.name}" is not allowed to delegate.`,
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "delegation_disabled",
                max_children: 0
            }
        );
    }

    /*
    | max_depth is relative: it is how many levels an agent may create
    | beneath itself, further limited by what its parent had left.
    */

    if (depthBudget < 1) {

        throw modelResponseError(
            `Agent "${agentDefinition.name}" exceeded delegation depth.`,
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "delegation_depth",
                depth_budget: depthBudget
            }
        );
    }

    if (
        delegations.length >
        policy.max_children
    ) {

        throw modelResponseError(
            `Agent "${agentDefinition.name}" exceeded max_children (${policy.max_children}).`,
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "max_children",
                max_children: policy.max_children,
                delegations: delegations.length
            }
        );
    }
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

function resolveDepthBudget(
    agentDefinition,
    inheritedBudget
) {

    const policy =
        agentDefinition.delegation || {
            enabled: false,
            max_depth: 0
        };

    if (!policy.enabled) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            inheritedBudget,
            Number(policy.max_depth) || 0
        )
    );
}


/*
|--------------------------------------------------------------------------
| Unfinished Final Detection
|--------------------------------------------------------------------------
*/

function isUnfinishedFinal(action, progress) {

    if (action.action !== "final") {
        return false;
    }

    /*
    | A declared block is a legitimate stop, and so is a run that
    | actually did something.
    */

    if (action.error) {
        return false;
    }

    return (
        progress.tools === 0 &&
        progress.delegations === 0
    );
}


function failureSignature(results) {

    const failures =
        results.filter(
            result => !result.success
        );

    if (
        failures.length === 0 ||
        failures.length !== results.length
    ) {

        /*
        | Partial progress is not a loop.
        */

        return null;
    }

    return failures
        .map(
            result =>
                `${result.name}:${
                    (result.error && result.error.message) || ""
                }`
        )
        .sort()
        .join("|");
}


function trackRepeatedFailure(progress, results) {

    const signature =
        failureSignature(results);

    if (!signature) {

        progress.lastFailure = null;
        progress.repeats = 0;

        return 0;
    }

    if (signature === progress.lastFailure) {

        progress.repeats = (progress.repeats || 0) + 1;

    } else {

        progress.lastFailure = signature;
        progress.repeats = 1;
    }

    return progress.repeats;
}


/*
| A run that dies on its deadline throws away whatever it had. The last
| slice of the budget is therefore reserved for finishing: the agent is
| told to stop exploring and answer with what it has, which turns a
| cancelled run into a partial result and a named next step.
*/

function wrapUpMessage(remainingMs, planSummary) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type: "runtime_notice",

                notice: "budget_almost_spent",

                remaining_ms: remainingMs,

                max_run_ms:
                    settings.get("MAX_RUN_MS"),

                plan:
                    planSummary && planSummary.exists
                        ? {
                            done: planSummary.done,
                            open:
                                planSummary.pending +
                                planSummary.in_progress,
                            next_step: planSummary.next_step
                        }
                        : null,

                instruction:
                    "The run is nearly out of time. Do not start new work and do not call another tool unless it takes seconds. Return action final now: report what was actually done and verified, what remains, and the next concrete step. Record any finished step in the plan first if that costs one quick call."
            })
    };
}


function loopNoticeMessage(signature, repeats) {

    const pathGuessLoop =
        /does not exist/i.test(signature || "");

    const detail =
        "The same call failed the same way several times, so repeating it will not help. Read the error text literally and change something concrete: fix the argument it complains about, use a different tool, or split the work. If the error mentions a dependency reference, note that ${...} inside file content is treated as literal text only when it does not name a call in the same action, so rename the call id or escape the sequence as $${...}."

        + (pathGuessLoop
            ? " The repeated error is \"does not exist\": you are guessing a path. Do not keep probing guessed paths. Discover the real layout once with fs_list, fs_tree or search_start, and read only a path a tool result actually confirmed."
            : "");

    return {
        role: "user",

        content:
            JSON.stringify({
                type:
                    "runtime_notice",

                notice:
                    "repeated_failure",

                repeats,

                failure:
                    signature,

                detail
            })
    };
}


function planContinuationMessage(summary, remainingMs) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type:
                    "runtime_notice",

                notice:
                    "plan_incomplete",

                progress: {
                    done:
                        summary.done,

                    open:
                        summary.pending + summary.in_progress,

                    blocked:
                        summary.blocked,

                    total:
                        summary.steps
                },

                next_step:
                    summary.next_step,

                run_remaining_ms:
                    Math.max(0, remainingMs),

                detail:
                    "The plan still has open steps and this run still has budget, so the work is not finished. Continue with the next step: do it, verify it, record it with plan_update, and only then move on. Stop early only if you are blocked by something a tool cannot reach, in which case mark the step blocked and return final with error.code NEEDS_INPUT."
            })
    };
}


function nudgeMessage({
    iteration,
    maxIterations,
    remainingMs
}) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type:
                    "runtime_notice",

                notice:
                    "unfinished_run",

                detail:
                    "You returned a final answer without executing a single tool or delegation, so nothing in the workspace was inspected or changed. If the objective needs work, start it now: choose the next unfinished piece yourself, use the tools, verify the result, and report what you actually did. If you are genuinely blocked by a decision only the user can make, return final again with error.code set to NEEDS_INPUT and the specific question.",

                budget: {
                    iteration,

                    iterations_remaining:
                        maxIterations - iteration,

                    run_remaining_ms:
                        Math.max(0, remainingMs)
                }
            })
    };
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

async function runSubAgent(options) {

    try {

        return await runSubAgentLoop(options);

    } catch (error) {

        events.emit("agent:end", {
            agent:
                options.agentProfile?.name || "sub_agent",

            scope:
                `${
                    options.agentProfile?.name || "sub_agent"
                }#${options.depth}`,

            depth:
                options.depth,

            hook:
                options.context?.hook || null,

            success: false,

            error: error.message
        });

        throw error;
    }
}


async function runSubAgentLoop({
    agentProfile,
    task,
    depth,
    depthBudget,
    context
}) {

    if (
        depth >
        settings.get("MAX_AGENT_DEPTH")
    ) {

        throw new Error(
            `Maximum agent depth exceeded: ${settings.get("MAX_AGENT_DEPTH")}`
        );
    }

    const agentDefinition =
        agentProfile;

    const agentName =
        agentDefinition.name;

    consumeAgentBudget(
        agentName
    );

    const ownDepthBudget =
        resolveDepthBudget(
            agentDefinition,
            Number.isFinite(depthBudget)
                ? depthBudget
                : settings.get("MAX_AGENT_DEPTH")
        );

    const capabilities =
        resolveAgentCapabilities(
            agentDefinition
        );

    const allowedTools =
        new Set(
            capabilities.tools.map(
                tool =>
                    tool.function.name
            )
        );

    const messages =
        createSubAgentMessages(
            agentDefinition,
            task,
            context
        );

    const scope =
        `${agentName}#${depth}`;

    const progress = {
        tools: 0,
        delegations: 0,
        nudges: 0
    };

    events.emit("agent:start", {
        agent: agentName,
        scope,
        depth,
        task,

        /*
        | Who asked for this agent. Without it a console can only guess
        | the shape of the tree from the depth number.
        */

        parent:
            context?.parent || null,

        parent_scope:
            context?.parent_scope || null,

        delegation_id:
            context?.delegation_id || null,

        hook:
            context?.hook || null,

        persona:
            agentDefinition.persona || null,

        tools:
            [...allowedTools]
    });

    logLine(
        scope,
        `Sub-agent started: ${task}`
    );

    for (
        let iteration = 1;
        iteration <= settings.get("MAX_ITERATIONS");
        iteration++
    ) {

        assertRunActive(
            `sub-agent ${agentName}`
        );

        await maintainContext(messages, scope);

        refreshRuntimeContext(messages);

        events.setContext({ scope, iteration });

        events.emit("agent:iteration", {
            agent: agentName,
            scope,
            depth,
            iteration
        });

        logLine(
            scope,
            `Iteration ${iteration}`
        );

        const data =
            await callAI({
                messages,

                agentDefinition,

                tools:
                    capabilities.tools,

                role:
                    roleForDepth(depth),

                scope
            });

        /* Keep the provider response visible even when the structured action
           below turns out to be malformed. */
        reportModelResponse(data, scope, agentName, depth, iteration);

        let parsed;

        try {

            parsed = readModelAction(data);

        } catch (error) {

            if (!isModelResponseError(error)) {
                throw error;
            }

            if (progress.malformedCode !== error.code) {
                progress.malformed = 0;
                progress.malformedCode = error.code;
            }

            progress.malformed = (progress.malformed || 0) + 1;

            const limit =
                settings.get("MAX_MALFORMED_RESPONSES");

            const maximumAttempts =
                limit + 1;

            logLine(
                scope,
                `Unreadable answer (${error.message}) [${
                    progress.malformed
                }/${maximumAttempts}]`
            );

            events.emit("run:malformed", {
                agent: agentName,
                scope,
                depth,
                iteration,
                code: error.code,
                reason: error.message,
                finish_reason:
                    error.details?.finish_reason || null,
                completion_tokens:
                    error.details?.completion_tokens ?? null,
                output_chars:
                    error.details?.output_chars ?? null,
                attempt: progress.malformed,
                limit,
                max_attempts: maximumAttempts,
                retries_left:
                    Math.max(0, maximumAttempts - progress.malformed),
                outcome:
                    progress.malformed > limit
                        ? "stopped"
                        : "retry"
            });

            if (progress.malformed > limit) {
                throw error;
            }

            messages.push(
                malformedNoticeMessage(
                    error,
                    progress.malformed,
                    limit
                )
            );

            continue;
        }

        /* The correction succeeded. A malformed-answer allowance is a retry
           budget for one bad-response streak, not a lifetime quota that can
           stop an otherwise productive long run hours later. */
        progress.malformed = 0;
        progress.malformedCode = null;

        const message =
            parsed.message;

        const action =
            parsed.structured;

        events.emit("agent:action", {
            agent: agentName,
            scope,
            depth,
            iteration,
            action: action.action
        });

        logLine(
            scope,
            `Action: ${action.action}`
        );


        if (
            action.action === "final" &&
            !progress.wrapup &&
            isUnfinishedFinal(action, progress) &&
            progress.nudges < settings.get("MAX_EMPTY_FINAL_NUDGES")
        ) {

            progress.nudges++;

            logLine(
                scope,
                "Sub-agent finished without doing anything; handing the task back once."
            );

            events.emit("run:nudge", {
                agent: agentName,
                scope,
                iteration,
                attempt: progress.nudges
            });

            messages.push({
                role: "assistant",

                content:
                    message.content ??
                    JSON.stringify(action)
            });

            messages.push(
                nudgeMessage({
                    iteration,
                    maxIterations: settings.get("MAX_ITERATIONS"),
                    remainingMs: runRemainingMs()
                })
            );

            continue;
        }


        if (
            action.action ===
            "final"
        ) {

            logObject(
                scope,
                "Final response",
                action.response
            );

            events.emit("agent:end", {
                agent: agentName,
                scope,
                depth,
                hook: context?.hook || null,
                success: true,
                response: action.response
            });

            return {
                agent:
                    agentName,

                success:
                    true,

                response:
                    action.response,

                data:
                    action.data ?? null,

                error:
                    action.error ?? null,

                performed: {
                    tools: progress.tools,
                    delegations: progress.delegations
                },

                projectId:
                    effectiveProjectId(currentRun().project),

                findings:
                    findingsFromReport({
                        response: action.response,
                        data: action.data
                    })
            };
        }


        if (
            action.action ===
            "tool_call"
        ) {

            const toolCalls =
                normalizeToolCalls(
                    action.tool_calls
                );

            const results =
                await executeToolGraph(
                    toolCalls,
                    allowedTools,
                    scope,
                    { iteration }
                );

            progress.tools += results.length;

            appendToolConversation(
                messages,
                message,
                toolCalls,
                results,
                scope
            );

            const repeats =
                trackRepeatedFailure(progress, results);

            if (repeats >= settings.get("MAX_REPEATED_FAILURES")) {

                logLine(
                    scope,
                    `The same failure repeated ${repeats} times.`
                );

                /*
                | A loop is the failure mode a console most needs to see,
                | so it is an event rather than only a log line.
                */

                events.emit("run:loop", {
                    agent: agentName,
                    scope,
                    depth,
                    iteration,
                    repeats,
                    limit:
                        settings.get("MAX_REPEATED_FAILURES"),
                    signature:
                        progress.lastFailure,
                    outcome:
                        repeats > settings.get("MAX_REPEATED_FAILURES")
                            ? "stopped"
                            : "notice"
                });

                if (repeats > settings.get("MAX_REPEATED_FAILURES")) {

                    throw new Error(
                        `Sub-agent "${agentName}" repeated the same failing call ${repeats} times: ${progress.lastFailure}`
                    );
                }

                messages.push(
                    loopNoticeMessage(
                        progress.lastFailure,
                        repeats
                    )
                );
            }

            continue;
        }


        if (
            action.action ===
            "delegate"
        ) {

            try {

                validateDelegationPolicy(
                    agentDefinition,
                    ownDepthBudget,
                    action.delegations
                );

            } catch (error) {

                if (!isModelResponseError(error)) {
                    throw error;
                }

                if (progress.malformedCode !== error.code) {
                    progress.malformed = 0;
                    progress.malformedCode = error.code;
                }

                progress.malformed = (progress.malformed || 0) + 1;

                const limit =
                    settings.get("MAX_MALFORMED_RESPONSES");

                const maximumAttempts =
                    limit + 1;

                logLine(
                    scope,
                    `Invalid delegation (${error.message}) [${
                        progress.malformed
                    }/${maximumAttempts}]`
                );

                events.emit("run:malformed", {
                    agent: agentName,
                    scope,
                    depth,
                    iteration,
                    code: error.code,
                    reason: error.message,
                    attempt: progress.malformed,
                    limit,
                    max_attempts: maximumAttempts,
                    retries_left:
                        Math.max(0, maximumAttempts - progress.malformed),
                    outcome:
                        progress.malformed > limit
                            ? "stopped"
                            : "retry"
                });

                if (progress.malformed > limit) {
                    throw error;
                }

                messages.push(
                    malformedNoticeMessage(
                        error,
                        progress.malformed,
                        limit
                    )
                );

                continue;
            }

            events.emit("delegation:start", {
                parent: agentName,
                parent_scope: scope,
                depth,
                delegations:
                    action.delegations.map(item => ({
                        id: item.id,
                        agent: item.agent || `adhoc:${item.persona}`,
                        task: item.task,
                        depends_on: item.depends_on,
                        projectId:
                            requestedDelegationProjectId(item).value
                    }))
            });

            logLine(
                scope,
                `Delegating to ${
                    action.delegations
                        .map(item => item.agent)
                        .join(", ")
                }`
            );

            const results =
                await executeDelegations(
                    action.delegations,
                    depth + 1,
                    agentDefinition,
                    ownDepthBudget - 1,
                    scope
                );

            progress.delegations += action.delegations.length;

            messages.push({

                role: "assistant",

                content:
                    message.content ??
                    JSON.stringify(
                        action
                    )
            });

            messages.push({

                role: "user",

                content:
                    JSON.stringify({
                        type:
                            "sub_agent_results",

                        results
                    })
            });
        }
    }

    throw new Error(
        `Sub-agent exceeded maximum iterations: ${agentName}`
    );
}


/*
|--------------------------------------------------------------------------
| Delegation Graph
|--------------------------------------------------------------------------
*/

async function executeDelegations(
    delegations,
    depth,
    parentAgent,
    depthBudget,
    parentScope
) {

    const policy =
        parentAgent?.delegation || {
            max_children:
                settings.get("MAX_PARALLEL_AGENTS")
        };

    if (
        delegations.length >
        policy.max_children
    ) {

        /* A policy violation here is a model decision, so it is a
           model-response error like validateDelegationPolicy, never a run
           killer. */
        throw modelResponseError(
            "Delegation count exceeds parent agent policy.",
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "max_children",
                max_children: policy.max_children,
                delegations: delegations.length
            }
        );
    }

    /*
    | An ad-hoc child may only be granted tools the parent already has.
    */

    const parentAllowedTools =
        new Set(
            resolveTools(
                parentAgent?.tools
            ).map(
                tool =>
                    tool.function.name
            )
        );

    const tasks =
        delegations.map(
            (item, index) => ({
                id:
                    item.id ||
                    `delegation_${index + 1}`,

                agent:
                    item.agent ||
                    (
                        item.persona
                            ? `adhoc:${item.persona}`
                            : "unresolved_agent"
                    ),

                delegation:
                    item,

                task:
                    item.task,

                depends_on:
                    Array.isArray(
                        item.depends_on
                    )
                        ? item.depends_on
                        : []
            })
        );

    const maxParallel =
        settings.get("MAX_PARALLEL_AGENTS");

    /*
    | Delegation runs on the same scheduler as tools, so it has the same
    | shape, and the console is told about it the same way.
    */

    const graph =
        describeGraph(tasks, maxParallel);

    events.emit("delegation:graph", {
        parent:
            parentAgent?.name || "main_agent",

        parent_scope:
            parentScope || parentAgent?.name || "main_agent",

        depth,

        shape:
            graph.shape,

        waves:
            graph.waves,

        max_parallel:
            maxParallel,

        delegations:
            tasks.map(task => ({
                id: task.id,
                agent: task.agent,
                depends_on: task.depends_on,
                projectId:
                    requestedDelegationProjectId(task.delegation).value
            }))
    });

    return executeDependencyGraph({

        items:
            tasks,

        maxParallel,

        executor:
            async (
                task,
                results
            ) => {

                const startedAt = Date.now();

                /*
                | A delegation that fails before its agent starts used to
                | leave no trace at all: no agent:start, no agent:end,
                | nothing but a gap in the log. Every delegation now
                | reports how it ended, whoever failed it.
                */

                const switchEnabled =
                    delegationProjectSwitchEnabled();

                const requested =
                    requestedDelegationProjectId(task.delegation).value;

                const inherited =
                    effectiveProject(currentRun().project);

                const inheritedId =
                    projectIdOf(inherited) ||
                    currentRun().projectId ||
                    null;

                let scopedProject = inherited;

                if (switchEnabled && requested) {

                    try {

                        scopedProject =
                            projects.createProjectContext(
                                projects.registry().get(requested)
                            );

                    } catch {

                        const unknown =
                            new Error(`Unknown project: ${requested}`);

                        unknown.name = "UNKNOWN_PROJECT";

                        throw unknown;

                    }

                }

                /* In legacy the requested id is accepted but ignored,
                   so it must not become the child's label, the ALS
                   frame, or a multi-project mark. */
                const scopedProjectId =
                    projectIdOf(scopedProject) ||
                    (switchEnabled ? requested : null) ||
                    inheritedId;

                if (switchEnabled) {
                    noteDelegationProject(currentRun(), scopedProjectId);
                }

                try {

                    const agentProfile =
                        resolveDelegationProfile(
                            task.delegation,
                            parentAllowedTools
                        );

                    const dependencyContext =
                        task.depends_on.map(
                            id => ({
                                id,

                                result:
                                    results.get(
                                        id
                                    )
                            })
                        );

                    const runChild = () =>
                        runSubAgent({
                            agentProfile,

                            task:
                                task.task,

                            depth,

                            depthBudget,

                            context: {
                                parent:
                                    parentAgent?.name || null,

                                parent_scope:
                                    parentScope || null,

                                delegation_id:
                                    task.id,

                                hook:
                                    task.delegation.hook || null,

                                dependencies:
                                    dependencyContext
                            }
                        });

                    /* Each Sub-Agent gets its own project ALS frame so
                       two concurrent children cannot mix tools or
                       event project_id. Nested delegations may start a
                       new frame; this one is fixed for the child.
                       Legacy never enters the frame, so envelopes
                       stay historically shaped. */
                    const report =
                        switchEnabled
                            ? await runWithProject(
                                scopedProject,
                                () =>
                                    events.withProjectId(
                                        scopedProjectId,
                                        runChild
                                    )
                            )
                            : await runChild();

                    const labeled = {
                        ...report,
                        projectId:
                            report.projectId ?? scopedProjectId,
                        findings:
                            Array.isArray(report.findings)
                                ? report.findings
                                : findingsFromReport(report)
                    };

                    events.emit("delegation:end", {
                        parent:
                            parentAgent?.name || "main_agent",

                        parent_scope:
                            parentScope || parentAgent?.name || "main_agent",

                        id: task.id,

                        agent: task.agent,

                        depth,

                        success: true,

                        projectId: labeled.projectId,

                        duration_ms:
                            Date.now() - startedAt
                    });

                    return labeled;

                } catch (error) {

                    events.emit("delegation:end", {
                        parent:
                            parentAgent?.name || "main_agent",

                        parent_scope:
                            parentScope || parentAgent?.name || "main_agent",

                        id: task.id,

                        agent: task.agent,

                        depth,

                        success: false,

                        projectId: scopedProjectId,

                        error: error.message,

                        duration_ms:
                            Date.now() - startedAt
                    });

                    logLine(
                        parentScope || "main_agent",
                        `Delegation "${task.id}" to ${
                            task.agent
                        } failed: ${error.message}`
                    );

                    error.projectId = scopedProjectId;

                    throw error;
                }
            }
    })
        .then(
            results =>

                /*
                | Each result carries the agent name so a failed
                | delegation is attributable without id correlation.
                | Phase 12 adds projectId + findings so synthesis can
                | only cite labeled, per-project reports.
                */

                results.map(
                    (result, index) => {

                        const requested =
                            requestedDelegationProjectId(
                                tasks[index].delegation
                            ).value;

                        const projectId =
                            result.projectId ||
                            (result.result && result.result.projectId) ||
                            result.error?.projectId ||
                            (delegationProjectSwitchEnabled()
                                ? requested
                                : null) ||
                            projectIdOf(effectiveProject(currentRun().project)) ||
                            currentRun().projectId ||
                            null;

                        const findings =
                            result.success
                                ? (
                                    result.findings ||
                                    findingsFromReport(result.result)
                                )
                                : [];

                        return {
                            ...result,

                            agent:
                                tasks[index].agent,

                            projectId,

                            findings
                        };

                    }
                )
        );
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


async function runAgentCore(options = {}) {

    const projectContext =
        resolveRunProjectContext(options);

    /*
    | Pick up any edit made to a registry or the policy since the last
    | run, then validate what was actually loaded.
    */

    loadRegistries(false);

    validateRegistries();

    const carried =
        currentRun().carried || { background_processes: [] };

    if (carried.background_processes.length > 0) {

        logLine(
            "main_agent",
            `${carried.background_processes.length} background process(es) from an earlier run are still alive: ${
                carried.background_processes
                    .map(item => item.process_id)
                    .join(", ")
            }`
        );
    }

    startRun();

    /*
    | Context resolved before startRun so a bad project reference fails
    | fast, assigned after it so the clean-slate reset cannot drop it.
    | Still inert in legacy mode (null).
    */
    currentRun().project = projectContext;

    resetAgentBudget();

    /*
    | The tools an MCP server offers have to be known before the first
    | request is built, or the model is told about a capability one
    | iteration after it needed it. Discovery is bounded, and a server
    | that does not answer is left out rather than allowed to hold up
    | the run.
    */

    await discoverMcpTools();

    currentRun().task =
        options.task ||
        readTask();

    /* Every user task in this run starts a new turn; all events and
       conversation steps it produces share the same turn_id, so the UI can
       render the execution for a user message as one stage-by-stage block.
       A caller (such as the web server) may pass its own turn_id so the
       conversation message and the runtime events line up. */
    const turn_id =
        options.turn_id ||
        `${currentRun().id}_t${(currentRun().turnCounter = (currentRun().turnCounter || 0) + 1)}`;

    if (currentRun() instanceof AgentRunContext) {
        currentRun().turnId = turn_id;
    }

    events.setContext({ turn_id });

    /*
    | A caller that keeps a history array across calls gets a
    | multi-turn session: the array is filled on the first run and
    | extended with the new task on every following run.
    */

    events.emit("run:start", {
        run_id:
            currentRun().id,

        turn_id,

        task:
            currentRun().task,

        continued:
            Array.isArray(options.history) &&
            options.history.length > 0
    });

    const messages =
        Array.isArray(options.history)
            ? options.history
            : [];

    /* The run context aliases the very array the loop mutates, so a
       run handle always sees its own conversation as it grows. */
    if (currentRun() instanceof AgentRunContext) {
        currentRun().messages = messages;
    }

    if (messages.length === 0) {

        messages.push(
            ...createMainAgentMessages(options.task)
        );

    } else {

        messages.push({
            role: "user",

            turn_id,

            content:
                options.task && options.task.trim() !== ""
                    ? options.task
                    : readTask()
        });
    }

    const mainAgentDefinition =
        (() => {

            const configured =
                AGENT_REGISTRY_OF().get(
                    "main_agent"
                );

            /*
            | Delegation is a capability declared by the profile,
            | not an intrinsic property of being the root agent.
            */

            const base =
                configured || {
                    name: "main_agent",
                    tools: "*",
                    delegation: {
                        enabled: true,
                        max_depth:
                            settings.get("MAX_AGENT_DEPTH"),
                        max_children:
                            settings.get("MAX_PARALLEL_AGENTS")
                    }
                };

            return {
                ...base,

                model:
                    base.model || settings.get("AGENT_MODEL"),

                temperature:
                    base.temperature ??
                    settings.get("AGENT_TEMPERATURE")
            };
        })();

    currentRun().main_agent_definition =
        mainAgentDefinition;

    const mainDepthBudget =
        resolveDepthBudget(
            mainAgentDefinition,
            settings.get("MAX_AGENT_DEPTH")
        );

    const mainAgentTools =
        resolveTools(
            mainAgentDefinition.tools
        );

    const allowedTools =
        new Set(
            mainAgentTools.map(
                tool =>
                    tool.function.name
            )
        );

    const progress = {
        tools: 0,
        delegations: 0,
        nudges: 0,
        continuations: 0
    };

    const beforeHooks =
        await runHooks(
            "before_task",
            hookExecutionContext(),
            mainAgentDefinition
        );

    if (beforeHooks.stopped) {

        const failed =
            beforeHooks.results.find(
                item => item.status === "failed" && item.on_failure === "stop"
            );

        throw new Error(
            `Required before_task hook "${failed.id}" failed: ${failed.summary}`
        );
    }

    if (beforeHooks.results.length > 0) {

        messages.push({
            role: "user",
            content:
                JSON.stringify({
                    type: "runtime_notice",
                    notice: "before_task_hooks_complete",
                    results:
                        beforeHooks.results.map(item => ({
                            id: item.id,
                            status: item.status,
                            ok: item.ok,
                            summary: item.summary
                        })),
                    instruction:
                        "These deterministic routine steps already ran. Use their evidence and do not repeat them in the plan or with tools."
                })
        });
    }

    const routed =
        await autoroutePlanStep(mainAgentDefinition);

    if (routed) {

        progress.delegations++;

        messages.push({
            role: "user",
            content:
                JSON.stringify({
                    type: "runtime_notice",
                    notice: "plan_step_autorouted",
                    result: routed,
                    instruction:
                        "The runtime already delegated this assigned plan step and recorded its evidence. Do not repeat it. Continue from the updated plan and report the verified result."
                })
        });
    }

    for (
        let iteration = 1;
        iteration <= settings.get("MAX_ITERATIONS");
        iteration++
    ) {

        assertRunActive("main agent");

        await maintainContext(messages, "main_agent");

        refreshRuntimeContext(messages);

        events.setContext({ scope: "main_agent", iteration });

        events.emit("agent:iteration", {
            agent: "main_agent",
            scope: "main_agent",
            depth: 0,
            iteration
        });

        /*
        | The reserved slice is capped by a share of the budget, so a
        | two minute run is not told to wrap up on its first iteration
        | just because the default slice is a minute.
        */

        /*
        | The reminder fires at the top of an iteration, before the
        | request is built, so the notice travels with it.
        */

        if (
            shouldHintDelegation(
                progress,
                currentPlanSummary(),
                mainAgentDefinition
            )
        ) {

            progress.delegationHints =
                (progress.delegationHints || 0) + 1;

            const planSummary = currentPlanSummary();

            logLine(
                "main_agent",
                `Working alone for ${
                    progress.tools
                } calls with ${
                    remainingAgentBudget()
                } agents unused and ${
                    planSummary.pending + planSummary.in_progress
                } open steps; suggesting delegation.`
            );

            events.emit("run:delegation_hint", {
                agent: "main_agent",
                iteration,
                attempt: progress.delegationHints,
                agents_remaining: remainingAgentBudget(),
                open_steps:
                    planSummary.pending + planSummary.in_progress
            });

            messages.push(
                delegationHintMessage(
                    planSummary,
                    remainingAgentBudget()
                )
            );
        }

        const wrapUpAt =
            Math.min(
                settings.get("RUN_WRAPUP_MS"),
                settings.get("MAX_RUN_MS") *
                settings.get("RUN_WRAPUP_FRACTION")
            );

        if (
            wrapUpAt > 0 &&
            !progress.wrapup &&
            runRemainingMs() <= wrapUpAt
        ) {

            progress.wrapup = true;

            const planSummary =
                currentPlanSummary();

            logLine(
                "main_agent",
                `Run budget nearly spent (${
                    Math.max(0, runRemainingMs())
                } ms left); asking for a final answer.`
            );

            events.emit("run:wrapup", {
                agent: "main_agent",
                iteration,
                remaining_ms: runRemainingMs(),
                max_run_ms: settings.get("MAX_RUN_MS")
            });

            messages.push(
                wrapUpMessage(
                    runRemainingMs(),
                    planSummary
                )
            );
        }

        if (settings.get("AGENT_VERBOSE")) {

            LOG_STREAM(
                `\n=== Agent Iteration ${iteration} ===`
            );
        }

        const data =
            await callAI({
                messages,

                agentDefinition:
                    mainAgentDefinition,

                tools:
                    mainAgentTools,

                role: "MAIN",

                scope:
                    "main_agent"
            });

        /* Keep the provider response visible even when the structured action
           below turns out to be malformed. */
        reportModelResponse(data, "main_agent", "main_agent", 0, iteration);

        let parsed;

        try {

            parsed = readModelAction(data);

        } catch (error) {

            if (!isModelResponseError(error)) {
                throw error;
            }

            if (progress.malformedCode !== error.code) {
                progress.malformed = 0;
                progress.malformedCode = error.code;
            }

            progress.malformed = (progress.malformed || 0) + 1;

            const limit =
                settings.get("MAX_MALFORMED_RESPONSES");

            const maximumAttempts =
                limit + 1;

            logLine(
                "main_agent",
                `Unreadable answer (${error.message}) [${
                    progress.malformed
                }/${maximumAttempts}]`
            );

            events.emit("run:malformed", {
                agent: "main_agent",
                scope: "main_agent",
                depth: 0,
                iteration,
                code: error.code,
                reason: error.message,
                finish_reason:
                    error.details?.finish_reason || null,
                completion_tokens:
                    error.details?.completion_tokens ?? null,
                output_chars:
                    error.details?.output_chars ?? null,
                attempt: progress.malformed,
                limit,
                max_attempts: maximumAttempts,
                retries_left:
                    Math.max(0, maximumAttempts - progress.malformed),
                outcome:
                    progress.malformed > limit
                        ? "stopped"
                        : "retry"
            });

            if (progress.malformed > limit) {
                throw error;
            }

            messages.push(
                malformedNoticeMessage(
                    error,
                    progress.malformed,
                    limit
                )
            );

            continue;
        }

        /* A valid replacement closes this malformed-answer streak. Later
           independent mistakes get their own corrective retry allowance. */
        progress.malformed = 0;
        progress.malformedCode = null;

        const message =
            parsed.message;

        const action =
            parsed.structured;

        events.emit("agent:action", {
            agent: "main_agent",
            scope: "main_agent",
            depth: 0,
            iteration,
            action: action.action
        });

        logLine(
            "main_agent",
            `Action: ${action.action}`
        );


        /*
        |--------------------------------------------------------------------------
        | FINAL
        |--------------------------------------------------------------------------
        */

        if (
            action.action === "final" &&
            !action.error
        ) {

            const planSummary =
                currentPlanSummary();

            const openSteps =
                planSummary.exists
                    ? planSummary.pending + planSummary.in_progress
                    : 0;

            /*
            | Continue only while there is enough time for another
            | step, without demanding a whole request budget.
            */

            const continuationFloor =
                Math.min(
                    settings.get("MAX_REQUEST_MS"),
                    Math.max(5000, settings.get("MAX_RUN_MS") * 0.1)
                );

            if (
                openSteps > 0 &&
                !progress.wrapup &&
                progress.continuations < settings.get("MAX_PLAN_CONTINUATIONS") &&
                runRemainingMs() > continuationFloor
            ) {

                progress.continuations++;

                logLine(
                    "main_agent",
                    `Plan still has ${openSteps} open step(s); continuing with "${
                        planSummary.next_step
                            ? planSummary.next_step.title
                            : "the next step"
                    }".`
                );

                events.emit("run:continue", {
                    agent: "main_agent",
                    open_steps: openSteps,
                    next_step: planSummary.next_step,
                    attempt: progress.continuations
                });

                messages.push({
                    role: "assistant",

                    content:
                        message.content ??
                        JSON.stringify(action)
                });

                messages.push(
                    planContinuationMessage(
                        planSummary,
                        runRemainingMs()
                    )
                );

                continue;
            }
        }


        if (
            action.action === "final" &&
            isUnfinishedFinal(action, progress) &&
            progress.nudges < settings.get("MAX_EMPTY_FINAL_NUDGES")
        ) {

            progress.nudges++;

            logLine(
                "main_agent",
                "Final answer arrived with no work performed; handing the objective back once."
            );

            events.emit("run:nudge", {
                agent: "main_agent",
                iteration,
                attempt: progress.nudges
            });

            messages.push({
                role: "assistant",

                content:
                    message.content ??
                    JSON.stringify(action)
            });

            messages.push(
                nudgeMessage({
                    iteration,
                    maxIterations: settings.get("MAX_ITERATIONS"),
                    remainingMs: runRemainingMs()
                })
            );

            continue;
        }


        if (
            action.action ===
            "final"
        ) {

            /*
            | The answer is kept in the transcript so a following task
            | in the same session can refer back to it.
            */

            messages.push({
                role: "assistant",

                content:
                    message.content ??
                    JSON.stringify(action)
            });

            const finalized =
                await applyAfterTaskHooks(action, null);

            const finalAction =
                finalized.action;

            /* The session history must carry the hook evidence and any
               HOOK_FAILED status, not the pre-hook draft from the model. */
            messages[messages.length - 1].content =
                JSON.stringify(finalAction);

            /*
            | Before the answer leaves, what it claims is compared with
            | what the runtime executed, including deterministic hooks.
            */

            const mismatch =
                checkPerformedClaim(finalAction, progress, "main_agent");

            events.emit("run:end", {
                action: finalAction,

                hooks:
                    finalized.report || undefined,

                claim_mismatch:
                    mismatch || undefined,

                ok:
                    !finalAction.error
            });

            if (PRINT_FINAL) {

                LOG_STREAM(
                    "\n=== FINAL RESPONSE ===\n"
                );

                LOG_STREAM(
                    JSON.stringify(
                        finalAction,
                        null,
                        2
                    )
                );
            }

            return finalAction;
        }


        /*
        |--------------------------------------------------------------------------
        | TOOL CALL
        |--------------------------------------------------------------------------
        */

        if (
            action.action ===
            "tool_call"
        ) {

            const toolCalls =
                normalizeToolCalls(
                    action.tool_calls
                );

            const results =
                await executeToolGraph(
                    toolCalls,
                    allowedTools,
                    "main_agent",
                    { iteration }
                );

            progress.tools += results.length;

            appendToolConversation(
                messages,
                message,
                toolCalls,
                results,
                "main_agent"
            );

            const repeats =
                trackRepeatedFailure(progress, results);

            if (repeats >= settings.get("MAX_REPEATED_FAILURES")) {

                logLine(
                    "main_agent",
                    `The same failure repeated ${repeats} times.`
                );

                events.emit("run:loop", {
                    agent: "main_agent",
                    scope: "main_agent",
                    depth: 0,
                    iteration,
                    repeats,
                    limit:
                        settings.get("MAX_REPEATED_FAILURES"),
                    signature:
                        progress.lastFailure,
                    outcome:
                        repeats > settings.get("MAX_REPEATED_FAILURES")
                            ? "stopped"
                            : "notice"
                });

                if (repeats > settings.get("MAX_REPEATED_FAILURES")) {

                    throw new Error(
                        `The agent repeated the same failing call ${repeats} times: ${progress.lastFailure}`
                    );
                }

                messages.push(
                    loopNoticeMessage(
                        progress.lastFailure,
                        repeats
                    )
                );
            }

            continue;
        }


        /*
        |--------------------------------------------------------------------------
        | DELEGATE
        |--------------------------------------------------------------------------
        */

        if (
            action.action ===
            "delegate"
        ) {

            try {

                validateDelegationPolicy(
                    mainAgentDefinition,
                    mainDepthBudget,
                    action.delegations
                );

            } catch (error) {

                if (!isModelResponseError(error)) {
                    throw error;
                }

                if (progress.malformedCode !== error.code) {
                    progress.malformed = 0;
                    progress.malformedCode = error.code;
                }

                progress.malformed = (progress.malformed || 0) + 1;

                const limit =
                    settings.get("MAX_MALFORMED_RESPONSES");

                const maximumAttempts =
                    limit + 1;

                logLine(
                    "main_agent",
                    `Invalid delegation (${error.message}) [${
                        progress.malformed
                    }/${maximumAttempts}]`
                );

                events.emit("run:malformed", {
                    agent: "main_agent",
                    scope: "main_agent",
                    depth: 0,
                    iteration,
                    code: error.code,
                    reason: error.message,
                    attempt: progress.malformed,
                    limit,
                    max_attempts: maximumAttempts,
                    retries_left:
                        Math.max(0, maximumAttempts - progress.malformed),
                    outcome:
                        progress.malformed > limit
                            ? "stopped"
                            : "retry"
                });

                if (progress.malformed > limit) {
                    throw error;
                }

                messages.push(
                    malformedNoticeMessage(
                        error,
                        progress.malformed,
                        limit
                    )
                );

                continue;
            }

            events.emit("delegation:start", {
                parent: "main_agent",
                parent_scope: "main_agent",
                depth: 0,
                delegations:
                    action.delegations.map(item => ({
                        id: item.id,
                        agent: item.agent || `adhoc:${item.persona}`,
                        task: item.task,
                        depends_on: item.depends_on,
                        projectId:
                            requestedDelegationProjectId(item).value
                    }))
            });

            logLine(
                "main_agent",
                `Delegating to ${
                    action.delegations
                        .map(item => item.agent)
                        .join(", ")
                }`
            );

            const results =
                await executeDelegations(
                    action.delegations,
                    1,
                    mainAgentDefinition,
                    mainDepthBudget - 1,
                    "main_agent"
                );

            progress.delegations += action.delegations.length;

            messages.push({

                role: "assistant",

                content:
                    message.content ??
                    JSON.stringify(
                        action
                    )
            });

            messages.push({

                role: "user",

                content:
                    JSON.stringify({
                        type:
                            "sub_agent_results",

                        results
                    })
            });
        }
    }

    throw new Error(
        `Agent exceeded maximum iterations: ${settings.get("MAX_ITERATIONS")}`
    );
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


/*
|--------------------------------------------------------------------------
| Entry Point
|--------------------------------------------------------------------------
|
| The runtime only starts when executed directly, so the internals can
| be imported and tested.
|--------------------------------------------------------------------------
*/

if (require.main === module) {
    main();
}


module.exports = {
    runAgent,
    main,

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
    | Read through the store so a caller never caches a stale limit.
    */

    get limits() {

        return settings.snapshot();
    }
};
