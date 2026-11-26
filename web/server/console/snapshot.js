"use strict";

/*
|--------------------------------------------------------------------------
| State snapshot
|--------------------------------------------------------------------------
|
| The console's state as one JSON document, and the per-client view of
| a single event (project-scoped tokens only see their own project).
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");


module.exports = function createSnapshot(shared) {

    const {
        approvalStore,
        runtime,
        sessions,
        sessionsEnabled,
        state
    } = shared;

    function snapshot() {

        const context =
            runtime.createRuntimeContext();

        return {
            status:
                state.status,

            task:
                state.task,

            answer:
                state.answer,

            error:
                state.error,

            started_at:
                state.startedAt,

            finished_at:
                state.finishedAt,

            workspace:
                context.runtime.workspace_root,

            model:
                runtime.activeModel({}),

            approval_mode:
                runtime.getApprovalMode(),

            limits:
                context.runtime,

            settings:
                runtime.settings.all(),

            auto_continue:
                runtime.settings.get("AUTO_CONTINUE") === true,

            cycles:
                state.cycles,

            plan:
                runtime.currentPlanView(),

            turns:
                state.history.filter(
                    message => message.role === "user"
                ).length,

            pending_approvals:
                approvalStore.pendingValues().map(
                    request => ({
                        id: request.id,
                        agent: request.agent,
                        tool: request.tool,
                        reason: request.reason,
                        arguments: request.arguments,
                        project_id: request.project_id || null
                    })
                ),

            discussion:
                state.discussion,

            agents:
                runtime.registries.AGENTS.map(
                    agent => ({
                        name: agent.name,
                        description: agent.description
                    })
                ),

            tool_groups:
                runtime.registries.TOOL_GROUPS,

            /*
            | Enough for the header to say whether the external servers
            | are up; the full list is behind /api/mcp.
            */

            mcp:
                context.mcp,

            events:
                state.events,

            session:
                sessions.summarise(state.session),

            messages:
                state.session.messages,

            sessions:
                sessionsEnabled()
                    ? sessions.listSessions()
                    : [],

            project:
                runtime.project.loadProject()
        };
    }


    function eventForClient(event, client) {

        if (!client) {
            return event;
        }

        const visibleOnProjectStream =
            runtime.events.visibleOnProjectStream;

        const aggregateMetadata =
            runtime.events.aggregateMetadata;

        if (client.projectId) {

            return typeof visibleOnProjectStream === "function"
                ? visibleOnProjectStream(event, client.projectId)
                : (event.project_id === client.projectId ? event : null);
        }

        if (
            client.claims &&
            !consoleAuth.allowsAllProjects(client.claims)
        ) {

            if (
                event.project_id &&
                !consoleAuth.allowsProject(client.claims, event.project_id)
            ) {
                return null;
            }

            if (!event.project_id && typeof aggregateMetadata === "function") {
                return aggregateMetadata(event);
            }
        }

        return event;
    }


    function snapshotFor(claims) {

        const snap = snapshot();

        if (!claims || consoleAuth.allowsAllProjects(claims)) {
            return snap;
        }

        snap.events =
            snap.events
                .map(event => eventForClient(event, { claims }))
                .filter(Boolean);

        snap.pending_approvals =
            snap.pending_approvals.filter(
                item =>
                    !item.project_id ||
                    consoleAuth.allowsProject(claims, item.project_id)
            );

        return snap;
    }

    return {
        snapshot,
        eventForClient,
        snapshotFor
    };
};
