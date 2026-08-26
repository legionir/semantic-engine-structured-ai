"use strict";

/* Session domain service — EXECUTION_PLAN Phase 23. */

class SessionService {

    constructor({ runtime } = {}) {
        this.sessions = runtime?.sessions;
    }


    empty() {
        return this.sessions.emptySession();
    }


    list(root) {
        return this.sessions.listSessions(root);
    }


    save(session) {
        return this.sessions.saveSession(session);
    }


    load(id, root) {
        return this.sessions.loadSession(id, root);
    }


    delete(id, root) {
        return this.sessions.deleteSession(id, root);
    }


    summary(session) {
        return this.sessions.summarise(session);
    }
}


module.exports = {
    SessionService
};
