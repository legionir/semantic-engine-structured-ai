"use strict";

/*
|--------------------------------------------------------------------------
| Tool Registry Adapter — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| Definition and implementation stay comparable:
|
|   registry  → schema
|   runtime   → implementation
|   validator → parity check
|
| This adapter is the named comparison surface. It does not change
| schema or contract; it reads the Phase 14 loader and the Phase 19
| runtime and reports whether the two sides still name the same tools.
|--------------------------------------------------------------------------
*/

const loader = require("../registry/RegistryLoader");
const validator = require("../registry/RegistryValidator");


function schemas() {

    return loader.loadToolSchemas();
}


function declaredNames() {

    return schemas().map(item => item.function.name);
}


function implementedNames() {

    return require("./ToolRuntime").implementedToolNames();
}


function parity() {

    const declared = declaredNames();
    const implemented = implementedNames();

    const missing =
        declared.filter(name => !implemented.includes(name));

    const extra =
        implemented.filter(name => !declared.includes(name));

    return {
        declared,
        implemented,
        missing,
        extra,
        equal: missing.length === 0 && extra.length === 0
    };
}


function assertParity() {

    const result = parity();

    if (!result.equal) {

        const parts = [];

        if (result.missing.length > 0) {

            parts.push(
                `declared but not implemented: ${result.missing.join(", ")}`
            );
        }

        if (result.extra.length > 0) {

            parts.push(
                `implemented but not declared: ${result.extra.join(", ")}`
            );
        }

        throw new Error(
            `Tool registry/runtime parity failed (${parts.join("; ")}).`
        );
    }

    return true;
}


function validateAgainst(registries) {

    const runtime = require("./ToolRuntime");

    return validator.validate({
        tools: registries.tools || schemas(),
        groups: registries.groups,
        skills: registries.skills,
        agents: registries.agents,
        personas: registries.personas,
        policy: registries.policy,
        hasTool: name => runtime.hasTool(name),
        implementedToolNames: () => runtime.implementedToolNames()
    });
}


module.exports = {
    schemas,
    declaredNames,
    implementedNames,
    parity,
    assertParity,
    validateAgainst
};
