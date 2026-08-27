/*
|--------------------------------------------------------------------------\
| Policy engine (moved)
|--------------------------------------------------------------------------\
|
| Phase 21 split this file: matching, the rule document, the approval
| lifecycle and the audit/pending state now live in agent/policy, one
| concern per module, because a security boundary that sits in a single
| 746-line file cannot be reviewed in pieces.
|
| This module stays because `agent/agent.js`, the console and several tests
| import it by path, and moving a file is not a reason to break them
| (rule 7 — legacy wrappers are removed only in phase 30). It re-exports the
| new modules rather than wrapping each symbol, so there is exactly one copy
| of the mutable state: the approval mode, the injected handler and the
| gateway-level approval cache are shared by every importer, as they were
| when all of this lived here.
|--------------------------------------------------------------------------*/

module.exports = require("../policy");
