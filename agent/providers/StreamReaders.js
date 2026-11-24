"use strict";

/*
|--------------------------------------------------------------------------
| Stream readers (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Server-sent events (OpenAI, Azure, OpenRouter, Anthropic, Gemini) and
| newline-delimited JSON (Ollama). Chunks may split a line, an event or
| a multi-byte character anywhere; both readers buffer across chunks.
|--------------------------------------------------------------------------
*/

async function* readLines(chunks) {

    const decoder = new TextDecoder("utf-8");

    let buffer = "";

    for await (const chunk of chunks) {

        buffer +=
            typeof chunk === "string"
                ? chunk
                : decoder.decode(chunk, { stream: true });

        let index;

        while ((index = buffer.indexOf("\n")) !== -1) {

            let line = buffer.slice(0, index);

            buffer = buffer.slice(index + 1);

            if (line.endsWith("\r")) {
                line = line.slice(0, -1);
            }

            yield line;
        }
    }

    buffer += decoder.decode();

    if (buffer !== "") {
        yield buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    }
}


async function* readSse(chunks) {

    let event = "";
    let data = [];

    for await (const line of readLines(chunks)) {

        if (line === "") {

            if (data.length > 0) {
                yield { event: event || "message", data: data.join("\n") };
            }

            event = "";
            data = [];

            continue;
        }

        if (line.startsWith(":")) {
            continue;
        }

        const colon = line.indexOf(":");

        const field = colon === -1 ? line : line.slice(0, colon);

        let value = colon === -1 ? "" : line.slice(colon + 1);

        if (value.startsWith(" ")) {
            value = value.slice(1);
        }

        if (field === "event") {
            event = value;
        } else if (field === "data") {
            data.push(value);
        }
    }

    if (data.length > 0) {
        yield { event: event || "message", data: data.join("\n") };
    }
}


async function* readNdjson(chunks) {

    for await (const line of readLines(chunks)) {

        const text = line.trim();

        if (text !== "") {
            yield JSON.parse(text);
        }
    }
}


/* SSE data as JSON; keep-alive pings and non-JSON lines are skipped. */
function parseEventData(event) {

    const text = String(event.data || "").trim();

    if (text === "" || text === "[DONE]") {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}


module.exports = {
    readLines,
    readSse,
    readNdjson,
    parseEventData
};
