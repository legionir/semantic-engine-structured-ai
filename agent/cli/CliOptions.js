"use strict";

/* Parse CLI-derived settings and validate them before the runtime loads. */

function createCliOptions({ fail, repoRoot, fs, path }) {
    const REPO_ROOT = repoRoot;
const numericOptionFlags = {
    AGENT_TEMPERATURE: { flag: "--temperature", scale: 1, unit: "" },
    MAX_RUN_MS: { flag: "--timeout", scale: 1000, unit: " seconds" },
    MAX_ITERATIONS: { flag: "--max-iterations", scale: 1, unit: "" },
    MAX_TOTAL_AGENTS: { flag: "--max-agents", scale: 1, unit: "" }
};


function validateNumericOptions(environment) {

    const schema =
        require(path.join(REPO_ROOT, "agent", "config", "SettingsSchema.js"));

    for (const [key, option] of Object.entries(numericOptionFlags)) {

        if (environment[key] === undefined) {
            continue;
        }

        const definition =
            schema.definitionOf(key);

        const value =
            Number(environment[key]);

        const below =
            definition.min !== undefined && value < definition.min;

        const above =
            definition.max !== undefined && value > definition.max;

        if (!Number.isFinite(value) || below || above) {

            const shown =
                bound => bound === undefined ? null : bound / option.scale;

            const range =
                definition.max !== undefined
                    ? `between ${shown(definition.min)} and ${shown(definition.max)}${option.unit}`
                    : `at least ${shown(definition.min)}${option.unit}`;

            fail(
                `${option.flag} must be ${range}, received ${value / option.scale}`
            );
        }
    }
}


function applyEnvironment(options) {

    const environment = {};

    if (options.workspace) {

        const resolved =
            path.resolve(options.workspace);

        if (
            !fs.existsSync(resolved) ||
            !fs.statSync(resolved).isDirectory()
        ) {
            fail(`workspace is not a directory: ${options.workspace}`);
        }

        environment.WORKSPACE_ROOT = resolved;
    }

    /*
    | EXECUTION_PLAN Phase 7 گام ۱: --project <id> binds the run to a
    | registered project. The root is ALWAYS taken from the registry —
    | a -w that disagrees with the registered root is an error, and
    | without -w the registered root becomes the workspace (rule: never
    | trust identity arguments over registry data).
    */
    if (options.project) {

        const projects =
            require(path.join(REPO_ROOT, "agent", "projects", "index.js"));

        const { canonicalizeRoot } =
            require(path.join(REPO_ROOT, "agent", "projects", "ProjectRegistry.js"));

        let record;

        try {

            record =
                projects.registry().get(options.project);

        } catch (error) {

            fail(
                `${error.message} ` +
                "(--project names a record of the central project registry; " +
                "register the project there first)"
            );

        }

        const projectRoot = record.rootPath;

        if (options.workspace) {

            if (
                canonicalizeRoot(environment.WORKSPACE_ROOT) !==
                projectRoot
            ) {

                fail(
                    `--project ${options.project} is rooted at ${projectRoot}, ` +
                    `which does not match --workspace ${options.workspace}; ` +
                    "the project root always comes from the registry, not from flags " +
                    "(drop -w to run on the registered root)"
                );

            }

        } else {

            if (
                !fs.existsSync(projectRoot) ||
                !fs.statSync(projectRoot).isDirectory()
            ) {

                fail(
                    `--project ${options.project} is rooted at ${projectRoot}, ` +
                    "but that directory does not exist"
                );

            }

            environment.WORKSPACE_ROOT = projectRoot;

        }

        /* Project selection is part of the canonical execution path. The
           runtime resolves the registered ProjectContext directly; there
           is no process-wide rollout bundle to mutate. */

    }

    if (options.approve) {

        if (
            !["auto", "prompt", "deny"].includes(options.approve)
        ) {
            fail(
                `--approve expects auto, prompt or deny, received "${options.approve}"`
            );
        }

        environment.AGENT_APPROVAL = options.approve;
    }

    if (options.dryRun) {

        /*
        | A dry run still inspects the project; it simply refuses every
        | call the policy sends for approval, so nothing is modified.
        */

        environment.AGENT_APPROVAL = "deny";
    }

    if (options.model) {
        environment.AGENT_MODEL = options.model;
    }

    if (options.temperature !== undefined) {
        environment.AGENT_TEMPERATURE = String(options.temperature);
    }

    if (options.baseUrl) {
        environment.AGENT_BASE_URL = options.baseUrl;
    }

    if (options.apiKey) {
        environment.AGENT_API_KEY = options.apiKey;
    }

    if (options.timeoutSeconds !== undefined) {
        environment.MAX_RUN_MS = String(
            Math.round(options.timeoutSeconds * 1000)
        );
    }

    if (options.maxIterations !== undefined) {
        environment.MAX_ITERATIONS = String(options.maxIterations);
    }

    if (options.maxAgents !== undefined) {
        environment.MAX_TOTAL_AGENTS = String(options.maxAgents);
    }

    /*
    | P0-7: numeric options are checked against the settings schema before
    | anything runs, so "--temperature 3" is a usage error (exit 2) rather
    | than a value that fails, or is silently clamped, in the middle of a run.
    */
    validateNumericOptions(environment);

    if (options.quiet) {
        environment.AGENT_VERBOSE = "0";
    }

    if (options.json) {

        /*
        | stdout carries the result, so progress and the runtime's own
        | final dump move out of the way.
        */

        environment.AGENT_LOG_STREAM = "stderr";
        environment.AGENT_PRINT_FINAL = "0";
    }

    if (options.interactive) {

        /*
        | The session prints the answer itself, so the runtime's raw
        | dump would only repeat it.
        */

        environment.AGENT_PRINT_FINAL = "0";
    }

    Object.assign(process.env, environment);

    return environment;
}



    return { validateNumericOptions, applyEnvironment };
}

module.exports = { createCliOptions };
