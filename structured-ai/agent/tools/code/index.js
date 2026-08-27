"use strict";

/*
|--------------------------------------------------------------------------
| Code group — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| SemanticClient is shared with Phase 6 (agent/mcp/SemanticClient.js).
|--------------------------------------------------------------------------
*/

const SemanticTools = require("./SemanticTools");
const LiveLspTools = require("./LiveLspTools");
const IndexSessions = require("./IndexSessions");

module.exports = {
    code_find_symbol: SemanticTools.code_find_symbol,
    code_search: SemanticTools.code_search,
    code_file_summary: SemanticTools.code_file_summary,
    code_dependencies: SemanticTools.code_dependencies,
    code_impact: SemanticTools.code_impact,
    code_find_tests: SemanticTools.code_find_tests,
    code_config_usage: SemanticTools.code_config_usage,
    code_context: SemanticTools.code_context,
    code_index_status: IndexSessions.code_index_status,
    code_index_start: IndexSessions.code_index_start,
    code_index_get: IndexSessions.code_index_get,
    code_diagnostics: LiveLspTools.code_diagnostics,
    code_callers: LiveLspTools.code_callers,
    code_definition: LiveLspTools.code_definition,
    code_organize_imports: LiveLspTools.code_organize_imports,
    code_rename: LiveLspTools.code_rename,
    code_simulate_mutation: SemanticTools.code_simulate_mutation,
    code_architecture_violations: SemanticTools.code_architecture_violations,
    code_git_hotspots: SemanticTools.code_git_hotspots,
    _shutdown: IndexSessions._shutdown,
    _startRunScope: IndexSessions._startRunScope
};
