"use strict";

const fs = require("fs");
const path = require("path");

const dataRoot = require("../lib/dataRoot");
const JsonRepository = require("../persistence/JsonRepository");
const { safeId } = require("../persistence/SafeIdentifier");
const SchemaVersion = require("../persistence/SchemaVersion");


/*
|--------------------------------------------------------------------------
| Discussion transcript repository — EXECUTION_PLAN Phase 28
|--------------------------------------------------------------------------
|
| TranscriptStore remains the in-memory round model used by the engine. This
| repository is the durable project boundary around it: a registered
| project's transcript is written under its dataRoot/discussion directory,
| while a legacy/synthetic run resolves to the historical workspace root.
| Writes use the Phase 18 atomic JSON repository and reads are tolerant of a
| missing/corrupt individual transcript.
|--------------------------------------------------------------------------
*/

const VERSION = "1";
const DIRECTORY = "discussion";


function rootOf(root) {
    return dataRoot.resolveRoot(root);
}


function directory(root) {
    return path.join(rootOf(root), DIRECTORY);
}


function transcriptPath(id, root) {
    return path.join(directory(root), `${safeId(id)}.json`);
}


function emptyDocument(id) {
    return {
        version: VERSION,
        id,
        project_id: null,
        task: "",
        personas: [],
        max_rounds: 5,
        status: "running",
        started_at: null,
        finished_at: null,
        rounds: [],
        observer_decisions: [],
        final_report: null,
        total_rounds: 0,
        hit_max_rounds: false,
        stopped_reason: null,
        error: null,
        updated_at: null
    };
}


function normalise(document, id) {
    const base = emptyDocument(id || document?.id || "discussion");
    const value = {
        ...base,
        ...(document && typeof document === "object" ? document : {})
    };

    value.id = id || value.id;
    value.personas = Array.isArray(value.personas) ? value.personas : [];
    value.rounds = Array.isArray(value.rounds) ? value.rounds : [];
    value.observer_decisions = Array.isArray(value.observer_decisions)
        ? value.observer_decisions
        : [];

    return value;
}


class TranscriptRepository {

    constructor({ rootResolver = rootOf, now = () => new Date().toISOString() } = {}) {
        this.rootResolver = rootResolver;
        this.now = now;
    }


    root(root) {
        return this.rootResolver(root);
    }


    directory(root) {
        return path.join(this.root(root), DIRECTORY);
    }


    pathFor(id, root) {
        return path.join(this.directory(root), `${safeId(id)}.json`);
    }


    save(document, root) {
        const value = normalise(document, document?.id);
        value.updated_at = this.now();
        fs.mkdirSync(this.directory(root), { recursive: true });
        JsonRepository.writeJson(this.pathFor(value.id, root), value);
        return value;
    }


    load(id, root) {
        const file = this.pathFor(id, root);
        const parsed = JsonRepository.readJson(file, null);

        if (!parsed || typeof parsed !== "object") {
            return null;
        }

        try {
            SchemaVersion.migrate("discussion", parsed);
        } catch {
            /* Unknown/future versions remain readable as plain documents. */
        }

        return normalise(parsed, id);
    }


    list(root) {
        const directoryPath = this.directory(root);

        if (!fs.existsSync(directoryPath)) {
            return [];
        }

        return fs.readdirSync(directoryPath)
            .filter(name => name.endsWith(".json"))
            .map(name => this.load(name.slice(0, -5), root))
            .filter(Boolean)
            .map(item => ({
                id: item.id,
                project_id: item.project_id || null,
                task: item.task,
                personas: item.personas,
                status: item.status,
                started_at: item.started_at,
                finished_at: item.finished_at,
                updated_at: item.updated_at,
                total_rounds: item.total_rounds,
                hit_max_rounds: item.hit_max_rounds
            }))
            .sort((left, right) =>
                String(right.updated_at || right.started_at || "")
                    .localeCompare(String(left.updated_at || left.started_at || ""))
            );
    }


    remove(id, root) {
        try {
            fs.unlinkSync(this.pathFor(id, root));
            return true;
        } catch {
            return false;
        }
    }


    replay(id, root) {
        return this.load(id, root);
    }
}


const transcriptRepository = new TranscriptRepository();


module.exports = {
    VERSION,
    DIRECTORY,
    TranscriptRepository,
    transcriptRepository,
    rootOf,
    directory,
    transcriptPath,
    emptyDocument,
    normalise
};
