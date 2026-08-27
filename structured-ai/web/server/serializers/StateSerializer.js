"use strict";

/*
|--------------------------------------------------------------------------
| Web console state snapshot (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| One object answers three questions: what is the console showing right
| now, what should a reconnecting browser redraw, and what may *this* token
| see of either.
|
| `snapshot()` is the shape /api/state, the opening frame of /api/events and
| the session replay all promise, so no field may be renamed or dropped —
| the route contract pins the whole key tree. `snapshotFor()` is the
| filtering half: a scoped token gets the same object with the events it
| may not see removed, which is why it is a serializer and not a route.
|
| Nothing here reads a request: it reads the console's own state and the
| runtime, which is what lets the same snapshot serve a project-scoped
| stream and a browser reload without a second implementation.
|--------------------------------------------------------------------------
*/

const { pendingApprovalsForSnapshot } = require("./SessionSerializer");
const consoleAuth = require("../../../agent/lib/consoleAuth");

function createStateSerializer(ctx) {

    const { runtime, state, sessions } = ctx;

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
                ctx.settings.all(),

            auto_continue:
                ctx.settings.autoContinue(),

            cycles:
                state.cycles,

            plan:
                runtime.currentPlanView(),

            turns:
                state.history.filter(
                    message => message.role === "user"
                ).length,

            pending_approvals:
                pendingApprovalsForSnapshot(
                    state.approvals.listPending()
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
                ctx.settings.sessionsEnabled()
                    ? sessions.listSessions()
                    : [],

            project:
                runtime.project.loadProject()
        };
    }

    function snapshotFor(claims) {

        const snap = snapshot();

        if (!claims || consoleAuth.allowsAllProjects(claims)) {
            return snap;
        }

        snap.events =
            snap.events
                .map(event => ctx.eventForClient(event, { claims }))
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
        snapshotFor
    };
}

module.exports = {
    createStateSerializer
};
