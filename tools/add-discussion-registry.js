"use strict";

/*
| One-shot generator: appends the discussion personas to the registries.
| personas.js is the source of truth for the system prompts; the JSON
| registries are what the runtime validates and shows to the model.
| Idempotent: skips names that are already present.
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "structured-ai");

const { PERSONAS, OBSERVER } = require(path.join(ROOT, "agent", "discussion", "personas.js"));

const PERSONAS_FILE = path.join(ROOT, "agent", "registry", "personas.json");
const AGENTS_FILE = path.join(ROOT, "agent", "registry", "agents.json");
const TOOLS_FILE = path.join(ROOT, "agent", "registry", "tools.json");

const personas = JSON.parse(fs.readFileSync(PERSONAS_FILE, "utf8"));
const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8"));
const tools = JSON.parse(fs.readFileSync(TOOLS_FILE, "utf8"));

const existingPersonaNames = new Set(personas.map(p => p.name));
const existingAgentNames = new Set(agents.map(a => a.name));

/* ------------------------------------------------ personas.json */

for (const p of [...PERSONAS, OBSERVER]) {
    if (existingPersonaNames.has(p.id)) {
        console.log(`skip persona ${p.id} (present)`);
        continue;
    }
    personas.push({
        name: p.id,
        description: p.description,
        system_prompt: p.system_prompt
    });
    console.log(`added persona ${p.id}`);
}

/* ------------------------------------------------ agents.json */

const AGENT_SPECS = {
    security:      { capabilities: ["security_review", "attack_surface_analysis", "secure_design"], skills: ["codebase_analysis", "search", "file_management", "web_research"] },
    backend:       { capabilities: ["api_design", "service_boundaries", "error_handling"], skills: ["codebase_analysis", "file_management", "terminal_execution", "search"] },
    database:      { capabilities: ["schema_design", "query_performance", "data_integrity"], skills: ["codebase_analysis", "search", "file_management", "terminal_execution"] },
    frontend:      { capabilities: ["component_design", "state_management", "rendering_performance"], skills: ["codebase_analysis", "file_management", "terminal_execution", "search"] },
    architect:     { capabilities: ["architecture_review", "dependency_analysis", "change_impact_analysis"], skills: ["codebase_analysis", "semantic_engine", "file_management", "search"] },
    performance:   { capabilities: ["latency_analysis", "scalability_review", "caching_strategy"], skills: ["codebase_analysis", "search", "terminal_execution"] },
    qa:            { capabilities: ["test_strategy", "edge_case_analysis", "failure_modes"], skills: ["testing_and_verification", "terminal_execution", "file_management", "search"] },
    devops:        { capabilities: ["deployment_review", "operational_risk", "rollout_strategy"], skills: ["terminal_execution", "file_management", "search"] },
    cost:          { capabilities: ["cost_estimation", "finops_review"], skills: ["web_research", "file_management"] },
    accessibility: { capabilities: ["wcag_review", "usability_analysis"], skills: ["web_research", "file_management"] },
    data:          { capabilities: ["event_tracking", "pipeline_impact", "reporting"], skills: ["codebase_analysis", "search"] },
    compliance:    { capabilities: ["data_handling_review", "retention_policy"], skills: ["web_research", "file_management"] },
    mobile:        { capabilities: ["mobile_ui_review", "offline_behavior"], skills: ["file_management", "web_research"] },
    ml:            { capabilities: ["ai_integration_review", "model_failure_handling"], skills: ["terminal_execution", "web_research", "file_management"] },
    legacy:        { capabilities: ["backward_compatibility", "migration_strategy"], skills: ["git", "file_management", "search", "codebase_analysis"] },
    observer:      { capabilities: ["discussion_management", "synthesis"], skills: [] }
};

for (const p of [...PERSONAS, OBSERVER]) {
    const agentName = `discussion_${p.id}`;
    if (existingAgentNames.has(agentName)) {
        console.log(`skip agent ${agentName} (present)`);
        continue;
    }
    const spec = AGENT_SPECS[p.id];

    agents.push({
        name: agentName,
        description:
            p.id === "observer"
                ? "Discussion observer. Reads every round, decides CONTINUE or FINISH, and is the only agent that reports back to the user."
                : `Discussion persona: ${p.name}. ${p.description}`,
        persona: p.id,
        capabilities: spec.capabilities,
        output_contract: p.id === "observer"
            ? [
                "Manage the discussion; never inject a personal technical opinion.",
                "Decide CONTINUE or FINISH and state why.",
                "The final report is the only output the user sees: summary, agreed points, unresolved disagreements with both sides, ordered next steps."
            ]
            : [
                `Evaluate the task strictly through the ${p.name.toLowerCase().replace(" agent", "")} lens stated in your persona.`,
                "State concrete risks, trade-offs and a recommended position; do not restate generic advice.",
                "When reacting to other agents, explicitly agree, disagree with reasoning, or refine."
            ],
        skills: spec.skills,
        tools: p.tools,
        model: "auto-switch",
        temperature: 0.2,
        delegation: {
            enabled: false,
            max_depth: 0,
            max_children: 0
        }
    });
    console.log(`added agent ${agentName}`);
}

/* ------------------------------------------------ tools.json */

const toolModule = require(path.join(ROOT, "agent", "tools", "discussion.js"));

if (!tools.some(t => t.function.name === "discussion_start")) {
    tools.push({
        type: "function",
        function: {
            name: "discussion_start",
            description: toolModule.tools.discussion_start.description,
            parameters: toolModule.tools.discussion_start.parameters
        }
    });
    console.log("added tool discussion_start");
} else {
    console.log("skip tool discussion_start (present)");
}

fs.writeFileSync(PERSONAS_FILE, JSON.stringify(personas, null, 2) + "\n");
fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2) + "\n");
fs.writeFileSync(TOOLS_FILE, JSON.stringify(tools, null, 2) + "\n");

console.log("\nDone.");
