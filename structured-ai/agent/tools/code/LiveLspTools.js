"use strict";

const fs = require("fs");

const SemanticTools = require("./SemanticTools");


/*
|--------------------------------------------------------------------------
| Live LSP Tools
|--------------------------------------------------------------------------
*/

async function codeDiagnostics(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const check = await SemanticTools._ensureEngine("code_diagnostics", engine);
    if (!check.ok) return check.result;

    const limit = SemanticTools._maxItems(args.limit);

    try {
        const raw = await engine.call("diagnostics", {
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
                message: SemanticTools._truncate(d.message || "", 200),
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


async function codeCallers(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const check = await SemanticTools._ensureEngine("code_callers", engine);
    if (!check.ok) return check.result;

    const limit = SemanticTools._maxItems(args.limit);

    try {
        const raw = await engine.call("incoming_calls", {
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


async function codeDefinition(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const check = await SemanticTools._ensureEngine("code_definition", engine);
    if (!check.ok) return check.result;

    try {
        const raw = await engine.call("definition", {
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
            preview: SemanticTools._truncate(raw.preview || raw.excerpt || "", 200)
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            live: true
        };
    }
}


async function codeOrganizeImports(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const check = await SemanticTools._ensureEngine("code_organize_imports", engine);
    if (!check.ok) return check.result;

    try {
        const raw = await engine.call("organize_imports", {
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


async function codeRename(args = {}, context) {

    const { ctx, engine } = SemanticTools._engineFor(context);

    const check = await SemanticTools._ensureEngine("code_rename", engine);
    if (!check.ok) return check.result;

    const dryRun = args.dry_run !== false && !args.apply;

    try {
        const raw = await engine.call("rename", {
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
                const fullPath = ctx.resolvePath(filePath);
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


module.exports = {
    code_diagnostics: codeDiagnostics,
    code_callers: codeCallers,
    code_definition: codeDefinition,
    code_organize_imports: codeOrganizeImports,
    code_rename: codeRename
};
