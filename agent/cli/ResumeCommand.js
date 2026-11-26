"use strict";

/*
|--------------------------------------------------------------------------
| agent resume [session-id] [message] (roadmap P1-06)
|--------------------------------------------------------------------------
|
| Continues a stored conversation from the command line: the one named,
| else the newest one a restart cut off, else the newest of all. A cut-off
| conversation is continued with the message that says what happened (the
| stored history already holds the agent's progress); a finished one needs
| a message to continue with. The answer is printed and the conversation
| is saved back where it came from, so the console's History shows the
| new turn too.
|
| With --project the project's own conversations are searched first, then
| the workspace's (the console saves a foreground project conversation
| there).
*/

const SessionResume = require("../persistence/SessionResume");


function roots(runtime, options) {

    if (!options.project) {
        return [undefined];
    }

    const context = runtime.resolveRunProjectContext({ projectId: options.project });

    return [context.dataRoot, undefined];
}


async function runResume(runtime, options, { fail, write = text => process.stdout.write(text) }) {

    if (runtime.settings.get("SESSIONS_ENABLED") !== true) {
        fail("conversations are not saved (SESSIONS_ENABLED=false), so there is nothing to resume");
    }

    const found =
        SessionResume.findSession(runtime.sessions, roots(runtime, options), options.resumeId || null);

    if (!found) {
        fail(options.resumeId ? `no stored conversation ${options.resumeId}` : "no stored conversation to resume");
    }

    const { session, root } = found;
    const message = options.positional.join(" ").trim();
    const cutOff = SessionResume.wasCutOff(session.status);

    if (!cutOff && !message) {
        fail(`conversation ${session.id} finished (${session.status}); give a message to continue it: agent resume ${session.id} "what next"`);
    }

    const task =
        cutOff
            ? SessionResume.resumeTask(session, message)
            : message;

    const projectId = options.project || session.project_id || null;
    const history = Array.isArray(session.history) ? session.history : [];
    const turnId = `turn-${Date.now()}-cli`;

    if (!options.quiet) {
        process.stderr.write(`resume: ${session.id} (${session.title || "conversation"}, ${session.status})\n`);
    }

    session.messages.push({ at: Date.now(), role: "user", kind: cutOff ? "resume" : "message", content: task, turn_id: turnId });
    session.status = "running";
    session.task = cutOff ? session.task : message;

    let action;
    let failure = null;

    try {

        action =
            await runtime.runAgent({
                task,
                turn_id: turnId,
                history,
                ...(projectId ? { projectId } : {})
            });

    } catch (error) {

        failure = error;
    }

    const answer = action && action.response ? action.response.content : null;
    const error = failure ? { code: failure.name || "RUNTIME_ERROR", message: failure.message } : (action && action.error) || null;

    if (answer) {
        session.messages.push({ at: Date.now(), role: "assistant", kind: "response", content: answer, turn_id: turnId });
    }

    if (error) {
        session.messages.push({ at: Date.now(), role: "assistant", kind: "error", content: `${error.code}: ${error.message}`, turn_id: turnId });
    }

    session.history = history;
    session.status = error ? "failed" : "done";
    session.turns = session.messages.filter(item => item.role === "user").length;

    try {
        runtime.sessions.saveSession(session, root);
    } catch (saveError) {
        process.stderr.write(`resume: the conversation could not be saved: ${saveError.message}\n`);
    }

    if (options.json) {
        write(`${JSON.stringify(action || { error }, null, 2)}\n`);
    } else if (answer) {
        write(`\n${answer}\n`);
    } else if (error) {
        process.stderr.write(`\nagent: run failed\n${error.message}\n`);
    }

    return { session, action, error };
}


module.exports = {
    runResume
};
