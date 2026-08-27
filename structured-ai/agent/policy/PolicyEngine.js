/*
|--------------------------------------------------------------------------\
| Policy engine
|--------------------------------------------------------------------------\
|
| The tool allowlist on an Agent Profile answers "may this agent use this
| capability at all". The policy engine answers the separate question "may
| this specific call run right now", and is the single place where a
| destructive operation can be denied or sent for approval.
|
|   Agent -> Tool Request -> Policy Engine -> allow
|                                         -> deny
|                                         -> require_approval -> Approval
|
| Rules are declarative and live in registry/policy.json so the runtime
| behaviour can be changed without touching code.
|
| This class is deliberately thin: matching belongs to PolicyMatcher, the
| document to PolicyRegistry, the asking to ApprovalManager, and the record
| of what was asked and answered to ApprovalStore. Splitting it that way is
| what keeps a security boundary reviewable — the composition below is the
| whole enforcement path, and there is no second copy of it anywhere.
|--------------------------------------------------------------------------*/

const { PolicyRegistry } = require("./PolicyRegistry");
const { ApprovalStore, currentProjectId } = require("./ApprovalStore");
const { ApprovalManager, getApprovalMode } = require("./ApprovalManager");
const { mcpServerOf } = require("./PolicyMatcher");
const { DECISIONS, deniedByPolicy } = require("./PolicyErrors");


class PolicyEngine {

    constructor({
        policy,
        toolGroups,
        onDecision,
        /*
        | A console that renders pending approvals injects the store it
        | reads from, so the audit trail and the button list are the same
        | objects rather than two copies that drift.
        */
        store
    }) {

        this.approvals = [];

        this.store =
            store ||
            new ApprovalStore({ records: this.approvals });

        this.onDecision =
            onDecision || (() => {});

        this.manager =
            new ApprovalManager({
                store: this.store,
                mcpServerOf,

                /*
                | A refusal the manager made on the engine's behalf is still a
                | policy decision, so it is announced with the same shape the
                | allow/deny paths already use.
                */
                onRefusal: (evaluation, record) => {

                    this.onDecision({
                        ...evaluation,

                        approved: false,

                        approval_mode:
                            record.mode,

                        gateway_cached:
                            record.gateway_cached === true
                    });
                }
            });

        this.registry =
            new PolicyRegistry({ policy, toolGroups });
    }


    /*
    | The rules come from a file, so the engine has to be able to take a
    | new version of them without the process restarting.
    */

    reload({ policy, toolGroups } = {}) {

        this.registry.reload({ policy, toolGroups });

        return this;
    }


    groupsFor(toolName) {

        return this.registry.groupsFor(toolName);
    }


    /*
    | The last matching rule wins, so a specific rule can be written after
    | a broad one.
    */

    evaluate(toolName, args, agent) {

        return this.registry.decide(toolName, {
            args: args || {},
            agent: agent || "main_agent"
        });
    }


    async requestApproval(evaluation, args) {

        return this.manager.request(evaluation, args);
    }


    prompt(evaluation, args) {

        return this.manager.prompt(evaluation, args);
    }


    /*
    | The single enforcement point called by the tool graph.
    */

    async enforce(toolName, args, agent) {

        const evaluation =
            this.evaluate(toolName, args, agent);

        /*
        | Additive project attribution only when a project is actually in
        | scope. Stamping `project_id: null` would change the historical
        | shape of every legacy policy:decision.
        */
        const projectId = currentProjectId();

        if (projectId) {
            evaluation.project_id = projectId;
        }

        if (evaluation.decision === DECISIONS.DENY) {

            this.onDecision(evaluation);

            throw deniedByPolicy(toolName, evaluation.reason);
        }

        if (
            evaluation.decision ===
            DECISIONS.REQUIRE_APPROVAL
        ) {

            const approval =
                await this.requestApproval(evaluation, args);

            this.onDecision({
                ...evaluation,

                approved:
                    approval.approved,

                approval_mode:
                    approval.mode,

                gateway_cached:
                    approval.gateway_cached === true
            });

            return evaluation;
        }

        this.onDecision(evaluation);

        return evaluation;
    }


    summary() {

        return {
            mode:
                getApprovalMode(),

            default_action:
                this.registry.policy.default_action,

            rules:
                this.registry.ruleCount,

            approvals:
                this.approvals.length
        };
    }
}


module.exports = { PolicyEngine };
