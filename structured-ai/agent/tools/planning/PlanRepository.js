"use strict";

const fs = require("fs");
const path = require("path");

const dataRoot = require("../../persistence/DataRoot");
const AtomicFile = require("../../persistence/AtomicFile");

const { toWorkspaceRelative } = require("../../context/WorkspaceBoundary");

const PlanModel = require("./PlanModel");


/*
| Phase 8: the plan file lives under the active project's data root
| (central for registered projects, the historical .agent directory in
| every other mode), so constants become functions of the resolution
| root. The explicit parameter carries a ToolContext or an absolute
| root from out-of-run callers; without one the in-scope run's project
| wins, then the legacy path — the گام ۱ resolution order.
*/
function planDirectory(root) {

    return dataRoot.resolveRoot(root);
}


function planPath(root) {

    return path.join(planDirectory(root), "plan.json");
}


function loadPlan(root) {

    const file = planPath(root);

    if (!fs.existsSync(file)) {
        return PlanModel.emptyPlan();
    }

    try {

        const parsed =
            JSON.parse(
                fs.readFileSync(file, "utf8")
            );

        return {
            ...PlanModel.emptyPlan(),
            ...parsed,

            phases:
                Array.isArray(parsed.phases)
                    ? parsed.phases.map(
                        (phase, phaseIndex) => ({
                            ...phase,
                            steps:
                                (Array.isArray(phase.steps) ? phase.steps : [])
                                    .map(
                                        (step, stepIndex) =>
                                            PlanModel.normaliseStep(
                                                step,
                                                stepIndex,
                                                phase.id || `phase_${phaseIndex + 1}`
                                            )
                                    )
                        })
                    )
                    : []
        };

    } catch (error) {

        throw new Error(
            `The plan file is not valid JSON: ${
                toWorkspaceRelative(file)
            } (${error.message})`
        );
    }
}


function savePlan(plan, root) {

    fs.mkdirSync(planDirectory(root), { recursive: true });

    plan.updated_at =
        new Date().toISOString();

    AtomicFile.writeFile(
        planPath(root),
        `${JSON.stringify(plan, null, 2)}\n`,
        "utf8"
    );

    return plan;
}


/* A path the model can read: workspace-relative when the plan lives in
   the workspace, the absolute central path when it lives in the
   project data home (toWorkspaceRelative on a far-away file would print
   a maze of ../ segments, which is worse than absolute). */
function displayPath(file) {

    const relative = toWorkspaceRelative(file);

    return relative.startsWith("..")
        ? file
        : relative;
}


module.exports = {
    planDirectory,
    planPath,
    loadPlan,
    savePlan,
    displayPath,

    _planPath: path.join(dataRoot.legacyDataRoot(), "plan.json")
};
