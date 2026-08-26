"use strict";

const ToolContext = require("../ToolContext");
const resolver = require("../../mcp/ProjectSemanticResolver");
const settings = require("../../lib/storage");


/*
|--------------------------------------------------------------------------
| Semantic Code Tools
|--------------------------------------------------------------------------
|
| Tools for semantic code understanding: symbol lookup, graph navigation,
| dependency extraction, impact analysis, context assembly.
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


function unavailableResult(toolName, engine) {

    const staleness = engine.checkStaleness();

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


/* The engine a tool talks to is chosen by the run's context, not by the
   process: in SEMANTIC_POOL_MODE=modular a scoped ToolContext routes to
   that project's pool client; every other case keeps the historical
   process-wide client (bit-identical legacy behaviour). ToolContext.from
   is an identity no-op on the normalized context executeTool hands in. */
function engineFor(context) {

    const ctx = ToolContext.from(context);

    return {
        ctx,
        engine: resolver.semanticFor(ctx)
    };
}


async function ensureEngine(toolName, engine) {

    if (!engine.isAvailable()) {
        return { ok: false, result: unavailableResult(toolName, engine) };
    }

    return { ok: true };
}


/*
|--------------------------------------------------------------------------
| Index Query Tools
|--------------------------------------------------------------------------
*/

async function codeFindSymbol(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_find_symbol", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await engine.call("find_symbol", {
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


async function codeSearch(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_search", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await engine.call("semantic_search", {
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


async function codeFileSummary(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_file_summary", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();

    try {
        const raw = await engine.call("get_file_summary", {
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


async function codeDependencies(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_dependencies", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await engine.call("get_dependencies", {
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


async function codeImpact(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_impact", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();
    const limit = maxItems(args.limit);

    try {
        const raw = await engine.call("impact_analysis", {
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


async function codeFindTests(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_find_tests", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();

    try {
        const raw = await engine.call("find_tests", {
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


async function codeConfigUsage(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_config_usage", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();

    try {
        const raw = await engine.call("get_config_usage", {
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


async function codeContext(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_context", engine);
    if (!check.ok) return check.result;

    const staleness = engine.checkStaleness();

    try {
        const raw = await engine.call("assemble_context", {
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
| V2 Reasoning & Analysis Tools
|--------------------------------------------------------------------------
*/

async function codeSimulateMutation(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_simulate_mutation", engine);
    if (!check.ok) return check.result;

    try {
        const raw = await engine.call("simulate_mutation", {
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


async function codeArchitectureViolations(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_architecture_violations", engine);
    if (!check.ok) return check.result;

    try {
        const raw = await engine.call("detect_architecture_violations", {});
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


async function codeGitHotspots(args = {}, context) {

    const { ctx, engine } = engineFor(context);

    const check = await ensureEngine("code_git_hotspots", engine);
    if (!check.ok) return check.result;

    try {
        const raw = await engine.call("get_git_hotspots", {
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


module.exports = {
    code_find_symbol: codeFindSymbol,
    code_search: codeSearch,
    code_file_summary: codeFileSummary,
    code_dependencies: codeDependencies,
    code_impact: codeImpact,
    code_find_tests: codeFindTests,
    code_config_usage: codeConfigUsage,
    code_context: codeContext,
    code_simulate_mutation: codeSimulateMutation,
    code_architecture_violations: codeArchitectureViolations,
    code_git_hotspots: codeGitHotspots,
    _engineFor: engineFor,
    _ensureEngine: ensureEngine,
    _maxItems: maxItems,
    _truncate: truncate
};
