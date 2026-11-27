/* Live prompt text and capability-aware execution-rule filtering. */

const RULE_MARKER = /^([A-Z][A-Z ]*?)\s*\[needs:\s*([^\]]+)\]\s*$/;


function ruleSectionApplies(condition, toolNames, hasGatedTool) {
    const wanted = condition.split(",").map(item => item.trim()).filter(Boolean);
    return wanted.some(need => need === "approval"
        ? hasGatedTool
        : toolNames.includes(need));
}


function filterExecutionRules(text, toolNames, hasGatedTool) {
    const lines = text.split("\n");
    const output = [];
    let skipping = false;

    for (const line of lines) {
        const match = RULE_MARKER.exec(line);
        if (match) {
            skipping = !ruleSectionApplies(match[2], toolNames, hasGatedTool);
            if (!skipping) {
                output.push(match[1]);
            }
            continue;
        }

        if (skipping && /^[A-Z][A-Z ]+$/.test(line) && line.trim() !== "") {
            skipping = false;
        }
        if (!skipping) {
            output.push(line);
        }
    }

    return output.join("\n").replace(/\n{4,}/g, "\n\n\n");
}


function createExecutionRules({
    fs,
    path,
    configDir,
    readText,
    allTools,
    resolveTools,
    getPolicyEngine
}) {
    const cache = new Map();

    function readTextLive(filePath) {
        let stamp = "missing";
        try {
            const stats = fs.statSync(filePath);
            stamp = `${stats.mtimeMs}:${stats.size}`;
        } catch {
            /* Let readText report missing/unreadable prompt files. */
        }

        const cached = cache.get(filePath);
        if (cached && cached.stamp === stamp) {
            return cached.text;
        }

        const text = readText(filePath).replace(/\r\n/g, "\n");
        cache.set(filePath, { stamp, text });
        return text;
    }

    function executionRules(agentDefinition) {
        const text = readTextLive(path.join(configDir, "execution_rules.txt"));
        if (!agentDefinition) {
            return filterExecutionRules(
                text,
                allTools().map(tool => tool.function.name),
                true
            );
        }

        const toolNames = resolveTools(agentDefinition.tools, agentDefinition.name)
            .map(tool => tool.function.name);
        const policy = getPolicyEngine();
        const hasGatedTool = toolNames.some(name =>
            policy.evaluate(name, {}, agentDefinition.name).decision !== "allow"
        );
        return filterExecutionRules(text, toolNames, hasGatedTool);
    }

    function systemPrompt() {
        return readTextLive(path.join(configDir, "system_prompt.txt"));
    }

    return { executionRules, systemPrompt, filterExecutionRules };
}


module.exports = { createExecutionRules, filterExecutionRules };
