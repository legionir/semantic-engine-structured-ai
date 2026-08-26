"use strict";

const settings = require("../../config");
const { observability } = require("../../runtime/Observability");
const resolver = require("../../mcp/ProjectSemanticResolver");

const SemanticTools = require("./SemanticTools");


/*
|--------------------------------------------------------------------------
| Lifecycle & Index Management Tools
|--------------------------------------------------------------------------
*/

async function codeIndexStatus(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const staleness = engine.checkStaleness();
    const available = engine.isAvailable();

    return {
        available,
        state: staleness.state,
        age_seconds: staleness.age_seconds,
        file_count: staleness.file_count,
        symbol_count: staleness.symbol_count,
        index_path: staleness.path,
        mode: settings.get("SEMANTIC_INDEX_MODE")
    };
}


async function codeIndexStart(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const check = await SemanticTools._ensureEngine("code_index_start", engine);
    if (!check.ok) return check.result;

    if (!observability.beginIndex()) {

        return {
            ok: false,
            error: "INDEX_LIMIT",
            message:
                `Too many concurrent index runs ` +
                `(MAX_CONCURRENT_INDEX_RUNS=${settings.get("MAX_CONCURRENT_INDEX_RUNS")}).`
        };
    }

    const sessionId = "idx-" + Math.random().toString(36).slice(2, 9);

    engine.startIndexSession(sessionId, {
        id: sessionId,
        started_at: Date.now(),
        status: "running",
        incremental: Boolean(args.incremental)
    });

    /* Fire indexing in background */
    (async () => {
        try {
            const res = await engine.call("index_workspace", {
                incremental: Boolean(args.incremental)
            }, { timeoutMs: settings.get("SEMANTIC_INDEX_TIMEOUT_MS") || 600000 });

            engine.startIndexSession(sessionId, {
                id: sessionId,
                started_at: Date.now(),
                status: "completed",
                result: res
            });
        } catch (err) {
            engine.startIndexSession(sessionId, {
                id: sessionId,
                started_at: Date.now(),
                status: "failed",
                error: err.message
            });
        } finally {
            observability.endIndex();
        }
    })();

    return {
        session_id: sessionId,
        status: "started",
        incremental: Boolean(args.incremental)
    };
}


async function codeIndexGet(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    if (!args.session_id) {
        throw new Error("code_index_get requires a session_id argument.");
    }

    const session = engine.getIndexSession(args.session_id);

    if (!session) {
        return {
            session_id: args.session_id,
            status: "unknown",
            hint: "Session not found or expired."
        };
    }

    return {
        session_id: session.id,
        status: session.status,
        duration_ms: Date.now() - session.started_at,
        error: session.error || null,
        result: session.result || null
    };
}


function shutdown() {

    resolver.shutdown();
}


function startRunScope(runId) {

    return resolver.startRunScope(runId);
}


module.exports = {
    code_index_status: codeIndexStatus,
    code_index_start: codeIndexStart,
    code_index_get: codeIndexGet,
    _shutdown: shutdown,
    _startRunScope: startRunScope
};
