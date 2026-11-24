/*
|--------------------------------------------------------------------------
| Skill Resolver
|--------------------------------------------------------------------------
|
| Which registry skills a profile may use, moved out of agent.js
| (EXECUTION_PLAN Phase 5). Inactive skills — e.g. the semantic_engine
| skill while the project's Semantic MCP is not ready — are filtered by
| the injected isActiveSkill, which is the same gate the runtime has
| always applied. Until Phase 6, "the project's Semantic MCP" is the
| single Semantic Engine connection the process already has.
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
