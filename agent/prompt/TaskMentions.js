"use strict";

/*
|--------------------------------------------------------------------------
| Task mentions and attached pictures (roadmap P1-09)
|--------------------------------------------------------------------------
|
| expandTask(task, root) prepares a user message before it reaches the
| model:
|
|   @path        a workspace file or directory named with a leading @ is
|                read by the runtime and appended to the message (a
|                directory as a listing, a picture as an image), so the
|                user does not have to wait for the model to go and look.
|                Only paths inside the workspace resolve (the same
|                boundary as the tools); a token that names nothing, an
|                e-mail address, a decorator, stays plain text.
|
|   attachments  the console stores uploaded files in <root>/upload_tmp
|                and lists their absolute paths in the message. Pictures
|                among them are shown to the model through the image
|                channel instead of being a path it cannot look at.
|
| TASK_MENTION_MAX_CHARS bounds the text appended for all mentions
| together; whatever does not fit is named but not inlined.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const settings = require("../config");
const boundary = require("../context/WorkspaceBoundary");
const { channel } = require("../runtime/ImageChannel");

const IMAGE_EXTENSIONS = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"]
]);

/* @ at the start or after whitespace/brackets, a relative path after it */
const MENTION = /(^|[\s(["'])@((?:\.{1,2}\/)?[A-Za-z0-9_\-.][A-Za-z0-9_\-./\\]*)/g;


function realRootOf(root) {

    try {
        return typeof root === "string" && root !== "" ? fs.realpathSync(root) : null;
    } catch {
        return null;
    }

}


function looksBinary(buffer) {

    return buffer.subarray(0, settings.get("BINARY_PROBE_BYTES")).includes(0);

}


function readImage(file, source) {

    const mediaType = IMAGE_EXTENSIONS.get(path.extname(file).toLowerCase());
    const stat = fs.statSync(file);

    const limit = settings.get("MODEL_IMAGE_MAX_BYTES");

    if (stat.size > limit) {
        return { type: "image", media_type: mediaType, bytes: stat.size, omitted: `image is larger than MODEL_IMAGE_MAX_BYTES (${limit})` };
    }

    return channel.keep({ mediaType, data: fs.readFileSync(file).toString("base64"), source });

}


function listing(directory, limit) {

    const entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

    const shown = entries.slice(0, limit).map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name));

    return entries.length > limit
        ? [...shown, `… ${entries.length - limit} more`].join("\n")
        : shown.join("\n");

}


/* Resolve one @token; null when it does not name something in the root. */
function resolveMention(realRoot, token) {

    const cleaned = token.replace(/[.,;:!?)\]'"]+$/, "");

    if (cleaned === "" || path.isAbsolute(cleaned)) {
        return null;
    }

    try {
        const target = boundary.resolvePathInRoot(realRoot, cleaned, { mustExist: true });
        return { token: cleaned, target, stat: fs.statSync(target) };
    } catch {
        return null;
    }

}


function mentionSections(task, realRoot) {

    const seen = new Set();
    const sections = [];
    const images = [];
    let budget = settings.get("TASK_MENTION_MAX_CHARS");

    for (const match of String(task).matchAll(MENTION)) {

        const found = resolveMention(realRoot, match[2]);

        if (!found || seen.has(found.target)) continue;

        seen.add(found.target);

        const relative = path.relative(realRoot, found.target).split(path.sep).join("/") || ".";

        if (found.stat.isDirectory()) {

            const text = listing(found.target, 200);
            const fits = text.length <= budget;
            sections.push(fits ? `### @${relative}/ (directory)\n${text}` : `### @${relative}/ (directory, not inlined: the mention budget is used up)`);
            budget -= fits ? text.length : 0;
            continue;
        }

        if (!found.stat.isFile()) continue;

        if (IMAGE_EXTENSIONS.has(path.extname(found.target).toLowerCase())) {
            images.push(readImage(found.target, `@${relative}`));
            sections.push(`### @${relative} (picture, attached below)`);
            continue;
        }

        const room = Math.max(0, budget);
        const handle = fs.openSync(found.target, "r");
        let buffer;

        try {
            buffer = Buffer.alloc(Math.min(found.stat.size, room + 1));
            fs.readSync(handle, buffer, 0, buffer.length, 0);
        } finally {
            fs.closeSync(handle);
        }

        if (looksBinary(buffer)) {
            sections.push(`### @${relative} (binary file, ${found.stat.size} bytes, not inlined)`);
            continue;
        }

        if (room === 0) {
            sections.push(`### @${relative} (not inlined: the mention budget is used up; read it with fs_read)`);
            continue;
        }

        const text = buffer.toString("utf8");
        const cut = text.length > room || found.stat.size > room;
        const body = cut ? text.slice(0, room) : text;

        sections.push(`### @${relative}${cut ? ` (first ${body.length} characters of ${found.stat.size} bytes)` : ""}\n\`\`\`\n${body}\n\`\`\``);
        budget -= body.length;
    }

    return { sections, images };

}


/* Pictures the console uploaded into <root>/upload_tmp and named in the task. */
function attachedPictures(task, realRoot) {

    const uploads = realRootOf(path.join(realRoot, "upload_tmp"));
    const images = [];

    if (!uploads) {
        return images;
    }

    const seen = new Set();

    for (const match of String(task).matchAll(/"([^"\n]+)"/g)) {

        const candidate = match[1];

        if (!path.isAbsolute(candidate) || !IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) continue;

        let real;

        try {
            real = fs.realpathSync(candidate);
        } catch {
            continue;
        }

        if (seen.has(real) || path.dirname(real) !== uploads || !fs.statSync(real).isFile()) continue;

        seen.add(real);
        images.push(readImage(real, `attachment ${path.basename(real)}`));
    }

    return images;

}


function expandTask(task, root) {

    const realRoot = realRootOf(root);

    if (typeof task !== "string" || task.trim() === "" || !realRoot) {
        return { task, images: [] };
    }

    const { sections, images } = mentionSections(task, realRoot);
    const pictures = [...images, ...attachedPictures(task, realRoot)];

    const text = sections.length > 0
        ? `${task}\n\nFiles referenced with @ (read by the runtime when the message was sent):\n\n${sections.join("\n\n")}`
        : task;

    return { task: text, images: pictures };

}


module.exports = {
    expandTask,
    resolveMention,
    attachedPictures,
    IMAGE_EXTENSIONS
};
