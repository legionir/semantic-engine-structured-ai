/*
|--------------------------------------------------------------------------
| Project Context Builder
|--------------------------------------------------------------------------
|
| The additive project_context system message (EXECUTION_PLAN Phase 5,
| گام ۳). It tells the model which project the run is scoped to, which
| other projects exist (names and ids only — never guessed paths), and
| the three operating rules the multi-project documents mandate:
|
|   1. work only on the active project
|   2. never guess another project's paths
|   3. attribute work to the project it belongs to
|
| The message exists only when a project is actually scoped (modular
| modes); a null build leaves the prompt byte-identical to the legacy
| one.
|--------------------------------------------------------------------------
*/

const { jsonSystem } = require("./PromptMessages");


class ProjectContextBuilder {

    constructor({ listProjects }) {

        /* () => registered project records; names and ids only reach
           the message, roots never do. */
        this.listProjects = listProjects;

    }


    build(project) {

        if (!project) {
            return null;
        }

        const projectId =
            project.projectId ??
            project.id ??
            null;

        const available =

            (this.listProjects() || [])
                .filter(record => record && record.id !== projectId)
                .map(record => ({
                    id: record.id,
                    name: record.name
                }));

        const payload = {
            type:
                "project_context",

            project: {
                id:
                    projectId,

                name:
                    project.projectName ??
                    project.name ??
                    null,

                workspace_root:
                    project.workspaceRoot
            },

            ...(available.length > 0
                ? { available_projects: available }
                : {}),

            rules: [
                "Work only within the active project: every tool is scoped to the project this run belongs to.",
                "Never guess, construct, or request paths of another project; projects other than the active one are not reachable by tools.",
                "Attribute every artifact, result, and claim to the project it belongs to."
            ]
        };

        return jsonSystem(payload);

    }

}


module.exports = ProjectContextBuilder;
