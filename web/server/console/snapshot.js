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
const { isImageMessage } = require("../../../agent/runtime/ImageChannel");


module.exports = function createSnapshot(shared) {

    const {
        approvalStore,
        conversations,
        projectQueue,
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
                    message => message.role === "user" && !isImageMessage(message)
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
                runtime.project.loadProject(),

            /* every live conversation, for the console's tabs (P1-03) */
            conversations:
                conversations.list()
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

        snap.conversations = conversationsFor(claims, snap.conversations);

        return snap;
    }


    /* the conversations a token may see: its projects, never the default */
    function conversationsFor(claims, list = conversations.list()) {

        if (!claims || consoleAuth.allowsAllProjects(claims)) {
            return list;
        }

        return list.filter(item =>
            item.project_id !== null &&
            consoleAuth.allowsProject(claims, item.project_id)
        );
    }

    function planFor(projectId) {

        try {

            return runtime.runWithProject(
                runtime.resolveRunProjectContext({ projectId }),
                () => runtime.currentPlanView()
            );

        } catch {

            return runtime.currentPlanView();
        }
    }


    /* the project's own buffer first, then what the shared buffer still has */
    function projectEvents(conv, client) {

        const seen = new Set();
        const events = [];

        const add = event => {

            const key = `${event.seq}|${event.type}`;

            if (!seen.has(key)) {
                seen.add(key);
                events.push(event);
            }
        };

        for (const event of conv ? conv.events : []) {
            add(event);
        }

        for (const event of state.events) {

            const visible = eventForClient(event, client);

            if (visible) {
                add(visible);
            }
        }

        return events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    }


    /*
    | What one project's stream starts from (P1-03). The project's events
    | come from its own buffer, so a conversation that ran while another
    | was on screen replays in full. A conversation the foreground does not
    | hold right now (a background turn, or the foreground moved on) is drawn
    | from the project's own transcript and status.
    */
    function projectSnapshot(projectId, claims) {

        const snap = snapshotFor(claims);

        const conv = conversations.get(projectId);

        snap.project_id = projectId;

        snap.events = projectEvents(conv, { projectId, claims });

        snap.pending_approvals =
            snap.pending_approvals.filter(
                item => !item.project_id || item.project_id === projectId
            );

        snap.plan = planFor(projectId);

        snap.queue = projectQueue.view(projectId);

        const own =
            conv && (conv.background || state.projectId !== projectId);

        snap.conversation =
            own
                ? (conv.background ? "background" : "project")
                : "foreground";

        /* the project's own transcript, also while the foreground holds it:
           the shared foreground session may hold other conversations too */
        if (conv && !own) {

            snap.messages = conv.messages;
        }

        if (own) {

            Object.assign(snap, {
                status: conv.status,
                task: conv.task,
                answer: conv.answer,
                error: conv.error,
                started_at: conv.startedAt,
                finished_at: conv.finishedAt,
                cycles: conv.cycles,
                turns: conv.messages.filter(message => message.role === "user").length,
                messages: conv.messages,
                session: conv.session ? sessions.summarise(conv.session) : snap.session
            });
        }

        return snap;
    }


    return {
        snapshot,
        conversationsFor,
        eventForClient,
        projectSnapshot,
        snapshotFor
    };
};
