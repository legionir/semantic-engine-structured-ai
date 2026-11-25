const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-runtime-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_RUN_MS = "2000";
process.env.MAX_REQUEST_MS = "1000";

const runtime = require("../../agent/agent.js");

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}

function throws(fn, pattern) {

    try {

        fn();

    } catch (error) {

        assert.match(error.message, pattern);

        return error;
    }

    throw new Error(
        `Expected a throw matching ${pattern}`
    );
}

const asMessage = message => ({
    choices: [
        { message }
    ]
});


function arrayWithoutItems(node, path = "root") {

    const problems = [];

    if (Array.isArray(node)) {

        node.forEach((item, index) => {
            problems.push(...arrayWithoutItems(item, `${path}[${index}]`));
        });

        return problems;
    }

    if (node && typeof node === "object") {

        if (
            node.type === "array" &&
            node.items === undefined
        ) {
            problems.push(path);
        }

        for (const [key, value] of Object.entries(node)) {
            problems.push(...arrayWithoutItems(value, `${path}.${key}`));
        }
    }

    return problems;
}


function strictViolations(node, path = "root") {

    const problems = [];

    if (Array.isArray(node)) {

        node.forEach((item, index) => {
            problems.push(...strictViolations(item, `${path}[${index}]`));
        });

        return problems;
    }

    if (node && typeof node === "object") {

        if (
            node.type === "object" &&
            node.additionalProperties === true
        ) {
            problems.push(`${path}: additionalProperties is true`);
        }

        if (
            node.type === "array" &&
            node.items === undefined
        ) {
            problems.push(`${path}: array without items`);
        }

        if (
            node.type === "object" &&
            node.properties
        ) {

            const missing =
                Object.keys(node.properties).filter(
                    key =>
                        !(node.required || []).includes(key)
                );

            if (missing.length > 0) {
                problems.push(`${path}: not required ${missing.join(", ")}`);
            }
        }

        for (const [key, value] of Object.entries(node)) {
            problems.push(...strictViolations(value, `${path}.${key}`));
        }
    }

    return problems;
}


async function main() {

    /* shared by several case groups below */
    const { compactConversation, conversationSize } =
        require("../../agent/context");

    function buildConversation(exchanges, size) {

        const messages = [
            { role: "system", content: "system prompt" },
            { role: "user", content: "do the work" }
        ];

        for (
            let index = 1;
            index <= exchanges;
            index++
        ) {

            messages.push({
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: `call_${index}`,
                        type: "function",
                        function: {
                            name: "fs_read",
                            arguments: "{}"
                        }
                    }
                ]
            });

            messages.push({
                role: "tool",
                tool_call_id: `call_${index}`,
                content: JSON.stringify({
                    id: `call_${index}`,
                    name: "fs_read",
                    success: true,
                    result: { content: "x".repeat(size) }
                })
            });
        }

        return messages;
    }

    const settings = require("../../agent/config");


    /* the cases live in ./runtime-cases, run in this order */
    const ctx = {
        arrayWithoutItems,
        asMessage,
        buildConversation,
        compactConversation,
        conversationSize,
        runtime,
        settings,
        strictViolations,
        test,
        throws
    };

    await require("./runtime-cases/01-response-parsing")(ctx);
    await require("./runtime-cases/02-dependency-references")(ctx);
    await require("./runtime-cases/03-run-deadline-and-cancellation")(ctx);
    await require("./runtime-cases/04-policy-engine")(ctx);
    await require("./runtime-cases/05-registries-and-schema")(ctx);
    await require("./runtime-cases/06-settings-storage")(ctx);
    await require("./runtime-cases/07-live-configuration")(ctx);
    await require("./runtime-cases/08-endpoint-profiles")(ctx);
    await require("./runtime-cases/09-working-memory")(ctx);
    await require("./runtime-cases/10-malformed-answers")(ctx);
    await require("./runtime-cases/11-a-leaked-version-pair-as-a")(ctx);
    await require("./runtime-cases/12-no-prompt-or-comment-invents-a")(ctx);
    await require("./runtime-cases/13-registry")(ctx);


    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    await runtime.eventstore.flush();
    await runtime.journal.flush();

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
