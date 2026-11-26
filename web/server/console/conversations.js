"use strict";

/*
|--------------------------------------------------------------------------
| Project conversations (roadmap P1-03 / P1-04)
|--------------------------------------------------------------------------
|
| Every project has its own live conversation beside the console's single
| foreground one (`state`): its status, the transcript, the events the
| project's stream replays, the history its background turns continue, and
| the queue of messages waiting for the next turn.
|
| - A project run in the foreground still drives `state` (the /api/state
|   contract); its messages are mirrored here, so the project keeps one
|   transcript whichever way its turns ran.
| - A project run in the background (the foreground was taken) lives only
|   here: messages, status and git report never touch `state`.
| - The events are buffered per project, so three projects running at once
|   cannot push each other's events out of a shared buffer, and switching
|   between them replays everything (nothing is lost on a tab switch).
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
*/

const { withoutImages } = require("../../../agent/runtime/ImageChannel");


module.exports = function createConversations(shared) {

    const {
        approvalStore,
        runtime,
        state
    } = shared;

    const conversations = new Map();


    function eventCap() {

        return runtime.settings.get("MAX_CONSOLE_EVENTS");
    }


    function messageCap() {

        return Math.max(1000, eventCap());
    }


    function ensure(projectId) {

        let conv = conversations.get(projectId);

        if (!conv) {

            conv = {
                projectId,
                status: "idle",
                task: null,
                answer: null,
                error: null,
                startedAt: null,
                finishedAt: null,
                background: false,
                history: [],
                messages: [],
                events: [],
                turnCounter: 0,
                currentTurnId: null,
                cycles: 0,
                lastPlanSignature: null,
                stopRequested: false,
                queue: [],
                queuePaused: false,
                queueSeq: 0,
                session: runtime.sessions.emptySession()
            };

            conversations.set(projectId, conv);
        }

        return conv;
    }


    function get(projectId) {

        return conversations.get(projectId) || null;
    }


    function busy(projectId) {

        const conv = conversations.get(projectId);

        return Boolean(conv && conv.status === "running");
    }


    function pendingApprovals(projectId) {

        return approvalStore.pendingValues()
            .filter(request => (request.project_id || null) === (projectId || null))
            .length;
    }


    /* GET /api/projects/:id/run - the historical slot view, plus the queue */
    function view(projectId) {

        const conv = conversations.get(projectId);

        if (!conv || conv.startedAt === null) {

            return {
                project_id: projectId,
                status: "idle",
                queue_length: conv ? conv.queue.length : 0,
                queue_paused: conv ? conv.queuePaused : false
            };
        }

        return {
            project_id: projectId,
            status: conv.status,
            task: conv.task,
            answer: conv.answer,
            error: conv.error,
            started_at: conv.startedAt,
            finished_at: conv.finishedAt,
            background: conv.background,
            turn_id: conv.currentTurnId,
            pending_approvals: pendingApprovals(projectId),
            queue_length: conv.queue.length,
            queue_paused: conv.queuePaused
        };
    }


    function clip(text) {

        return typeof text === "string" && text.length > 200
            ? `${text.slice(0, 199)}…`
            : text || null;
    }


    /* One line per conversation for the console's tabs and notifications. */
    function list() {

        const items = [];

        const foregroundIsDefault = !state.projectId;

        items.push({
            project_id: null,
            status: foregroundIsDefault ? state.status : "idle",
            task: foregroundIsDefault ? clip(state.task) : null,
            started_at: foregroundIsDefault ? state.startedAt : null,
            finished_at: foregroundIsDefault ? state.finishedAt : null,
            background: false,
            pending_approvals: pendingApprovals(null),
            queue_length: 0,
            queue_paused: false,
            messages: foregroundIsDefault ? state.session.messages.length : 0
        });

        for (const conv of conversations.values()) {

            const approvals = pendingApprovals(conv.projectId);

            /* a buffer that only ever saw events (the default workspace's
               own project id, for one) is not a conversation */
            if (conv.startedAt === null && conv.messages.length === 0 && conv.queue.length === 0 && approvals === 0) {
                continue;
            }

            items.push({
                project_id: conv.projectId,
                status: conv.status,
                task: clip(conv.task),
                started_at: conv.startedAt,
                finished_at: conv.finishedAt,
                background: conv.background,
                pending_approvals: approvals,
                queue_length: conv.queue.length,
                queue_paused: conv.queuePaused,
                messages: conv.messages.length
            });
        }

        return items;
    }


    /* every project-scoped event is kept in that project's own buffer */
    function recordEvent(event) {

        if (!event || typeof event.project_id !== "string" || event.project_id === "") {
            return;
        }

        const conv = ensure(event.project_id);

        conv.events.push(event);

        const cap = eventCap();

        if (conv.events.length > cap) {
            conv.events.splice(0, conv.events.length - cap);
        }
    }


    function trimMessages(conv) {

        const cap = messageCap();

        if (conv.messages.length > cap) {
            conv.messages.splice(0, conv.messages.length - cap);
        }
    }


    /* a foreground message of a project run is kept in its transcript too */
    function mirrorMessage(projectId, message) {

        if (!projectId) {
            return;
        }

        const conv = ensure(projectId);

        conv.messages.push(message);
        trimMessages(conv);
    }


    /* a background turn's message: its own transcript and its own stream */
    function addMessage(conv, entry) {

        const message = {
            at: Date.now(),
            ...entry
        };

        conv.messages.push(message);
        trimMessages(conv);

        runtime.events.emit("session:message", {
            session: conv.session ? conv.session.id : null,
            project_id: conv.projectId,
            background: true,
            message
        });

        return message;
    }


    /*
    | Which background conversation a run event belongs to: by the turn
    | first (exact), then by the project of a running background turn.
    */
    function backgroundOwnerOf(event) {

        if (!event) {
            return null;
        }

        for (const conv of conversations.values()) {

            if (conv.background && event.turn_id && conv.currentTurnId === event.turn_id) {
                return conv;
            }
        }

        const conv =
            event.project_id ? conversations.get(event.project_id) : null;

        return conv && conv.background && conv.status === "running"
            ? conv
            : null;
    }


    /*
    | A background conversation is saved under its project's data root, so
    | it appears in that project's history like a foreground one.
    */
    function saveConversation(conv) {

        if (!conv.session || runtime.settings.get("SESSIONS_ENABLED") !== true) {
            return;
        }

        try {

            const context =
                runtime.resolveRunProjectContext({ projectId: conv.projectId });

            conv.session.messages = conv.messages.slice();
            conv.session.events = conv.events.slice();
            conv.session.history = withoutImages(conv.history);
            conv.session.status = conv.status;
            conv.session.turns =
                conv.messages.filter(message => message.role === "user").length;

            runtime.sessions.saveSession(conv.session, context.dataRoot);

        } catch {

            /* a project whose data root cannot be written is not fatal */
        }
    }


    /* "New conversation" on a project: the next turn starts from nothing */
    function resetConversation(projectId) {

        const conv = conversations.get(projectId);

        if (!conv) {
            return true;
        }

        if (conv.status === "running") {
            return false;
        }

        if (conv.background && conv.messages.length > 0) {
            saveConversation(conv);
        }

        Object.assign(conv, {
            status: "idle",
            task: null,
            answer: null,
            error: null,
            startedAt: null,
            finishedAt: null,
            background: false,
            history: [],
            messages: [],
            events: [],
            currentTurnId: null,
            cycles: 0,
            lastPlanSignature: null,
            stopRequested: false,
            session: runtime.sessions.emptySession()
        });

        return true;
    }


    /*
    | The foreground switched conversation (a stored session opened, a new
    | one started): the project it holds now shows that conversation.
    */
    function syncForeground() {

        const conv =
            state.projectId ? conversations.get(state.projectId) : null;

        if (!conv || conv.background || conv.status === "running") {
            return;
        }

        conv.messages = state.session.messages.slice();
        conv.history = state.history.slice();
    }


    return {
        conversations: {
            addMessage,
            backgroundOwnerOf,
            busy,
            ensure,
            get,
            list,
            mirrorMessage,
            pendingApprovals,
            recordEvent,
            resetConversation,
            saveConversation,
            syncForeground,
            view
        }
    };
};
