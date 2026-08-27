/*
|--------------------------------------------------------------------------\
| Declarative runtime hooks (moved)
|--------------------------------------------------------------------------\
|
| Phase 22 split this file: loading and validation, the condition language,
| the template language, the runner and the result shape now live one concern
| per module under agent/hooks.
|
| The module stays because agent.js, the plan tool and the hook tests import
| it by path, and moving a file is not a reason to break them (rule 7 —
| wrappers are removed only in phase 30). It re-exports the registry rather
| than wrapping each function, so `load()`'s cache and the file stamps are
| shared with whoever else loads hooks, instead of two caches disagreeing
| about whether hooks.json changed.
|--------------------------------------------------------------------------*/

module.exports = require("../hooks/HookRegistry");
