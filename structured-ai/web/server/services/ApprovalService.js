"use strict";

/*
|--------------------------------------------------------------------------
| Web console approvals (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| An approval becomes a pending question the browser can answer, and
| this is the only seam where that happens.
|
| The queue is the policy engine's own store (agent/policy/ApprovalStore)
| and not a mirror of it, which is what lets the console and the engine
| see one pending list. The request carries the project it came from —
| read from the runtime, never from a tool argument — so two projects
| raising the same tool at the same moment can still be told apart.
|
| `resolveApproval` takes the request out of the store before resolving
| it: a second click on the same button therefore resolves nothing and
| the route answers 404. That is the behaviour the console depends on
| when two tabs are open, and it is recorded in the route contract.
|--------------------------------------------------------------------------
*/

function createApprovalService(ctx) {

    const { runtime, state } = ctx;

    function installApprovalHandler() {

        /*
        | An approval becomes a pending question the browser can answer.
        */
        runtime.setApprovalHandler((evaluation, args) => {

            return new Promise(resolve => {

                const projectId =
                    evaluation.project_id ||
                    (runtime.runManager && runtime.runManager.current
                        ? runtime.runManager.current()?.projectId
                        : null) ||
                    state.projectId ||
                    null;

                const request = {
                    agent:
                        evaluation.agent,

                    tool:
                        evaluation.tool,

                    reason:
                        evaluation.reason,

                    groups:
                        evaluation.groups,

                    arguments:
                        args,

                    project_id:
                        projectId,

                    requested_at:
                        Date.now(),

                    resolve,

                    requested_from:
                        "web_console"
                };

                const stored =
                    state.approvals.begin(request);

                const id =
                    stored.id;

                runtime.events.emit("approval:request", {
                    id,
                    agent: request.agent,
                    tool: request.tool,
                    reason: request.reason,
                    groups: request.groups,
                    arguments: args,
                    project_id: projectId
                });
            });
        });
    }

    function resolveApproval(id, approved) {

        /*
        | `take` removes it, so a second click on the same button resolves
        | nothing and the endpoint answers 404 — the behaviour the console
        | depends on when two tabs are open.
        */
        const request =
            state.approvals.take(id);

        if (!request) {
            return false;
        }

        request.resolve(approved);

        /*
        | `agent` and `reason` are additive: a console watching several
        | projects can group a resolution by tool alone, which is not enough
        | once two projects can raise the same tool at the same moment.
        */
        runtime.events.emit("approval:resolved", {
            id,
            tool: request.tool,
            approved,
            agent: request.agent,
            reason: request.reason,
            project_id: request.project_id || null
        });

        return true;
    }

    return {
        installApprovalHandler,
        resolveApproval
    };
}

module.exports = {
    createApprovalService
};
