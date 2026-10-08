"use strict";

const fs = require("fs");

const SemanticTools = require("./SemanticTools");


/*
|--------------------------------------------------------------------------
| Live LSP Tools
|--------------------------------------------------------------------------
*/

/*
| Resolve an LSP {start:{line,character},end:{line,character}} range to a
| [start,end) byte span over `lines` (the current split content). Returns null
| if the range is out of bounds so the caller can fall back or skip honestly
| rather than slice at a wrong offset. 0-based line/character per the LSP spec.
*/
function rangeToSpan(lines, range) {
    const sl = range.start.line, sc = range.start.character;
    const el = range.end.line, ec = range.end.character;
    if (sl < 0 || el >= lines.length || sl > el) return null;
    if (sc < 0 || ec < 0) return null;
    if (sl === el && sc > ec) return null;
    if (lines[sl].length < sc) return null;
    if (lines[el].length < ec) return null;

    let start = sc;
    for (let i = 0; i < sl; i++) start += lines[i].length + 1;

    let end = ec;
    for (let i = 0; i < el; i++) end += lines[i].length + 1;

    if (start > end) return null;
    return { start, end };
}

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

        /*
        | SA-F-004 — apply every edit at ITS OWN designated location, never by
        | a blind first-occurrence `String.replace(oldText, …)`. The old code
        | replaced the FIRST textual match, so a repeated identifier
        | (`AuthService` appearing twice) was renamed at the wrong site while
        | the intended one stayed put — and it still reported `applied: true`
        | even when `oldText` matched nothing and no edit was actually written.
        | An AI consuming `applied: true` would then trust a rename that either
        | corrupted the wrong occurrence or did nothing (§15/§16).
        |
        | Order of application per file is by descending position so earlier
        | byte offsets stay valid while later ones shift. An edit is honoured
        | as:
        |   - an LSP `range` ({start:{line,character},end:{line,character}}),
        |     resolved to a byte span over the current content; or
        |   - a `line` (1-based, matching the engine/mock shape) with `oldText`
        |     — the FIRST `oldText` occurrence ON THAT LINE is the target.
        | If neither can be located, the edit is skipped, counted, and declared
        | — never silently dropped and never reported as applied.
        */
        let editsApplied = 0;
        let editsSkipped = 0;
        const fileResults = [];

        if (!dryRun) {
            for (const [filePath, fileEdits] of Object.entries(changes)) {
                const fullPath = ctx.resolvePath(filePath);
                if (!fs.existsSync(fullPath)) {
                    const list = Array.isArray(fileEdits) ? fileEdits : [fileEdits];
                    fileResults.push({ path: filePath, applied: 0, skipped: list.length, missing_file: true });
                    editsSkipped += list.length;
                    continue;
                }

                let content = fs.readFileSync(fullPath, "utf8");
                const lines = content.split("\n");
                const list = Array.isArray(fileEdits) ? fileEdits : [fileEdits];

                /* Attach a sort key (start line) and apply from bottom up. */
                const positioned = list.map(edit => ({
                    edit,
                    startLine: edit.range
                        ? edit.range.start.line
                        : (typeof edit.line === "number" ? edit.line : 0)
                })).sort((a, b) => b.startLine - a.startLine);

                let appliedHere = 0;
                let skippedHere = 0;

                for (const { edit } of positioned) {
                    if (edit.newText === undefined) { skippedHere++; continue; }

                    if (edit.range && edit.range.start && edit.range.end) {
                        const span = rangeToSpan(lines, edit.range);
                        if (span) {
                            content = content.slice(0, span.start) + edit.newText + content.slice(span.end);
                            lines.length = 0;
                            Array.prototype.push.apply(lines, content.split("\n"));
                            appliedHere++;
                            continue;
                        }
                        skippedHere++;
                        continue;
                    }

                    if (typeof edit.line === "number" && edit.line >= 1 && edit.line <= lines.length && edit.oldText !== undefined) {
                        const idx = lines[edit.line - 1].indexOf(edit.oldText);
                        if (idx !== -1) {
                            const col = lines[edit.line - 1].slice(0, idx).length;
                            lines[edit.line - 1] = lines[edit.line - 1].slice(0, col)
                                + edit.newText
                                + lines[edit.line - 1].slice(col + edit.oldText.length);
                            content = lines.join("\n");
                            appliedHere++;
                            continue;
                        }
                    }

                    /*
                    | Fallback when the designated line/range is stale or absent:
                    | honour the edit ONLY if `oldText` is unambiguous across the
                    | whole file (exactly one occurrence). A repeated identifier is
                    | refused rather than renamed at an arbitrary first match — the
                    | very defect SA-F-004 was about. Zero or many occurrences:
                    | skip + declare, never guess.
                    */
                    if (edit.oldText !== undefined) {
                        const first = content.indexOf(edit.oldText);
                        if (first !== -1 && content.indexOf(edit.oldText, first + edit.oldText.length) === -1) {
                            content = content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length);
                            lines.length = 0;
                            Array.prototype.push.apply(lines, content.split("\n"));
                            appliedHere++;
                            continue;
                        }
                    }

                    /* No range, no line, ambiguous or absent oldText: the
                       designated location cannot be honoured safely. Skip. */
                    skippedHere++;
                }

                fs.writeFileSync(fullPath, content, "utf8");
                editsApplied += appliedHere;
                editsSkipped += skippedHere;
                fileResults.push({ path: filePath, applied: appliedHere, skipped: skippedHere });
            }
        }

        return {
            symbol: args.symbol || null,
            new_name: args.new_name,
            dry_run: dryRun,
            /*
            | `applied` is now earned, not asserted: it is true only when the
            | run was an apply-mode run that actually wrote at least one edit.
            | `edits_applied` / `edits_skipped` let a consuming AI see a partial
            | or zero-effect rename instead of trusting a bare boolean.
            */
            applied: !dryRun && editsApplied > 0,
            edits_applied: dryRun ? null : editsApplied,
            edits_skipped: dryRun ? null : editsSkipped,
            files_affected: dryRun ? changedFiles.length : fileResults.length,
            changes: (dryRun ? changedFiles : fileResults.map(r => r.path)).slice(0, 20).map(file => ({
                path: file,
                edit_count: Array.isArray(changes[file]) ? changes[file].length : 1,
                ...(dryRun ? {} : {
                    applied: (fileResults.find(r => r.path === file) || {}).applied,
                    skipped: (fileResults.find(r => r.path === file) || {}).skipped
                })
            })),
            ...(dryRun || editsSkipped === 0 ? {} : {
                note: `${editsSkipped} edit(s) could not be applied at their designated location and were skipped (not guessed elsewhere).`
            })
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
