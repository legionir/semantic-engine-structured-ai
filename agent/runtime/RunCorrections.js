"use strict";

/*
|--------------------------------------------------------------------------
| Mid-run course corrections (roadmap P1-04)
|--------------------------------------------------------------------------
|
| An operator may correct a run while it works. The console hands the text
| to the run's AgentRunContext (`offer`); the main loop takes everything
| waiting at the start of its next iteration (`drainInto`) and adds it to
| the conversation as a user message, so the model reads it before its next
| decision. Each injection is a `run:correction` event, which puts it in the
| journal and the event store like every other step of the run.
*/

const MAX_CORRECTION_CHARS = () => 20000;


function normalise(text) {

    if (typeof text !== "string") {
        return "";
    }

    return text.trim().slice(0, MAX_CORRECTION_CHARS());
}


/* Queues a correction on a run context; false when there is nothing to add. */
function offer(context, text, meta = {}) {

    const value = normalise(text);

    if (!context || value === "") {
        return false;
    }

    if (!Array.isArray(context.pendingCorrections)) {
        context.pendingCorrections = [];
    }

    context.pendingCorrections.push({
        text: value,
        id: meta.id || null,
        at: Date.now()
    });

    return true;
}


function pending(context) {

    return context && Array.isArray(context.pendingCorrections)
        ? context.pendingCorrections.length
        : 0;
}


function message(text) {

    return {
        role: "user",
        content:
            "Course correction from the operator, sent while you were working. " +
            "It takes priority over the earlier instructions where they conflict; " +
            "adjust the plan and continue:\n\n" + text
    };
}


/* Moves every waiting correction into `messages`; returns how many. */
function drainInto(context, messages, events, iteration) {

    if (!pending(context) || !Array.isArray(messages)) {
        return 0;
    }

    const taken = context.pendingCorrections.splice(0);

    for (const correction of taken) {

        messages.push(message(correction.text));

        if (events && typeof events.emit === "function") {

            events.emit("run:correction", {
                agent: "main_agent",
                iteration,
                correction_id: correction.id,
                text: correction.text,
                waited_ms: Date.now() - correction.at
            });
        }
    }

    return taken.length;
}


module.exports = {
    drainInto,
    message,
    offer,
    pending
};
