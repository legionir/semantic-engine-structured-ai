"use strict";

/* Recover exactly one known structured action from provider prose. */

/*
| Prose around the action (roadmap P1-1). Several providers answer with a
| sentence, a reasoning block (<think>...</think>) or a Markdown fence
| around the JSON object, most of all when they do not support
| response_format (Anthropic, Bedrock, many local models). The action is
| recovered only when exactly one JSON object with a known action is
| found outside reasoning blocks; anything else stays a malformed answer
| and gets the usual correction notice.
*/
function balancedObjects(text, limit = 64) {

    const found = [];

    let start = text.indexOf("{");

    let tries = 0;

    while (start !== -1 && tries < limit) {

        tries++;

        let depth = 0;
        let inString = false;
        let escaped = false;
        let end = -1;

        for (let index = start; index < text.length; index++) {

            const character = text[index];

            if (escaped) {
                escaped = false;
                continue;
            }

            if (character === "\\" && inString) {
                escaped = true;
                continue;
            }

            if (character === '"') {
                inString = !inString;
                continue;
            }

            if (inString) {
                continue;
            }

            if (character === "{") {
                depth++;
            } else if (character === "}") {

                depth--;

                if (depth === 0) {
                    end = index;
                    break;
                }
            }
        }

        if (end === -1) {
            break;
        }

        try {

            found.push({ value: JSON.parse(text.slice(start, end + 1)), start, end });

            start = text.indexOf("{", end + 1);

        } catch {

            start = text.indexOf("{", start + 1);
        }
    }

    return found;
}


function salvageActionFromProse(text) {

    if (typeof text !== "string" || text.indexOf("{") === -1) {
        return null;
    }

    const visible =
        text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, " ");

    const actions =
        balancedObjects(visible).filter(item =>
            item.value &&
            typeof item.value === "object" &&
            !Array.isArray(item.value) &&
            ["tool_call", "delegate", "final"].includes(item.value.action)
        );

    const distinct =
        new Set(actions.map(item => JSON.stringify(item.value)));

    if (distinct.size !== 1) {
        return null;
    }

    const first = actions[0];

    return {
        action: first.value,
        preamble: visible.slice(0, first.start).trim(),
        trailing: visible.slice(first.end + 1).trim()
    };
}



module.exports = { salvageActionFromProse };
