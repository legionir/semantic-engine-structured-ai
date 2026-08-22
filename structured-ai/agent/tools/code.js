const fs = require("fs");
const path = require("path");

const semantic = require("../lib/semantic");
const settings = require("../lib/storage");
const { WORKSPACE_ROOT, resolveWorkspacePath } = require("../lib/workspace");


/*
|--------------------------------------------------------------------------
| Semantic Code Tools
|--------------------------------------------------------------------------
|
| Tools for semantic code understanding: symbol lookup, graph navigation,
| dependency extraction, impact analysis, context assembly, and live LSP
| operations (diagnostics, callers, rename, organize imports).
|
| All tools enforce bounded output (max 50 items, max 200 chars per excerpt)
| to protect the model's token budget.
|--------------------------------------------------------------------------
*/

function maxItems(requested) {

    const limitSetting = settings.get("SEMANTIC_MAX_ITEMS") || 50;

    if (!requested || requested <= 0) {
        return limitSetting;
    }

    return Math.min(requested, limitSetting);
}


function truncate(text, maxChars) {

    const limit = maxChars || settings.get("SEMANTIC_EXCERPT_CHARS") || 200;

    if (!text || typeof text !== "string") {
        return text || "";
    }

    if (text.length <= limit) {
        return text;
    }

    return text.slice(0, limit) + "…";
}


function unavailableResult(toolName) {

    const staleness = semantic.checkStaleness();

    return {
        ok: false,
        tool: toolName,
        index_state: staleness.state,
        hint:
            "Semantic engine is not available or disabled. " +
            "Run 'npx @aicoder/semantic-engine index' or configure SEMANTIC_ENGINE_BIN to enable semantic code tools. " +
            "In the meantime, you can use search_start or fs_read."
    };
}


async function ensureEngine(toolName) {

    if (!semantic.isAvailable()) {
        return { ok: false, result: unavailableResult(toolName) };
    }

    return { ok: true };
}


/*
|--------------------------------------------------------------------------
| Index Query Tools
|--------------------------------------------------------------------------
*/

async function codeFindSymbol(args = {}) {

    const check = await ensureEngine("code_find_symbol");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await semantic.call("find_symbol", {
            name: args.name || "",
            kind: args.kind,
            limit
        });

        const items = (raw && raw.items) || [];
        const total = raw && typeof raw.total === "number" ? raw.total : items.length;

        return {
            query: args.name || "",
            kind: args.kind || null,
            total,
            returned: items.length,
            index_state: staleness.state,
            symbols: items.slice(0, limit).map(item => ({
                name: item.name,
                kind: item.kind,
                path: item.path,
                line: item.line,
                end_line: item.endLine || item.end_line,
                signature: truncate(item.signature || item.excerpt || item.name)
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeSearch(args = {}) {

    const check = await ensureEngine("code_search");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await semantic.call("semantic_search", {
            query: args.query || "",
            limit,
            mode: args.mode || "hybrid"
        });

        const items = (raw && raw.items) || [];
        const total = raw && typeof raw.total === "number" ? raw.total : items.length;

        return {
            query: args.query || "",
            total,
            returned: items.length,
            index_state: staleness.state,
            results: items.slice(0, limit).map(item => ({
                name: item.name,
                path: item.path,
                score: typeof item.score === "number" ? Math.round(item.score * 100) / 100 : undefined,
                kind: item.kind,
                excerpt: truncate(item.excerpt || item.content || "")
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeFileSummary(args = {}) {

    const check = await ensureEngine("code_file_summary");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();

    try {
        const raw = await semantic.call("get_file_summary", {
            path: args.path || ""
        });

        return {
            path: args.path,
            index_state: staleness.state,
            role: raw.role || "unknown",
            language: raw.language,
            symbols_count: raw.symbolsCount || (raw.symbols ? raw.symbols.length : 0),
            imports: (raw.imports || []).slice(0, 20),
            exports: (raw.exports || []).slice(0, 20),
            summary: truncate(raw.summary || "", 500)
        };
    } catch (error) {
        return {
            ok: false,
            path: args.path,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeDependencies(args = {}) {

    const check = await ensureEngine("code_dependencies");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await semantic.call("get_dependencies", {
            path: args.path || "",
            depth: args.depth || 1,
            direction: args.direction || "both"
        });

        const dependencies = raw.dependencies || raw.edges || [];

        return {
            path: args.path,
            direction: args.direction || "both",
            total: dependencies.length,
            returned: Math.min(dependencies.length, limit),
            index_state: staleness.state,
            dependencies: dependencies.slice(0, limit).map(dep => ({
                from: dep.from,
                to: dep.to,
                kind: dep.kind || "import",
                confidence: dep.confidence
            }))
        };
    } catch (error) {
        return {
            ok: false,
            path: args.path,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeImpact(args = {}) {

    const check = await ensureEngine("code_impact");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await semantic.call("impact_analysis", {
            symbol: args.symbol,
            path: args.path,
            maxDepth: args.max_depth || 3
        });

        const items = raw.impacted || raw.items || [];

        return {
            symbol: args.symbol || null,
            path: args.path || null,
            total: items.length,
            returned: Math.min(items.length, limit),
            index_state: staleness.state,
            impacted: items.slice(0, limit).map(item => ({
                name: item.name,
                path: item.path,
                relation: item.relation || "caller",
                hops: item.hops || item.depth
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeFindTests(args = {}) {

    const check = await ensureEngine("code_find_tests");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();

    try {
        const raw = await semantic.call("find_tests", {
            path: args.path,
            symbol: args.symbol
        });

        const tests = raw.tests || raw.items || [];

        return {
            path: args.path || null,
            symbol: args.symbol || null,
            total: tests.length,
            index_state: staleness.state,
            tests: tests.slice(0, 30).map(t => ({
                test_file: t.testFile || t.file || t.path,
                test_name: t.testName || t.name,
                line: t.line
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeConfigUsage(args = {}) {

    const check = await ensureEngine("code_config_usage");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();

    try {
        const raw = await semantic.call("get_config_usage", {
            key: args.key,
            path: args.path
        });

        const usages = raw.usages || raw.items || [];

        return {
            key: args.key || null,
            total: usages.length,
            index_state: staleness.state,
            usages: usages.slice(0, 30).map(u => ({
                key: u.key,
                path: u.path,
                line: u.line,
                context: truncate(u.context || "", 150)
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            index_state: staleness.state
        };
    }
}


async function codeContext(args = {}) {

    const check = await ensureEngine("code_context");
    if (!check.ok) return check.result;

    const staleness = semantic.checkStaleness();

    try {
        const raw = await semantic.call("assemble_context", {
            task: args.task || "",
            files: args.files || [],
            maxTokens: args.max_tokens || 2000
        });

        return {
            task: args.task || "",
            index_state: staleness.state,
            token_estimate: raw.tokenEstimate || raw.tokens,
            summary: raw.summary || null,
            files: (raw.files || []).slice(0, 15).map(f => ({
                path: f.path,
                role: f.role,
                key_symbols: (f.symbols || []).slice(0, 10).map(s => s.name || s)
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            index_state: staleness.state
        };
    }
}


/*
|--------------------------------------------------------------------------
| Lifecycle & Index Management Tools
|--------------------------------------------------------------------------
*/

async function codeIndexStatus() {

    const staleness = semantic.checkStaleness();
    const available = semantic.isAvailable();

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


async function codeIndexStart(args = {}) {

    const check = await ensureEngine("code_index_start");
    if (!check.ok) return check.result;

    const sessionId = "idx-" + Math.random().toString(36).slice(2, 9);

    semantic.startIndexSession(sessionId, {
        id: sessionId,
        started_at: Date.now(),
        status: "running",
        incremental: Boolean(args.incremental)
    });

    /* Fire indexing in background */
    (async () => {
        try {
            const res = await semantic.call("index_workspace", {
                incremental: Boolean(args.incremental)
            }, { timeoutMs: settings.get("SEMANTIC_INDEX_TIMEOUT_MS") || 600000 });

            semantic.startIndexSession(sessionId, {
                id: sessionId,
                started_at: Date.now(),
                status: "completed",
                result: res
            });
        } catch (err) {
            semantic.startIndexSession(sessionId, {
                id: sessionId,
                started_at: Date.now(),
                status: "failed",
                error: err.message
            });
        }
    })();

    return {
        session_id: sessionId,
        status: "started",
        incremental: Boolean(args.incremental)
    };
}


async function codeIndexGet(args = {}) {

    if (!args.session_id) {
        throw new Error("code_index_get requires a session_id argument.");
    }

    const session = semantic.getIndexSession(args.session_id);

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


/*
|--------------------------------------------------------------------------
| Live LSP Tools
|--------------------------------------------------------------------------
*/

async function codeDiagnostics(args = {}) {

    const check = await ensureEngine("code_diagnostics");
    if (!check.ok) return check.result;

    const limit = maxItems(args.limit);

    try {
        const raw = await semantic.call("diagnostics", {
            paths: args.paths || (args.path ? [args.path] : [])
        });

        const diagnostics = raw.diagnostics || raw.items || [];

        return {
            paths: args.paths || (args.path ? [args.path] : []),
            total: diagnostics.length,
            returned: Math.min(diagnostics.length, limit),
            live: true,
            diagnostics: diagnostics.slice(0, limit).map(d => ({
                path: d.path || d.file,
                line: d.line,
                character: d.character || d.col,
                severity: d.severity || "error",
                message: truncate(d.message || "", 200),
                code: d.code
            }))
        };
    } catch (error) {
        return {
            ok: false,
            live: true,
            error: error.message,
            diagnostics: []
        };
    }
}


async function codeCallers(args = {}) {

    const check = await ensureEngine("code_callers");
    if (!check.ok) return check.result;

    const limit = maxItems(args.limit);

    try {
        const raw = await semantic.call("incoming_calls", {
            symbol: args.symbol,
            path: args.path,
            line: args.line,
            character: args.character
        });

        const callers = raw.callers || raw.items || [];

        return {
            symbol: args.symbol || null,
            path: args.path || null,
            total: callers.length,
            returned: Math.min(callers.length, limit),
            live: true,
            callers: callers.slice(0, limit).map(c => ({
                from_symbol: c.fromSymbol || c.symbol || c.name,
                path: c.path || c.file,
                line: c.line,
                call_sites: c.callSites || []
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            live: true
        };
    }
}


async function codeDefinition(args = {}) {

    const check = await ensureEngine("code_definition");
    if (!check.ok) return check.result;

    try {
        const raw = await semantic.call("definition", {
            symbol: args.symbol,
            path: args.path,
            line: args.line,
            character: args.character
        });

        return {
            symbol: args.symbol || null,
            live: true,
            path: raw.path || raw.file,
            line: raw.line,
            character: raw.character || raw.col,
            preview: truncate(raw.preview || raw.excerpt || "", 200)
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            live: true
        };
    }
}


async function codeOrganizeImports(args = {}) {

    const check = await ensureEngine("code_organize_imports");
    if (!check.ok) return check.result;

    try {
        const raw = await semantic.call("organize_imports", {
            path: args.path
        });

        return {
            path: args.path,
            live: true,
            edits_count: (raw.edits || []).length,
            edits: raw.edits || []
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            live: true
        };
    }
}


async function codeRename(args = {}) {

    const check = await ensureEngine("code_rename");
    if (!check.ok) return check.result;

    const dryRun = args.dry_run !== false && !args.apply;

    try {
        const raw = await semantic.call("rename", {
            path: args.path,
            line: args.line,
            character: args.character,
            newName: args.new_name
        });

        const changes = raw.changes || raw.workspaceEdit || {};
        const changedFiles = Object.keys(changes);

        if (!dryRun) {
            /* Apply edits to disk within workspace boundary */
            for (const [filePath, fileEdits] of Object.entries(changes)) {
                const fullPath = resolveWorkspacePath(filePath);
                if (fs.existsSync(fullPath)) {
                    let content = fs.readFileSync(fullPath, "utf8");
                    /* Apply sorted in reverse line order */
                    const sortedEdits = [...fileEdits].sort((a, b) => {
                        const lineA = a.range ? a.range.start.line : a.line || 0;
                        const lineB = b.range ? b.range.start.line : b.line || 0;
                        return lineB - lineA;
                    });

                    for (const edit of sortedEdits) {
                        if (edit.newText !== undefined && edit.oldText !== undefined) {
                            content = content.replace(edit.oldText, edit.newText);
                        }
                    }
                    fs.writeFileSync(fullPath, content, "utf8");
                }
            }
        }

        return {
            symbol: args.symbol || null,
            new_name: args.new_name,
            dry_run: dryRun,
            applied: !dryRun,
            files_affected: changedFiles.length,
            changes: changedFiles.slice(0, 20).map(file => ({
                path: file,
                edit_count: Array.isArray(changes[file]) ? changes[file].length : 1
            }))
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            dry_run: dryRun,
            applied: false
        };
    }
}


/*
|--------------------------------------------------------------------------
| V2 Reasoning & Analysis Tools
|--------------------------------------------------------------------------
*/

async function codeSimulateMutation(args = {}) {

    const check = await ensureEngine("code_simulate_mutation");
    if (!check.ok) return check.result;

    try {
        const raw = await semantic.call("simulate_mutation", {
            actionType: args.action_type || args.actionType || "delete_symbol",
            targetSymbolId: args.target_symbol_id || args.targetSymbolId,
            newName: args.new_name || args.newName
        });

        return {
            ok: true,
            summary: raw.context || raw.summary,
            broken_references: raw.items || []
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}


async function codeArchitectureViolations(args = {}) {

    const check = await ensureEngine("code_architecture_violations");
    if (!check.ok) return check.result;

    try {
        const raw = await semantic.call("detect_architecture_violations", {});
        return {
            ok: true,
            summary: raw.context || raw.summary,
            violations: raw.items || []
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}


async function codeGitHotspots(args = {}) {

    const check = await ensureEngine("code_git_hotspots");
    if (!check.ok) return check.result;

    try {
        const raw = await semantic.call("get_git_hotspots", {
            limit: args.limit || 10
        });

        return {
            ok: true,
            summary: raw.context || raw.summary,
            hotspots: raw.items || []
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}


function shutdown() {

    semantic.shutdown();
}


function startRunScope() {

    return semantic.startRunScope();
}


module.exports = {
    code_find_symbol: codeFindSymbol,
    code_search: codeSearch,
    code_file_summary: codeFileSummary,
    code_dependencies: codeDependencies,
    code_impact: codeImpact,
    code_find_tests: codeFindTests,
    code_config_usage: codeConfigUsage,
    code_context: codeContext,
    code_index_status: codeIndexStatus,
    code_index_start: codeIndexStart,
    code_index_get: codeIndexGet,
    code_diagnostics: codeDiagnostics,
    code_callers: codeCallers,
    code_definition: codeDefinition,
    code_organize_imports: codeOrganizeImports,
    code_rename: codeRename,
    code_simulate_mutation: codeSimulateMutation,
    code_architecture_violations: codeArchitectureViolations,
    code_git_hotspots: codeGitHotspots,
    _shutdown: shutdown,
    _startRunScope: startRunScope
};
