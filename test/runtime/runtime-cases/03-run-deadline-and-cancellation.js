"use strict";

/*
| runtime.test.js: run deadline and cancellation, context budget
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function runDeadlineAndCancellationCases(ctx) {

    const {
        buildConversation,
        compactConversation,
        conversationSize,
        runtime,
        test,
        throws
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nrun deadline and cancellation");

    await test("a fresh run is active and has remaining time", async () => {

        runtime.startRun();

        assert.equal(runtime.isRunCancelled(), false);
        assert.ok(runtime.runRemainingMs() > 0);

        runtime.assertRunActive("probe");
    });

    await test("cancelling a run stops further work", async () => {

        runtime.startRun();
        runtime.cancelRun("test");

        assert.equal(runtime.isRunCancelled(), true);

        throws(
            () => runtime.assertRunActive("tool fs_read"),
            /Run cancelled \(test\): tool fs_read/
        );
    });

    await test("an expired deadline stops further work", async () => {

        runtime.startRun();

        await new Promise(
            resolve =>
                setTimeout(resolve, 2100)
        );

        throws(
            () => runtime.assertRunActive("main agent"),
            /run budget of 2000 ms \(MAX_RUN_MS\) was spent/
        );

        assert.equal(runtime.isRunCancelled(), true);
    });

    await test("the deadline is reported in the runtime context", async () => {

        runtime.startRun();

        const context =
            runtime.createRuntimeContext();

        assert.equal(context.runtime.max_run_ms, 2000);
        assert.equal(context.runtime.max_request_ms, 1000);
        assert.ok(context.runtime.run_remaining_ms > 0);
        assert.ok(context.runtime.run_remaining_ms <= 2000);
    });

    /* ---------------------------------------------------------------- */
    console.log("\ncontext budget");

    await test("a conversation inside the budget is untouched", async () => {

        const messages =
            buildConversation(2, 100);

        const before =
            JSON.stringify(messages);

        const report =
            compactConversation(messages, { maxChars: 100000 });

        assert.equal(report.compacted, false);
        assert.equal(JSON.stringify(messages), before);
    });

    await test("compression is graduated by age, newest untouched", async () => {

        const messages =
            buildConversation(20, 5000);

        const report =
            compactConversation(
                messages,
                {
                    maxChars: 40000,
                    keepRecentExchanges: 2
                }
            );

        assert.equal(report.compacted, true);
        assert.ok(conversationSize(messages) <= 40000);

        const toolMessages =
            messages.filter(
                message => message.role === "tool"
            );

        const sizeAt = fromNewest =>
            toolMessages[toolMessages.length - 1 - fromNewest]
                .content.length;

        /* the newest two are exactly as they were */
        assert.equal(
            toolMessages[toolMessages.length - 1].compression,
            undefined
        );

        assert.equal(
            toolMessages[toolMessages.length - 2].compression,
            undefined
        );

        /* and size never grows with age */
        const samples =
            [0, 5, 10, 15, 19].map(sizeAt);

        for (
            let index = 1;
            index < samples.length;
            index++
        ) {

            assert.ok(
                samples[index] <= samples[index - 1],
                `an older result was larger: ${samples.join(" then ")}`
            );
        }

        /* compression never softens with age */
        const rank = { undefined: 0, none: 0, light: 1, medium: 2, heavy: 3 };

        const levels =
            toolMessages.map(
                message => rank[message.compression]
            );

        for (
            let index = 1;
            index < levels.length;
            index++
        ) {

            assert.ok(
                levels[index] <= levels[index - 1],
                `a newer result was compressed harder: ${
                    toolMessages.map(m => m.compression || "none").join(",")
                }`
            );
        }

        /* a tighter budget pushes the oldest all the way down */
        const tight =
            buildConversation(20, 5000);

        const tightReport =
            compactConversation(tight, {
                maxChars: 30000,
                keepRecentExchanges: 2
            });

        assert.equal(tightReport.dropped_exchanges, 0);

        assert.equal(
            tight.filter(m => m.role === "tool")[0].compression,
            "heavy"
        );

        /* and the newest is still verbatim even then */
        const survivors =
            tight.filter(m => m.role === "tool");

        assert.equal(
            survivors[survivors.length - 1].compression,
            undefined
        );
    });

    await test("compaction preserves tool_call pairing", async () => {

        const messages =
            buildConversation(12, 8000);

        compactConversation(
            messages,
            {
                maxChars: 15000,
                keepRecentExchanges: 1
            }
        );

        for (
            let index = 0;
            index < messages.length;
            index++
        ) {

            const message = messages[index];

            if (
                message.role !== "assistant" ||
                !Array.isArray(message.tool_calls)
            ) {
                continue;
            }

            const answers =
                message.tool_calls.map(call => call.id);

            for (const id of answers) {

                const answered =
                    messages.some(
                        item =>
                            item.role === "tool" &&
                            item.tool_call_id === id
                    );

                assert.equal(
                    answered,
                    true,
                    `tool_call ${id} lost its answer`
                );
            }
        }
    });

    await test("compressing is preferred over dropping", async () => {

        const messages =
            buildConversation(10, 20000);

        const report =
            compactConversation(
                messages,
                {
                    maxChars: 30000,
                    keepRecentExchanges: 1
                }
            );

        assert.ok(
            report.light + report.medium + report.heavy > 0,
            "nothing was compressed"
        );

        assert.equal(report.dropped_exchanges, 0);
        assert.ok(conversationSize(messages) <= 30000);
    });

    await test("the tier of an exchange follows its distance from the newest", async () => {

        const { levelForPosition, LEVELS } =
            require("../../../agent/context");

        const options = {
            keepRecentExchanges: 2,
            lightFraction: 0.4,
            mediumFraction: 0.6
        };

        /* the example from the request: 100 exchanges */
        assert.equal(levelForPosition(0, 100, options), LEVELS.NONE);
        assert.equal(levelForPosition(1, 100, options), LEVELS.NONE);
        assert.equal(levelForPosition(10, 100, options), LEVELS.LIGHT);
        assert.equal(levelForPosition(39, 100, options), LEVELS.LIGHT);
        assert.equal(levelForPosition(45, 100, options), LEVELS.MEDIUM);
        assert.equal(levelForPosition(59, 100, options), LEVELS.MEDIUM);
        assert.equal(levelForPosition(60, 100, options), LEVELS.HEAVY);
        assert.equal(levelForPosition(99, 100, options), LEVELS.HEAVY);
    });

    await test("dropping exchanges is recorded for the model", async () => {

        const messages =
            buildConversation(10, 20000);

        const report =
            compactConversation(
                messages,
                {
                    maxChars: 5000,
                    keepRecentExchanges: 1
                }
            );

        assert.ok(report.dropped_exchanges > 0);

        const note =
            messages.find(
                message =>
                    typeof message.content === "string" &&
                    message.content.includes("context_compaction")
            );

        assert.ok(note, "the model must be told what was removed");
    });
};
