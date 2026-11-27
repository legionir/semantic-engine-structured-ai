"use strict";

/*
|--------------------------------------------------------------------------
| Continuing an interrupted conversation (roadmap P1-06)
|--------------------------------------------------------------------------
|
| Shared by the console (web/server/console/interrupted-runs.js) and the
| CLI (`agent resume`): the message that starts the continued turn, and
| how the conversation to continue is found.
|
| A turn is checkpointed while it runs, so the stored history already
| holds what the agent did before the restart: its actions, the tool
| results, the files it read. The continued turn starts from exactly that
| context; the message only says what happened and that work may be
| half-done.
*/

function resumeTask(session, message) {

    const task =
        session && typeof session.task === "string" && session.task.trim() !== ""
            ? session.task.trim()
            : null;

    const lines = [
        "The server restarted while you were working, so your previous turn was interrupted before it finished.",
        "Everything you did up to that point is in the conversation above, including the tool calls you made and their results.",
        "Work may be half-done: check the current state of the files (and of anything you started) before repeating a step, then continue and finish the task.",
        ...(task ? ["", `The task you were working on: ${task}`] : [])
    ];

    if (typeof message === "string" && message.trim() !== "") {
        lines.push("", message.trim());
    }

    return lines.join("\n");
}


function wasCutOff(status) {

    return status === "running" || status === "interrupted";
}


/*
| The conversation to continue: the one named, else the newest cut off by
| a restart, else the newest of all. `roots` are data roots (undefined =
| the active workspace) searched in order.
*/
function findSession(sessions, roots, id) {

    const listed = [];

    for (const root of roots) {

        let items = [];

        try {
            items = sessions.listSessions(root);
        } catch {
            items = [];
        }

        for (const item of items) {
            listed.push({ ...item, root });
        }
    }

    let chosen = null;

    if (id) {
        chosen = listed.find(item => item.id === id) || null;
    } else {

        const newest = (left, right) => String(right.updated_at).localeCompare(String(left.updated_at));

        chosen =
            listed.filter(item => wasCutOff(item.status)).sort(newest)[0] ||
            listed.sort(newest)[0] ||
            null;
    }

    if (!chosen) {
        return null;
    }

    const session = sessions.loadSession(chosen.id, chosen.root);

    return session ? { session, root: chosen.root } : null;
}


module.exports = {
    resumeTask,
    wasCutOff,
    findSession
};
