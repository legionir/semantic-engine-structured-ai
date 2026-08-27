/*
|--------------------------------------------------------------------------\
| Hook registry
|--------------------------------------------------------------------------\
|
| The read-side facade the runtime talks to: which hooks are enabled for a
| phase, what the settings screen should show, and the same `render` /
| `evaluateWhen` the runner uses — so `hookRegistry.render(...)` from the agent
| loop and the runner's own call cannot resolve to two implementations.
|
| `agent/lib/hooks.js` re-exports this with its historical export names.
|--------------------------------------------------------------------------*/

const settings = require("../lib/storage");
const { load, signature, mergeConfig, validateConfig, PHASES, TYPES, FAILURES, REGISTRY_PATH } = require("./HookLoader");
const { evaluateWhen, conditionTerms, hookReferences } = require("./HookCondition");
const { render } = require("./HookRenderer");


function enabledHooks(phase) {

    if (!PHASES.includes(phase)) {
        throw new Error(`Unknown hook phase: ${phase}`);
    }

    if (settings.get("HOOKS_ENABLED") !== true) {
        return [];
    }

    return load()[phase].filter(hook => hook.enabled);
}


function routine() {

    const enabled = settings.get("HOOKS_ENABLED") === true;

    if (!enabled) {

        return {
            enabled: false,
            before_task: [],
            after_task: []
        };
    }

    const config = load();

    return {
        enabled: true,
        before_task:
            config.before_task.filter(item => item.enabled).map(item => item.id),
        after_task:
            config.after_task.filter(item => item.enabled).map(item => item.id)
    };
}


module.exports = {
    PHASES,
    TYPES,
    load,
    validateConfig,
    enabledHooks,
    evaluateWhen,
    render,
    routine,

    _conditionTerms: conditionTerms,
    _hookReferences: hookReferences,
    _registryPath: REGISTRY_PATH
};


/*
| The underscore-prefixed exports are the test seams the module has always
| had; they stay so `test/hooks.test.js` needs no edit (phase acceptance:
| the suite passes unchanged).
*/

const _conditionTerms = conditionTerms;
const _hookReferences = hookReferences;
const _registryPath = REGISTRY_PATH;


module.exports = {
    PHASES,
    TYPES,
    FAILURES,
    load,
    signature,
    mergeConfig,
    validateConfig,
    enabledHooks,
    routine,
    render,
    evaluateWhen,
    _conditionTerms,
    _hookReferences,
    _registryPath,
};
