"use strict";

/*
| The available_skills message inside a running conversation.
|
| The opening messages are built once, on a conversation's first turn.
| Every later turn calls syncSkillIndex: a fresh index replaces the old
| one (the operator may have changed which skills are sent to the AI), and
| a `/skill` turn removes it, because that message carries its own
| complete skill. The next ordinary turn puts it back where it belongs:
| before the persona and agent catalogues, or before the first
| conversation message.
*/

function sectionType(message) {

    if (!message || message.role !== "system" || typeof message.content !== "string" || !message.content.startsWith("{\"type\":")) {
        return null;
    }

    try {
        return JSON.parse(message.content).type || null;
    } catch {
        return null;
    }
}


function syncSkillIndex(messages, fresh) {

    if (!Array.isArray(messages)) return messages;

    const at = messages.findIndex(message => sectionType(message) === "available_skills");

    if (!fresh) {
        if (at !== -1) messages.splice(at, 1);
        return messages;
    }

    if (at !== -1) {
        messages[at] = fresh;
        return messages;
    }

    let position = messages.findIndex(message => ["available_personas", "available_agents"].includes(sectionType(message)));

    if (position === -1) position = messages.findIndex(message => message.role !== "system");
    if (position === -1) position = messages.length;

    messages.splice(position, 0, fresh);

    return messages;
}


module.exports = {
    sectionType,
    syncSkillIndex
};
