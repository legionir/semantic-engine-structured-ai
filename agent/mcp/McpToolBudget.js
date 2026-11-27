"use strict";

/*
|--------------------------------------------------------------------------
| MCP tool definitions within a budget (roadmap P4-06)
|--------------------------------------------------------------------------
|
| Ten servers can declare hundreds of tools whose schemas would fill the
| request before the task is read. select() splits the catalogue into
|
|   declared   full definitions sent with the request, never more than
|              MCP_TOOL_DEFINITIONS_BUDGET characters of JSON in total
|   deferred   every other tool, as a name and one line, listed in the
|              runtime context; mcp_search_tools loads a definition into
|              the conversation and mcp_call runs it
|
| by MCP_TOOL_LOADING: eager fills the budget in catalogue order, lazy
| declares nothing, auto declares everything while it fits and nothing
| once it does not (half a catalogue is harder to reason about than an
| index of all of it).
|--------------------------------------------------------------------------
*/

const oneLineChars = () => require("../config").get("MCP_DEFERRED_LINE_CHARS");


function size(declaration) {

    return JSON.stringify(declaration).length;
}


function oneLine(text) {

    const first = String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] || "";

    const limit = oneLineChars();

    return first.length > limit ? `${first.slice(0, limit - 1)}…` : first;
}


function brief(declaration) {

    return {
        name: declaration.function.name,
        description: oneLine(declaration.function.description)
    };
}


function select(declarations, { mode = "auto", budget = 24000 } = {}) {

    const list = Array.isArray(declarations) ? declarations : [];

    if (mode === "lazy") {
        return { mode, budget, declared: [], deferred: list.map(brief), declared_chars: 0 };
    }

    const total = list.reduce((sum, item) => sum + size(item), 0);

    if (mode === "auto" && total > budget) {
        return { mode: "lazy", requested: "auto", budget, declared: [], deferred: list.map(brief), declared_chars: 0, total_chars: total };
    }

    const declared = [];
    const deferred = [];
    let used = 0;

    for (const item of list) {

        const cost = size(item);

        if (used + cost <= budget) {
            declared.push(item);
            used += cost;
        } else {
            deferred.push(brief(item));
        }
    }

    return { mode: mode === "auto" ? "eager" : mode, requested: mode, budget, declared, deferred, declared_chars: used, total_chars: total };
}


function words(text) {

    return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1);
}


/*
| Ranks catalogue entries for mcp_search_tools: an exact name wins, then
| every query word found in the name (twice the weight) or description.
*/
function search(entries, { query = "", names = null, server = null, limit = 5 } = {}) {

    const pool = (entries || []).filter(entry => !server || entry.server === server);

    if (Array.isArray(names) && names.length > 0) {
        const wanted = new Set(names.map(String));
        return pool.filter(entry => wanted.has(entry.name) || wanted.has(entry.tool)).slice(0, Math.max(limit, names.length));
    }

    const terms = words(query);
    const exact = String(query || "").trim();

    if (terms.length === 0 && !exact) {
        return pool.slice(0, limit);
    }

    return pool
        .map(entry => {
            if (entry.name === exact || entry.tool === exact) return { entry, score: 1000 };
            const name = words(`${entry.server} ${entry.tool}`);
            const description = words(entry.description);
            let score = 0;
            for (const term of terms) {
                if (name.some(word => word === term)) score += 4;
                else if (name.some(word => word.includes(term))) score += 2;
                if (description.includes(term)) score += 1;
            }
            return { entry, score };
        })
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
        .slice(0, limit)
        .map(item => item.entry);
}


module.exports = { size, oneLine, brief, select, search };
