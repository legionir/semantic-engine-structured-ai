"use strict";

/*
|--------------------------------------------------------------------------
| Conversation size (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Context sizing is a standalone boundary. Settings are read at the
| moment of use, never captured at load.
|--------------------------------------------------------------------------
*/


/*
| A picture is billed by the provider per image, not per base64 character:
| counting its data URL would make one screenshot look like 400k characters
| and compact the whole conversation away. IMAGE_CONTEXT_CHARS is the
| character-equivalent each image part is counted as.
*/

function partSize(part) {

    if (part && typeof part === "object" && (part.type === "image_url" || part.type === "image" || part.type === "input_image")) {
        return require("../config").get("IMAGE_CONTEXT_CHARS");
    }

    return JSON.stringify(part === undefined ? null : part).length;
}


function messageSize(message) {

    if (!message) {
        return 0;
    }

    let size = 0;

    if (typeof message.content === "string") {
        size += message.content.length;
    } else if (Array.isArray(message.content)) {
        size += message.content.reduce((total, part) => total + partSize(part), 0);
    } else if (message.content) {
        size += JSON.stringify(message.content).length;
    }

    if (Array.isArray(message.tool_calls)) {
        size += JSON.stringify(message.tool_calls).length;
    }

    return size;
}


function conversationSize(messages) {

    return messages.reduce(
        (total, message) =>
            total + messageSize(message),
        0
    );
}


module.exports = {
    partSize,
    messageSize,
    conversationSize
};
