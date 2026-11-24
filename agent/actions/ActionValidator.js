"use strict";

/*
|--------------------------------------------------------------------------
| Action Validator (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Schema and field-matrix checks for tool_call / delegate / final. Error
| messages are the historical contract; Phase 12's optional projectId on
| a delegation is additive and stays here.
|--------------------------------------------------------------------------
*/

const ctx = require("./context");
const { parseArguments } = require("./ActionNormalizer");
const { validateActionGraph, requestedDelegationProjectId } = require("./ActionGraph");


function requireNullFields(action, fields) {

    for (const field of fields) {

        if (action[field] !== null) {

            throw new Error(
                `${field} must be null when action is "${action.action}".`
            );
        }
    }
}




function validateAction(
    action
) {

    if (
        !action ||
        typeof action !== "object" ||
        Array.isArray(action)
    ) {

        throw new Error(
            "Empty agent action."
        );
    }

    const requiredFields = [
        "version",
        "action",
        "tool_calls",
        "delegations",
        "response",
        "data",
        "error"
    ];

    for (const field of requiredFields) {

        if (!Object.prototype.hasOwnProperty.call(action, field)) {

            throw new Error(
                `Agent action is missing required top-level field "${field}".`
            );
        }
    }

    const allowedFields =
        new Set([
            ...requiredFields,
            "performed"
        ]);

    const extraFields =
        Object.keys(action).filter(
            field => !allowedFields.has(field)
        );

    if (extraFields.length > 0) {

        throw new Error(
            `Agent action contains unknown top-level field(s): ${extraFields.join(", ")}.`
        );
    }

    if (action.version !== "1.0") {

        throw new Error(
            'version must be the literal string "1.0".'
        );
    }

    if (
        ![
            "tool_call",
            "delegate",
            "final"
        ].includes(
            action.action
        )
    ) {

        throw new Error(
            `Invalid action: ${action.action}`
        );
    }

    if (
        action.action ===
        "tool_call"
    ) {

        if (
            !Array.isArray(
                action.tool_calls
            ) ||
            action.tool_calls.length === 0
        ) {

            throw new Error(
                "tool_calls must contain at least one call."
            );
        }

        requireNullFields(
            action,
            [
                "delegations",
                "response",
                "data",
                "error"
            ]
        );

        if (
            action.performed !== undefined &&
            action.performed !== null
        ) {

            throw new Error(
                'performed must be null when action is "tool_call".'
            );
        }

        for (
            const call
            of action.tool_calls
        ) {

            if (
                !call ||
                typeof call !== "object" ||
                Array.isArray(call)
            ) {

                throw new Error(
                    "Each tool call must be an object."
                );
            }

            const callFields =
                ["id", "name", "arguments", "depends_on"];

            const missing =
                callFields.filter(
                    field =>
                        !Object.prototype.hasOwnProperty.call(call, field)
                );

            if (missing.length > 0) {

                throw new Error(
                    `Tool call is missing required field(s): ${missing.join(", ")}.`
                );
            }

            const extras =
                Object.keys(call).filter(
                    field => !callFields.includes(field)
                );

            if (extras.length > 0) {

                throw new Error(
                    `Tool call contains unknown field(s): ${extras.join(", ")}.`
                );
            }

            if (
                typeof call.name !== "string" ||
                call.name.trim() === ""
            ) {

                throw new Error(
                    "tool_call.name is required."
                );
            }

            try {

                parseArguments(
                    call.arguments,
                    call.name
                );

            } catch (error) {

                throw new Error(
                    error.message
                );
            }

            if (
                !call.arguments ||
                (
                    typeof call.arguments !== "object" &&
                    typeof call.arguments !== "string"
                ) ||
                Array.isArray(call.arguments)
            ) {

                throw new Error(
                    `tool_call.arguments is required for "${call.name}" and must be one JSON object${
                        ctx.settings.get("AGENT_SCHEMA") === "strict"
                            ? " encoded as a string"
                            : ""
                    }.`
                );
            }
        }

        validateActionGraph(
            action.tool_calls,
            "tool_call"
        );
    }

    if (
        action.action ===
        "delegate"
    ) {

        if (
            !Array.isArray(
                action.delegations
            ) ||
            action.delegations.length === 0
        ) {

            throw new Error(
                "delegations must contain at least one delegation."
            );
        }

        requireNullFields(
            action,
            [
                "tool_calls",
                "response",
                "data",
                "error"
            ]
        );

        if (
            action.performed !== undefined &&
            action.performed !== null
        ) {

            throw new Error(
                'performed must be null when action is "delegate".'
            );
        }

        for (
            const delegation
            of action.delegations
        ) {

            if (
                !delegation ||
                typeof delegation !== "object" ||
                Array.isArray(delegation)
            ) {

                throw new Error(
                    "Each delegation must be an object."
                );
            }

            const delegationFields = [
                "id",
                "agent",
                "persona",
                "skills",
                "tools",
                "task",
                "depends_on"
            ];

            /* Phase 12: optional additive project selector. camelCase
               matches the implementation-plan contract; project_id is
               accepted as an alias. Neither is required. */
            const optionalDelegationFields = [
                "projectId",
                "project_id"
            ];

            const missing =
                delegationFields.filter(
                    field =>
                        !Object.prototype.hasOwnProperty.call(
                            delegation,
                            field
                        )
                );

            if (missing.length > 0) {

                throw new Error(
                    `Delegation is missing required field(s): ${missing.join(", ")}.`
                );
            }

            const extras =
                Object.keys(delegation).filter(
                    field =>
                        !delegationFields.includes(field) &&
                        !optionalDelegationFields.includes(field)
                );

            if (extras.length > 0) {

                throw new Error(
                    `Delegation contains unknown field(s): ${extras.join(", ")}.`
                );
            }

            const requestedProject =
                requestedDelegationProjectId(delegation);

            if (requestedProject.error) {

                throw new Error(requestedProject.error);

            }

            const hasAgent =
                typeof delegation.agent === "string" &&
                delegation.agent.trim() !== "";

            const hasPersona =
                typeof delegation.persona === "string" &&
                delegation.persona.trim() !== "";

            if (!hasAgent && !hasPersona) {

                throw new Error(
                    "A delegation requires either agent or persona."
                );
            }

            if (hasAgent && hasPersona) {

                throw new Error(
                    "A delegation must use either a registered agent or an ad-hoc persona, not both."
                );
            }

            if (
                hasAgent &&
                (
                    delegation.skills !== null ||
                    delegation.tools !== null
                )
            ) {

                throw new Error(
                    "A registered-agent delegation must set persona, skills and tools to null."
                );
            }

            if (
                hasAgent &&
                delegation.persona !== null
            ) {

                throw new Error(
                    "A registered-agent delegation must set persona, skills and tools to null."
                );
            }

            if (
                !hasAgent &&
                (
                    !Array.isArray(delegation.skills) ||
                    !Array.isArray(delegation.tools)
                )
            ) {

                throw new Error(
                    "An ad-hoc delegation must provide skills and tools arrays."
                );
            }

            if (
                typeof delegation.task !== "string" ||
                delegation.task.trim() === ""
            ) {

                throw new Error(
                    `delegation.task is required for agent "${
                        delegation.agent ||
                        delegation.persona
                    }".`
                );
            }
        }

        validateActionGraph(
            action.delegations,
            "delegation"
        );
    }

    if (
        action.action ===
        "final"
    ) {

        requireNullFields(
            action,
            [
                "tool_calls",
                "delegations"
            ]
        );

        if (
            !action.response ||
            typeof action.response !==
            "object" ||
            Array.isArray(action.response)
        ) {

            throw new Error(
                "Final response is missing."
            );
        }

        const responseFields =
            ["type", "content"];

        const missing =
            responseFields.filter(
                field =>
                    !Object.prototype.hasOwnProperty.call(
                        action.response,
                        field
                    )
            );

        if (missing.length > 0) {

            throw new Error(
                `Final response is missing required field(s): ${missing.join(", ")}.`
            );
        }

        const extras =
            Object.keys(action.response).filter(
                field => !responseFields.includes(field)
            );

        if (extras.length > 0) {

            throw new Error(
                `Final response contains unknown field(s): ${extras.join(", ")}.`
            );
        }

        if (
            !["text", "code", "json", "markdown"].includes(
                action.response.type
            )
        ) {

            throw new Error(
                "Final response type must be text, code, json, or markdown."
            );
        }

        if (
            typeof action.response.content !==
            "string" ||
            action.response.content.trim() === ""
        ) {

            throw new Error(
                "Final response content must be a non-empty string."
            );
        }

        if (
            action.error !== null &&
            (
                typeof action.error !== "object" ||
                Array.isArray(action.error) ||
                Object.keys(action.error).some(
                    field =>
                        !["code", "message", "retryable"].includes(field)
                ) ||
                typeof action.error.code !== "string" ||
                action.error.code.trim() === "" ||
                typeof action.error.message !== "string" ||
                action.error.message.trim() === "" ||
                typeof action.error.retryable !== "boolean"
            )
        ) {

            throw new Error(
                "Final error must be null or exactly {code, message, retryable}."
            );
        }

        if (
            action.performed !== undefined &&
            action.performed !== null
        ) {

            if (
                typeof action.performed !== "object" ||
                Array.isArray(action.performed)
            ) {

                throw new Error(
                    "performed must be null or an object on a final action."
                );
            }

            const allowedClaimFields =
                ["tools", "agents", "files_changed"];

            const unknownClaimFields =
                Object.keys(action.performed).filter(
                    field => !allowedClaimFields.includes(field)
                );

            if (unknownClaimFields.length > 0) {

                throw new Error(
                    `performed contains unknown field(s): ${unknownClaimFields.join(", ")}.`
                );
            }

            for (const field of allowedClaimFields) {

                if (
                    action.performed[field] !== undefined &&
                    (
                        !Array.isArray(action.performed[field]) ||
                        action.performed[field].some(
                            value => typeof value !== "string"
                        )
                    )
                ) {

                    throw new Error(
                        `performed.${field} must be an array of strings.`
                    );
                }
            }
        }
    }
}



module.exports = {
    validateActionGraph,
    requireNullFields,
    requestedDelegationProjectId,
    validateAction
};
