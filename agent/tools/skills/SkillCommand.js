"use strict";

/*
|--------------------------------------------------------------------------
| `/skill <name> [message]`
|--------------------------------------------------------------------------
|
| The user picks one skill — any skill, whether or not it is sent to the
| AI in the skill index — and its complete text travels with that one
| message. The turn carries no skill index: the user already chose, and a
| list of other skills next to a chosen one only invites second-guessing
| (MainPromptBuilder / SkillIndexMessage leave it out).
|
| Works wherever a task enters the runtime (console, project chat, queue,
| CLI), like `/init`.
|--------------------------------------------------------------------------
*/

const settings = require("../../config");
const events = require("../../events");
const { truncateText } = require("../../context/WorkspaceBoundary");
const { renderCommands } = require("./MarkdownSkills");

const COMMAND = /^\s*\/skill(?=\s|$)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i;


/* null when the task is not a /skill command */
function parseSkillCommand(task) {

    if (typeof task !== "string") return null;

    const match = COMMAND.exec(task);

    if (!match) return null;

    return {
        name: match[1] || "",
        message: (match[2] || "").trim()
    };
}


/* A registry skill is JSON: its procedure is these fields, in this order. */
function registryText(skill) {

    const sections = [
        ["Description", skill.description],
        ["When to use", skill.when_to_use],
        ["Capabilities", skill.capabilities],
        ["Instructions", skill.instructions],
        ["Constraints", skill.constraints],
        ["Tools", skill.tools]
    ];

    return sections
        .filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && value !== "")
        .map(([title, value]) => `## ${title}\n\n${Array.isArray(value) ? value.map(item => `- ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n") : typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
        .join("\n\n");
}


/*
| The user's message with the whole skill attached. Throws, before any
| model request, when the command names no skill or an unknown one.
*/
async function attachSkill(command, task, { toolContext, agent = "main_agent" } = {}) {

    const skills = require("./SkillCatalog");

    if (!command.name) {
        throw new Error("/skill needs a skill name: /skill <name> [message]. The console's Skills panel lists every skill.");
    }

    const skill = skills.findSkill(command.name);

    if (!skill) {
        throw new Error(`Unknown skill "${command.name}". The console's Skills panel (or GET /api/skills) lists every skill.`);
    }

    const body = skill.format === "SKILL.md"
        ? await renderCommands(skill, toolContext)
        : registryText(skill);

    const capped = truncateText(body, settings.get("SKILL_COMMAND_MAX_CHARS"));
    const resources = (skill.resources || []).map(resource => resource.id);

    events.emit("skill:loaded", {
        agent,
        scope: agent,
        skills: [skill.name],
        chars: capped.text.length,
        source: "command"
    });

    const request = task && task.trim() !== ""
        ? task
        : `Apply the skill "${skill.name}" below to this workspace.`;

    return [
        request,
        "",
        "---",
        `Skill "${skill.name}", attached by the user to this message. This is the complete skill; follow it for this task.` +
            (capped.truncated ? ` (cut to ${settings.get("SKILL_COMMAND_MAX_CHARS")} characters by SKILL_COMMAND_MAX_CHARS)` : "") +
            (resources.length > 0 ? `\nIts resources load with skill_read: ${resources.join(", ")}` : ""),
        "",
        `<skill name="${skill.name}">`,
        capped.text,
        "</skill>"
    ].join("\n");
}


module.exports = {
    parseSkillCommand,
    attachSkill
};
