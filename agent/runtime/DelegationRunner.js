"use strict";

/*
|--------------------------------------------------------------------------
| Delegation Runner (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Extracted from agent.js. Live closures come from the bound host; sibling
| runtime modules are required (lazily when a cycle would form).
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");

function findingsFromReport(report) {

    const h = host();


    if (!report || typeof report !== "object") {
        return [];
    }

    if (Array.isArray(report.findings)) {
        return report.findings;
    }

    const content =
        report.response &&
        typeof report.response.content === "string"
            ? report.response.content.trim()
            : "";

    if (content !== "") {
        return [report.response.content];
    }

    if (Array.isArray(report.data)) {
        return report.data;
    }

    if (report.data !== undefined && report.data !== null) {
        return [report.data];
    }

    return [];

}


function validateDelegationPolicy(
    agentDefinition,
    depthBudget,
    delegations
) {

    const h = host();


    const policy =
        agentDefinition.delegation || {
            enabled: false,
            max_depth: 0,
            max_children: 0
        };

    if (!policy.enabled) {

        throw h.modelResponseError(
            `Agent "${agentDefinition.name}" is not allowed to delegate.`,
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "delegation_disabled",
                max_children: 0
            }
        );
    }

    /*
    | max_depth is relative: it is how many levels an agent may create
    | beneath itself, further limited by what its parent had left.
    */

    if (depthBudget < 1) {

        throw h.modelResponseError(
            `Agent "${agentDefinition.name}" exceeded delegation depth.`,
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "delegation_depth",
                depth_budget: depthBudget
            }
        );
    }

    if (
        delegations.length >
        policy.max_children
    ) {

        throw h.modelResponseError(
            `Agent "${agentDefinition.name}" exceeded max_children (${policy.max_children}).`,
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "max_children",
                max_children: policy.max_children,
                delegations: delegations.length
            }
        );
    }
}


function resolveDepthBudget(
    agentDefinition,
    inheritedBudget
) {

    const h = host();


    const policy =
        agentDefinition.delegation || {
            enabled: false,
            max_depth: 0
        };

    if (!policy.enabled) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            inheritedBudget,
            Number(policy.max_depth) || 0
        )
    );
}


async function runSubAgent(options) {

    const h = host();


    try {

        return await require("./IterationRunner").runSubAgentLoop(options);

    } catch (error) {

        h.events.emit("agent:end", {
            agent:
                options.agentProfile?.name || "sub_agent",

            scope:
                `${
                    options.agentProfile?.name || "sub_agent"
                }#${options.depth}`,

            depth:
                options.depth,

            hook:
                options.context?.hook || null,

            success: false,

            error: error.message
        });

        throw error;
    }
}


async function executeDelegations(
    delegations,
    depth,
    parentAgent,
    depthBudget,
    parentScope
) {

    const h = host();


    const policy =
        parentAgent?.delegation || {
            max_children:
                h.settings.get("MAX_PARALLEL_AGENTS")
        };

    if (
        delegations.length >
        policy.max_children
    ) {

        /* A policy violation here is a model decision, so it is a
           model-response error like validateDelegationPolicy, never a run
           killer. */
        throw h.modelResponseError(
            "Delegation count exceeds parent agent policy.",
            "INVALID_DELEGATION",
            {
                detected_action: "delegate",
                reason: "max_children",
                max_children: policy.max_children,
                delegations: delegations.length
            }
        );
    }

    /*
    | An ad-hoc child may only be granted tools the parent already has.
    */

    const parentAllowedTools =
        new Set(
            h.resolveTools(
                parentAgent?.tools
            ).map(
                tool =>
                    tool.function.name
            )
        );

    const tasks =
        delegations.map(
            (item, index) => ({
                id:
                    item.id ||
                    `delegation_${index + 1}`,

                agent:
                    item.agent ||
                    (
                        item.persona
                            ? `adhoc:${item.persona}`
                            : "unresolved_agent"
                    ),

                delegation:
                    item,

                task:
                    item.task,

                depends_on:
                    Array.isArray(
                        item.depends_on
                    )
                        ? item.depends_on
                        : []
            })
        );

    const maxParallel =
        h.settings.get("MAX_PARALLEL_AGENTS");

    /*
    | Delegation runs on the same scheduler as tools, so it has the same
    | shape, and the console is told about it the same way.
    */

    const graph =
        require("./ToolGraphExecutor").describeGraph(tasks, maxParallel);

    h.events.emit("delegation:graph", {
        parent:
            parentAgent?.name || "main_agent",

        parent_scope:
            parentScope || parentAgent?.name || "main_agent",

        depth,

        shape:
            graph.shape,

        waves:
            graph.waves,

        max_parallel:
            maxParallel,

        delegations:
            tasks.map(task => ({
                id: task.id,
                agent: task.agent,
                depends_on: task.depends_on,
                projectId:
                    h.requestedDelegationProjectId(task.delegation).value
            }))
    });

    return require("./ToolGraphExecutor").executeDependencyGraph({

        items:
            tasks,

        maxParallel,

        executor:
            async (
                task,
                results
            ) => {

                const startedAt = Date.now();

                /*
                | A delegation that fails before its agent starts used to
                | leave no trace at all: no agent:start, no agent:end,
                | nothing but a gap in the log. Every delegation now
                | reports how it ended, whoever failed it.
                */

                const switchEnabled =
                    h.delegationProjectSwitchEnabled();

                const requested =
                    h.requestedDelegationProjectId(task.delegation).value;

                const inherited =
                    h.effectiveProject(h.currentRun().project);

                const inheritedId =
                    h.projectIdOf(inherited) ||
                    h.currentRun().projectId ||
                    null;

                let scopedProject = inherited;

                if (switchEnabled && requested) {

                    try {

                        scopedProject =
                            h.projects.createProjectContext(
                                h.projects.registry().get(requested)
                            );

                    } catch {

                        const unknown =
                            new Error(`Unknown project: ${requested}`);

                        unknown.name = "UNKNOWN_PROJECT";

                        throw unknown;

                    }

                }

                /* In legacy the requested id is accepted but ignored,
                   so it must not become the child's label, the ALS
                   frame, or a multi-project mark. */
                const scopedProjectId =
                    h.projectIdOf(scopedProject) ||
                    (switchEnabled ? requested : null) ||
                    inheritedId;

                if (switchEnabled) {
                    h.noteDelegationProject(h.currentRun(), scopedProjectId);
                }

                try {

                    const agentProfile =
                        h.resolveDelegationProfile(
                            task.delegation,
                            parentAllowedTools
                        );

                    const dependencyContext =
                        task.depends_on.map(
                            id => ({
                                id,

                                result:
                                    results.get(
                                        id
                                    )
                            })
                        );

                    const runChild = () =>
                        runSubAgent({
                            agentProfile,

                            task:
                                task.task,

                            depth,

                            depthBudget,

                            context: {
                                parent:
                                    parentAgent?.name || null,

                                parent_scope:
                                    parentScope || null,

                                delegation_id:
                                    task.id,

                                hook:
                                    task.delegation.hook || null,

                                dependencies:
                                    dependencyContext
                            }
                        });

                    /* Each Sub-Agent gets its own project ALS frame so
                       two concurrent children cannot mix tools or
                       event project_id. Nested delegations may start a
                       new frame; this one is fixed for the child.
                       Legacy never enters the frame, so envelopes
                       stay historically shaped. */
                    const report =
                        switchEnabled
                            ? await h.runWithProject(
                                scopedProject,
                                () =>
                                    h.events.withProjectId(
                                        scopedProjectId,
                                        runChild
                                    )
                            )
                            : await runChild();

                    const labeled = {
                        ...report,
                        projectId:
                            report.projectId ?? scopedProjectId,
                        findings:
                            Array.isArray(report.findings)
                                ? report.findings
                                : findingsFromReport(report)
                    };

                    h.events.emit("delegation:end", {
                        parent:
                            parentAgent?.name || "main_agent",

                        parent_scope:
                            parentScope || parentAgent?.name || "main_agent",

                        id: task.id,

                        agent: task.agent,

                        depth,

                        success: true,

                        projectId: labeled.projectId,

                        duration_ms:
                            Date.now() - startedAt
                    });

                    return labeled;

                } catch (error) {

                    h.events.emit("delegation:end", {
                        parent:
                            parentAgent?.name || "main_agent",

                        parent_scope:
                            parentScope || parentAgent?.name || "main_agent",

                        id: task.id,

                        agent: task.agent,

                        depth,

                        success: false,

                        projectId: scopedProjectId,

                        error: error.message,

                        duration_ms:
                            Date.now() - startedAt
                    });

                    h.logLine(
                        parentScope || "main_agent",
                        `Delegation "${task.id}" to ${
                            task.agent
                        } failed: ${error.message}`
                    );

                    error.projectId = scopedProjectId;

                    throw error;
                }
            }
    })
        .then(
            results =>

                /*
                | Each result carries the agent name so a failed
                | delegation is attributable without id correlation.
                | Phase 12 adds projectId + findings so synthesis can
                | only cite labeled, per-project reports.
                */

                results.map(
                    (result, index) => {

                        const requested =
                            h.requestedDelegationProjectId(
                                tasks[index].delegation
                            ).value;

                        const projectId =
                            result.projectId ||
                            (result.result && result.result.projectId) ||
                            result.error?.projectId ||
                            (h.delegationProjectSwitchEnabled()
                                ? requested
                                : null) ||
                            h.projectIdOf(h.effectiveProject(h.currentRun().project)) ||
                            h.currentRun().projectId ||
                            null;

                        const findings =
                            result.success
                                ? (
                                    result.findings ||
                                    findingsFromReport(result.result)
                                )
                                : [];

                        return {
                            ...result,

                            agent:
                                tasks[index].agent,

                            projectId,

                            findings
                        };

                    }
                )
        );
}


module.exports = {
    findingsFromReport,
    validateDelegationPolicy,
    resolveDepthBudget,
    runSubAgent,
    executeDelegations
};
