"use strict";

/*
| runtime.test.js: dependency references
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function dependencyReferencesCases(ctx) {

    const {
        runtime,
        test,
        throws
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\ndependency references");

    const graphResults = new Map([
        [
            "call_1",
            {
                id: "call_1",
                success: true,
                name: "fs_list",
                result: {
                    path: "src",
                    count: 2,
                    entries: [
                        { name: "app.js", type: "file" },
                        { name: "lib", type: "directory" }
                    ]
                }
            }
        ],
        [
            "call_bad",
            {
                id: "call_bad",
                success: false,
                result: null,
                error: { message: "ENOENT" }
            }
        ]
    ]);

    await test("a reference is interpolated into a string", async () => {

        const resolved =
            runtime.resolveArgumentReferences(
                { path: "src/${call_1.result.entries.0.name}" },
                graphResults,
                ["call_1"]
            );

        assert.deepEqual(resolved, { path: "src/app.js" });
    });

    await test("a lone reference keeps the referenced type", async () => {

        const resolved =
            runtime.resolveArgumentReferences(
                {
                    count: "${call_1.result.count}",
                    entry: "${call_1.result.entries.1}"
                },
                graphResults,
                ["call_1"]
            );

        assert.strictEqual(resolved.count, 2);
        assert.deepEqual(
            resolved.entry,
            { name: "lib", type: "directory" }
        );
    });

    await test("references resolve inside arrays and nested objects", async () => {

        const resolved =
            runtime.resolveArgumentReferences(
                {
                    paths: ["${call_1.result.entries.0.name}", "static.txt"],
                    nested: { of: "${call_1.result.path}" }
                },
                graphResults,
                ["call_1"]
            );

        assert.deepEqual(
            resolved.paths,
            ["app.js", "static.txt"]
        );

        assert.equal(resolved.nested.of, "src");
    });

    await test("a reference to a call in the action but outside depends_on is refused", async () => {

        throws(
            () =>
                runtime.resolveArgumentReferences(
                    { path: "${call_1.result.path}" },
                    graphResults,
                    [],
                    new Set(["call_1"])
                ),
            /not listed in depends_on/
        );
    });

    await test("a ${...} that names nothing in the action stays literal", async () => {

        /* file content routinely contains template literals */

        const code =
            "export const id = `gamepad-${index}`;";

        assert.deepEqual(
            runtime.resolveArgumentReferences(
                { content: code },
                graphResults,
                [],
                new Set(["write_file"])
            ),
            { content: code }
        );

        /* even next to a real reference */
        assert.deepEqual(
            runtime.resolveArgumentReferences(
                { content: "${call_1.result.path} and `${index}`" },
                graphResults,
                ["call_1"],
                new Set(["call_1"])
            ),
            { content: "src and `${index}`" }
        );
    });

    await test("$${...} escapes a literal that would name a call", async () => {

        assert.deepEqual(
            runtime.resolveArgumentReferences(
                { content: "literal $${call_1} here" },
                graphResults,
                ["call_1"],
                new Set(["call_1"])
            ),
            { content: "literal ${call_1} here" }
        );
    });

    await test("repeated identical failures are counted, mixed results are not", async () => {

        const progress = {};

        const failure = [
            {
                id: "a",
                name: "fs_read",
                success: false,
                error: { message: "does not exist" }
            }
        ];

        assert.equal(runtime.trackRepeatedFailure(progress, failure), 1);
        assert.equal(runtime.trackRepeatedFailure(progress, failure), 2);
        assert.equal(runtime.trackRepeatedFailure(progress, failure), 3);

        /* a different error resets the count */
        assert.equal(
            runtime.trackRepeatedFailure(progress, [
                {
                    id: "a",
                    name: "fs_read",
                    success: false,
                    error: { message: "something else" }
                }
            ]),
            1
        );

        /* partial success is progress, not a loop */
        assert.equal(
            runtime.trackRepeatedFailure(progress, [
                { id: "a", name: "fs_read", success: true },
                {
                    id: "b",
                    name: "fs_read",
                    success: false,
                    error: { message: "does not exist" }
                }
            ]),
            0
        );
    });

    await test("a reference to a failed call is refused", async () => {

        throws(
            () =>
                runtime.resolveArgumentReferences(
                    { path: "${call_bad.result.path}" },
                    graphResults,
                    ["call_bad"]
                ),
            /which failed: ENOENT/
        );
    });

    await test("an unreachable path is reported clearly", async () => {

        throws(
            () =>
                runtime.resolveArgumentReferences(
                    { path: "${call_1.result.missing.deeper}" },
                    graphResults,
                    ["call_1"]
                ),
            /cannot be resolved/
        );
    });

    await test("arguments without references are untouched", async () => {

        const args =
            { path: "src", limit: 10, flag: true, nothing: null };

        assert.deepEqual(
            runtime.resolveArgumentReferences(
                args,
                graphResults,
                []
            ),
            args
        );
    });

    await test("the dependency graph feeds results to dependents", async () => {

        const executed =
            await runtime.executeDependencyGraph({
                items: [
                    { id: "a", depends_on: [] },
                    { id: "b", depends_on: ["a"] }
                ],

                maxParallel: 4,

                executor: async (item, previous) => {

                    if (item.id === "a") {
                        return { value: 21 };
                    }

                    return {
                        value:
                            previous.get("a").result.value * 2
                    };
                }
            });

        assert.equal(executed[1].result.value, 42);
    });

    await test("a generated id never collides with one the model chose", async () => {

        const normalized =
            runtime.normalizeToolCalls([
                { name: "fs_list", arguments: { path: "." } },
                { id: "call_1", name: "fs_read", arguments: { path: "a" } },
                { name: "fs_stat", arguments: { path: "b" } }
            ]);

        const ids =
            normalized.map(call => call.id);

        assert.equal(
            new Set(ids).size,
            ids.length,
            `duplicate ids: ${ids.join(", ")}`
        );

        assert.ok(ids.includes("call_1"));

        /* the graph accepts what normalization produced */
        await runtime.executeDependencyGraph({
            items: normalized,
            maxParallel: 4,
            executor: async () => ({})
        });
    });


    await test("on_failure: stop skips un-started dependents across waves", async () => {

        const ran = [];
        const skipped = [];

        const executed =
            await runtime.executeDependencyGraph({
                items: [
                    { id: "a", depends_on: [] },
                    { id: "b", depends_on: ["a"] },
                    { id: "c", depends_on: ["b"] }
                ],
                maxParallel: 1,
                executor: async item => {
                    ran.push(item.id);
                    if (item.id === "b") {
                        return { status: "failed", on_failure: "stop" };
                    }
                    return { status: "done" };
                },
                stopReason: (item, wrapped) =>
                    wrapped.result &&
                    wrapped.result.status === "failed" &&
                    wrapped.result.on_failure === "stop"
                        ? "hook " + item.id + " failed with on_failure: stop"
                        : null,
                skipItem: async (item, reason) => {
                    skipped.push(item.id);
                    return {
                        id: item.id,
                        status: "skipped",
                        ok: false,
                        skipped: true,
                        skipped_by: "on_failure_stop",
                        reason
                    };
                }
            });

        assert.deepEqual(ran, ["a", "b"]);
        assert.deepEqual(skipped, ["c"]);

        const c = executed.find(entry => entry.id === "c");
        assert.equal(c.success, false, "a skipped item must not publish success");
        assert.equal(c.skipped, true);
        assert.equal(c.result.skipped_by, "on_failure_stop");
    });


    await test("a stop skips items never dispatched for lack of a slot", async () => {

        const ran = [];
        const skipped = [];

        await runtime.executeDependencyGraph({
            items: [
                { id: "x", depends_on: [] },
                { id: "y", depends_on: [] },
                { id: "z", depends_on: [] }
            ],
            maxParallel: 2,
            executor: async item => {
                ran.push(item.id);
                if (item.id === "x") {
                    /* resolves on the microtask queue, before y */
                    return { status: "failed", on_failure: "stop" };
                }
                /* y is slow: it is still running when x reports the stop */
                return new Promise(resolve =>
                    setImmediate(() => resolve({ status: "done" })));
            },
            stopReason: (item, wrapped) =>
                wrapped.result &&
                wrapped.result.status === "failed" &&
                wrapped.result.on_failure === "stop"
                    ? "hook " + item.id + " failed with on_failure: stop"
                    : null,
            skipItem: async (item, reason) => {
                skipped.push(item.id);
                return {
                    id: item.id,
                    status: "skipped",
                    ok: false,
                    skipped: true,
                    skipped_by: "on_failure_stop",
                    reason
                };
            }
        });

        /* x and y occupied both slots; z was never dispatched once x stopped,
           so it is skipped rather than run — this is the race the graph must
           honour, and y (already in flight) still finishes normally. */
        assert.deepEqual(ran, ["x", "y"]);
        assert.deepEqual(skipped, ["z"]);
    });
};
