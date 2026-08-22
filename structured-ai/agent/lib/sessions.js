const fs = require("fs");
const path = require("path");

const settings = require("./storage");

const { WORKSPACE_ROOT } = require("./workspace");


/*
|--------------------------------------------------------------------------
| Sessions
|--------------------------------------------------------------------------
|
| A console that keeps the conversation in the browser loses it on
| reload, and a run whose events only exist in memory cannot be reviewed
| afterwards. A session is therefore a file:
|
|   .agent/sessions/index.json     one line per session, for the list
|   .agent/sessions/<id>.json      the whole thing
|
| The whole thing means: the messages exchanged, the events exactly as
| they were streamed, and the full record of every tool call. That is
| what lets a stored session be replayed into the same conversation, plan,
| execution and events cards the live run drew, instead of a summary.
|
| Everything is capped, because a session that grows without bound is
| the same problem as a transcript that grows without bound.
|--------------------------------------------------------------------------
*/

const SESSION_VERSION = "1";


function sessionsDirectory() {

    return path.join(WORKSPACE_ROOT, ".agent", "sessions");
}


function indexPath() {

    return path.join(sessionsDirectory(), "index.json");
}


function sessionPath(id) {

    return path.join(sessionsDirectory(), `${safeId(id)}.json`);
}


/*
| An id becomes a file name, so it may never contain a path.
*/

function safeId(id) {

    return String(id).replace(/[^A-Za-z0-9_.-]/g, "_");
}


function newId() {

    return `s-${
        new Date().toISOString().replace(/[:.]/g, "-")
    }-${Math.random().toString(36).slice(2, 7)}`;
}


function emptySession(id) {

    const stamp = new Date().toISOString();

    return {
        version: SESSION_VERSION,
        id: id || newId(),
        title: null,
        workspace: WORKSPACE_ROOT,
        created_at: stamp,
        updated_at: stamp,
        status: "idle",
        turns: 0,
        messages: [],
        events: [],
        calls: []
    };
}


function readJson(file, fallback) {

    if (!fs.existsSync(file)) {
        return fallback;
    }

    try {

        return JSON.parse(fs.readFileSync(file, "utf8"));

    } catch {

        return fallback;
    }
}


function loadIndex() {

    const parsed =
        readJson(indexPath(), { sessions: [] });

    return {
        sessions:
            Array.isArray(parsed.sessions)
                ? parsed.sessions
                : []
    };
}


function saveIndex(index) {

    fs.mkdirSync(sessionsDirectory(), { recursive: true });

    fs.writeFileSync(
        indexPath(),
        `${JSON.stringify(index, null, 2)}\n`,
        "utf8"
    );

    return index;
}


function summarise(session) {

    return {
        id: session.id,

        title:
            session.title ||
            titleFrom(session),

        created_at: session.created_at,

        updated_at: session.updated_at,

        status: session.status,

        turns: session.turns,

        messages: session.messages.length,

        events: session.events.length,

        calls: session.calls.length
    };
}


/*
| The first thing the operator asked is the best name a session can
| have, and it costs nothing to derive.
*/

function titleFrom(session) {

    const first =
        session.messages.find(
            message => message.role === "user"
        );

    if (!first) {
        return "New conversation";
    }

    const text =
        String(first.content || "").trim().split("\n")[0];

    return text.length > 60
        ? `${text.slice(0, 60)}…`
        : text || "New conversation";
}


function loadSession(id) {

    const parsed =
        readJson(sessionPath(id), null);

    if (!parsed) {
        return null;
    }

    const session = emptySession(id);

    return {
        ...session,
        ...parsed,

        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        calls: Array.isArray(parsed.calls) ? parsed.calls : []
    };
}


function trim(session) {

    const messageLimit =
        settings.get("SESSION_MAX_MESSAGES");

    const eventLimit =
        settings.get("SESSION_MAX_EVENTS");

    const callLimit =
        settings.get("SESSION_MAX_CALLS");

    if (session.messages.length > messageLimit) {

        session.messages =
            session.messages.slice(-messageLimit);
    }

    if (session.events.length > eventLimit) {

        session.events =
            session.events.slice(-eventLimit);
    }

    if (session.calls.length > callLimit) {

        session.calls =
            session.calls.slice(-callLimit);
    }

    return session;
}


function saveSession(session) {

    if (settings.get("SESSIONS_ENABLED") !== true) {
        return session;
    }

    fs.mkdirSync(sessionsDirectory(), { recursive: true });

    session.updated_at = new Date().toISOString();

    session.title =
        session.title || titleFrom(session);

    trim(session);

    fs.writeFileSync(
        sessionPath(session.id),
        `${JSON.stringify(session, null, 2)}\n`,
        "utf8"
    );

    const index = loadIndex();

    const summary = summarise(session);

    const existing =
        index.sessions.findIndex(
            item => item.id === session.id
        );

    if (existing === -1) {

        index.sessions.unshift(summary);

    } else {

        index.sessions[existing] = summary;
    }

    /*
    | Newest first, so the list needs no sorting in the browser, and
    | bounded, so a workspace used for a year still opens quickly.
    */

    index.sessions.sort(
        (left, right) =>
            String(right.updated_at).localeCompare(
                String(left.updated_at)
            )
    );

    const limit =
        settings.get("SESSION_MAX_KEPT");

    for (const dropped of index.sessions.slice(limit)) {

        try {

            fs.unlinkSync(sessionPath(dropped.id));

        } catch {

            /* already gone */
        }
    }

    index.sessions = index.sessions.slice(0, limit);

    saveIndex(index);

    return session;
}


function listSessions() {

    return loadIndex().sessions;
}


function deleteSession(id) {

    const index = loadIndex();

    const before = index.sessions.length;

    index.sessions =
        index.sessions.filter(item => item.id !== id);

    try {

        fs.unlinkSync(sessionPath(id));

    } catch {

        /* already gone */
    }

    saveIndex(index);

    return index.sessions.length !== before;
}


module.exports = {
    SESSION_VERSION,
    sessionsDirectory,
    indexPath,
    sessionPath,
    newId,
    emptySession,
    loadSession,
    saveSession,
    listSessions,
    deleteSession,
    loadIndex,
    saveIndex,
    summarise,
    titleFrom
};
