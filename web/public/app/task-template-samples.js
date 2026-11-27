/*
|--------------------------------------------------------------------------
| Sample task templates
|--------------------------------------------------------------------------
|
| A starter set so the Templates dialog is useful on first open. They are
| ordinary templates: the operator can edit, load or delete them. Seeding
| runs once per browser (a flag key remembers it), so a deleted sample does
| not come back on the next load; the Samples button in the dialog adds
| back whichever samples are missing. The ids are fixed, so re-adding
| never duplicates a sample and never touches one the operator edited.
*/

import { taskTemplates } from "./task-templates.js";

export const SAMPLES_SEEDED_KEY = "structured-ai.taskTemplates.samplesSeeded";


export const SAMPLE_TASK_TEMPLATES = Object.freeze([
    {
        id: "tpl-sample-fix-failing-tests",
        name: "Fix failing tests",
        category: "Debug",
        description: "Run the suite, find the root cause and fix it with the smallest change.",
        mode: "prompt",
        effort: "high",
        content: [
            "Run the test suite and collect every failing test.",
            "For each failure, find the root cause in the source (not in the test) and fix it with the smallest change that keeps the intent.",
            "Do not delete or weaken assertions. Re-run the suite until it passes and summarize what was wrong and what you changed."
        ].join("\n")
    },
    {
        id: "tpl-sample-code-review",
        name: "Review changes",
        category: "Review",
        description: "Read-only review of the working tree: bugs, risks and missing tests.",
        mode: "plan",
        effort: "high",
        content: [
            "Review the uncommitted changes in this repository (git diff, plus any new files).",
            "Report, ordered by severity: correctness bugs, security issues, error handling gaps, missing or weak tests, and readability problems.",
            "Cite file and line for each finding and suggest a concrete fix. Do not modify any files."
        ].join("\n")
    },
    {
        id: "tpl-sample-write-tests",
        name: "Add tests for a module",
        category: "Testing",
        description: "Cover a module's public behaviour, edge cases and errors.",
        mode: "prompt",
        effort: "medium",
        content: [
            "Add tests for <path/to/module>.",
            "Follow the repository's existing test style and runner. Cover the public behaviour, edge cases (empty, large, invalid input) and error paths.",
            "Run the new tests and the related existing ones, and report the coverage you added."
        ].join("\n")
    },
    {
        id: "tpl-sample-explain-codebase",
        name: "Explain the codebase",
        category: "Onboarding",
        description: "A read-only tour: structure, entry points and how a request flows.",
        mode: "plan",
        effort: "medium",
        content: [
            "Give me a tour of this repository without changing anything.",
            "Explain the directory layout, the main entry points, how a typical request or command flows through the code, how configuration is loaded, and how to run the tests.",
            "End with the five files a new contributor should read first."
        ].join("\n")
    },
    {
        id: "tpl-sample-refactor",
        name: "Refactor safely",
        category: "Refactor",
        description: "Improve structure without changing behaviour, verified by the tests.",
        mode: "prompt",
        effort: "high",
        content: [
            "Refactor <path/or/area> to improve readability and structure without changing behaviour.",
            "Run the tests before you start and after each step. Keep public APIs and outputs identical; remove dead code and duplication you find on the way.",
            "Summarize every change and why it is behaviour-preserving."
        ].join("\n")
    },
    {
        id: "tpl-sample-security-audit",
        name: "Security audit",
        category: "Security",
        description: "Look for injection, path traversal, secrets and missing auth checks.",
        mode: "plan",
        effort: "xhigh",
        content: [
            "Audit this codebase for security problems without changing files.",
            "Check input validation, command and SQL injection, path traversal, unsafe deserialization, hard-coded secrets, missing authentication or authorization checks, and dependencies with known issues.",
            "Report each finding with its location, impact, likelihood and a recommended fix."
        ].join("\n")
    }
]);


function defaultStorage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}


/*
| Adds the samples whose ids are missing and returns how many it added.
| Without `force` it runs only the first time (per storage); with it, it
| always fills in the missing ones (the Samples button).
*/
export function seedSampleTemplates({ service = taskTemplates, storage = defaultStorage(), force = false } = {}) {

    if (!force) {
        try {
            if (storage && storage.getItem(SAMPLES_SEEDED_KEY)) return 0;
        } catch {
            return 0;
        }
    }

    const have = new Set(service.list().map(template => template.id));
    const names = new Set(service.list().map(template => template.name.toLowerCase()));
    let added = 0;

    SAMPLE_TASK_TEMPLATES.forEach(sample => {
        if (have.has(sample.id) || names.has(sample.name.toLowerCase())) return;
        try {
            service.save({ ...sample }, { overwrite: false });
            added++;
        } catch {
            /* a name clash with an operator template: keep theirs */
        }
    });

    try {
        if (storage) storage.setItem(SAMPLES_SEEDED_KEY, "1");
    } catch {
        /* storage quota or private mode */
    }

    return added;
}
