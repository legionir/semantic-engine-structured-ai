"use strict";

/*
|--------------------------------------------------------------------------
| Skill catalogue
|--------------------------------------------------------------------------
|
| Every skill the runtime can load, for the console's skill manager
| (web/server/routes/skills.js) and for `/skill` (SkillCommand.js), and
| the operator's choice of which ones the prompt's skill index lists
| (SkillSelection.js). Kept apart from SkillTools.js, whose exports are
| the model-facing tools that tools.json declares.
*/

const { defaultEnabled, isPromptEnabled, setPromptEnabled, resetPromptSelection } = require("./SkillSelection");


function skillTools() {

    return require("./SkillTools");
}


function listAllSkills() {

    return skillTools()._activeSkills().map(skill => ({
        name: skill.name,
        description: skill.description,
        origin: skill.origin || "registry",
        format: skill.format || "registry",
        ...(skill.library ? { library: skill.library } : {}),
        ...(skill.kind ? { kind: skill.kind } : {}),
        recommended: skill.recommended === true,
        default_enabled: defaultEnabled({ origin: skill.origin || "registry", ...skill }),
        prompt_enabled: isPromptEnabled(skill)
    }));
}


function findSkill(name) {

    return skillTools()._activeSkills().find(skill => skill.name === name) || null;
}


function setSkillPromptEnabled(name, enabled) {

    const skill = findSkill(name);

    if (!skill) {
        const error = new Error(`Unknown skill: ${name}`);
        error.status = 404;
        throw error;
    }

    return setPromptEnabled(skill, enabled);
}


/* the index the prompt carries, as SkillTools builds it */
function promptIndex() {

    return skillTools()._skillIndex();
}


module.exports = {
    listAllSkills,
    findSkill,
    setSkillPromptEnabled,
    resetPromptSelection,
    promptIndex
};
