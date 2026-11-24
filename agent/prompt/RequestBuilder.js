/*
|--------------------------------------------------------------------------
| Request Builder
|--------------------------------------------------------------------------
|
| The OpenAI-compatible request body, moved out of agent.js
| (EXECUTION_PLAN Phase 5, گام ۴): model, messages, temperature, tool
| declarations, parallel_tool_calls, response_format — and the plain
| completion variant (responseFormat null) the summariser gets, with no
| tool schema and no parallel flag.
|
| The body is the historical buildAgentRequest() verbatim; the endpoint
| profile and the response schema come in as injected closures so the
| module still sees live settings and registry.
|--------------------------------------------------------------------------
*/

const settings = require("../config");


class RequestBuilder {

    constructor({ endpointFor, RESPONSE_FORMAT_OF }) {

        this.endpointFor = endpointFor;

        this.RESPONSE_FORMAT_OF = RESPONSE_FORMAT_OF;

    }


    build({
        messages,
        agentDefinition,
        tools,
        responseFormat,
        role,
        withSchema = true
    }) {

        const profile =
            this.endpointFor(role, agentDefinition);

        if (responseFormat === null) {

            /*
            | A plain completion, used by the summariser.
            */

            const request = {
                model:
                    profile.model,

                messages,

                temperature:
                    agentDefinition &&
                    agentDefinition.temperature !== undefined
                        ? agentDefinition.temperature
                        : profile.temperature
            };

            if (
                agentDefinition &&
                agentDefinition.max_tokens
            ) {
                request.max_tokens = agentDefinition.max_tokens;
            }

            return request;
        }

        const request = {
            model:
                profile.model,

            messages,

            temperature:
                profile.temperature,

            tools,

            parallel_tool_calls:
                true
        };

        /*
        | The schema is sent unless this endpoint has already refused
        | it. Without it the model still has the contract in its
        | instructions, and the parser accepts a native tool call either
        | way.
        */

        if (withSchema) {

            request.response_format =
                this.RESPONSE_FORMAT_OF();
        }

        /*
        | Left out by default, because a gateway that caps the answer
        | for us is easier to see than a ceiling we set silently. When
        | an answer is being cut off mid-write, this is the knob that
        | fixes it.
        */

        const ceiling =
            settings.get("MAX_RESPONSE_TOKENS");

        if (ceiling > 0) {
            request.max_tokens = ceiling;
        }

        return request;
    }

}


module.exports = RequestBuilder;
