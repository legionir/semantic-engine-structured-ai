"use strict";

const fs = require("fs");
const path = require("path");

const dataRoot = require("../lib/dataRoot");
const { readJson, writeJson } = require("./JsonRepository");
const { safeId } = require("./SafeIdentifier");

/*
|--------------------------------------------------------------------------
| Discussion Persistence Repository — EXECUTION_PLAN Phase 28
|--------------------------------------------------------------------------
|
| Persists discussion transcripts and final syntheses per project so they
| survive restarts, are replayable, and remain strictly isolated between
| projects.
|--------------------------------------------------------------------------
*/

function discussionsDirectory(root) {

    const dir = path.join(
        dataRoot.resolveRoot(root),
        "discussions"
    );

    fs.mkdirSync(dir, { recursive: true });

    return dir;
}


function discussionPath(id, root) {

    return path.join(
        discussionsDirectory(root),
        `${safeId(id)}.json`
    );
}


function saveDiscussion(discussion, root) {

    if (!discussion || typeof discussion !== "object") {

        throw new Error("saveDiscussion requires a discussion object");
    }

    const id =
        discussion.id ||
        `discussion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const record = {
        ...discussion,
        id,
        saved_at: Date.now()
    };

    const targetFile = discussionPath(id, root);

    writeJson(targetFile, record);

    return record;
}


function getDiscussion(id, root) {

    if (!id) {
        return null;
    }

    const file = discussionPath(id, root);

    return readJson(file, null);
}


function listDiscussions(root) {

    const dir = discussionsDirectory(root);

    if (!fs.existsSync(dir)) {
        return [];
    }

    const entries = [];

    for (const file of fs.readdirSync(dir)) {

        if (!file.endsWith(".json")) {
            continue;
        }

        const doc = readJson(path.join(dir, file), null);

        if (!doc || !doc.id) {
            continue;
        }

        entries.push({
            id: doc.id,
            project_id: doc.project_id || null,
            run_id: doc.run_id || null,
            task: doc.task || "",
            personas: Array.isArray(doc.personas) ? doc.personas : [],
            total_rounds: doc.total_rounds ?? 0,
            hit_max_rounds: Boolean(doc.hit_max_rounds),
            stopped_reason: doc.stopped_reason || null,
            created_at: doc.created_at || doc.saved_at || null,
            finished_at: doc.finished_at || null,
            duration_ms: doc.duration_ms ?? null,
            summary: doc.final_report?.summary || null
        });
    }

    entries.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    return entries;
}


function deleteDiscussion(id, root) {

    if (!id) {
        return false;
    }

    const file = discussionPath(id, root);

    if (fs.existsSync(file)) {

        fs.unlinkSync(file);

        return true;
    }

    return false;
}


module.exports = {
    discussionsDirectory,
    discussionPath,
    saveDiscussion,
    getDiscussion,
    listDiscussions,
    deleteDiscussion
};
