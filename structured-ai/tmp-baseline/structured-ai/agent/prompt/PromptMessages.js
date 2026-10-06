/*
|--------------------------------------------------------------------------
| Prompt Messages
|--------------------------------------------------------------------------
|
| The small shared pieces every prompt section message is built from:
| JSON-typed system messages and the section-joined system text of the
| sub-agent prompt. Pure helpers, no runtime knowledge.
|--------------------------------------------------------------------------
*/

function jsonSystem(payload) {

    return {
        role: "system",

        content:
            JSON.stringify(payload)
    };

}


/* A sub-agent's system text is its sections joined by blank lines, with
   objects serialised and strings kept verbatim — the exact encoding the
   historical buildAgentSystemPrompt used. */
function joinSections(sections) {

    return sections
        .map(
            item =>
                typeof item === "string"
                    ? item
                    : JSON.stringify(item)
        )
        .join("\n\n");

}


module.exports = {
    jsonSystem,
    joinSections
};
