/*
|--------------------------------------------------------------------------
| Skill Resolver
|--------------------------------------------------------------------------
|
| Which registry skills a profile may use, moved out of agent.js
| (EXECUTION_PLAN Phase 5). Skills that require a configured MCP server are
| filtered by the injected isActiveSkill capability check.
|
| The body is the historical resolveSkills() verbatim.
|--------------------------------------------------------------------------
*/

function createSkillResolver({
    SKILL_REGISTRY_OF,
    isActiveSkill
}) {

    function resolve(skillNames) {

        if (!Array.isArray(skillNames)) {
            return [];
        }

        return skillNames
            .map(
                name =>
                    SKILL_REGISTRY_OF().get(name)
            )
            .filter(
                skill =>
                    skill && isActiveSkill(skill)
            );
    }


    return {
        resolve
    };

}


module.exports = {
    createSkillResolver
};
