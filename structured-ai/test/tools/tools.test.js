const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/*
| Every test runs against a throwaway workspace so the repository is
| never touched. WORKSPACE_ROOT must be set before the tools are loaded.
*/

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_TOOL_RESULT_CHARS = "20000";
process.env.PROCESS_SANDBOX_MODE = "test";

const tools = require("../../agent/tools");
const { WORKSPACE_ROOT } = require("../../agent/context/WorkspaceBoundary");

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

const run = (name, args) =>
    tools.executeTool(name, args, { agent: "test" });

async function rejects(promise, pattern) {

    try {

        await promise;

    } catch (error) {

        assert.match(error.message, pattern);

        return error;
    }

    throw new Error(
        `Expected rejection matching ${pattern}`
    );
}


const PROCESS_TREE_HELPER =
    path.join(__dirname, "../helpers/process-tree-worker.js");

function processTreeCommand(pidFile) {

    const quote = value => `"${value}"`;

    return [
        quote(process.execPath),
        quote(PROCESS_TREE_HELPER),
        quote(pidFile)
    ].join(" ");
}

function readTreePids(pidFile) {

    if (!fs.existsSync(pidFile)) {
        return [];
    }

    return fs.readFileSync(pidFile, "utf8")
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter(Number.isInteger);
}

function isProcessAlive(pid) {

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

async function waitForTreeStopped(pidFile) {

    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {

        const pids = readTreePids(pidFile);

        if (pids.length === 2 && !pids.some(isProcessAlive)) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`process tree is still alive: ${readTreePids(pidFile).join(", ")}`);
}

function cleanupTree(pidFile) {

    const pids = readTreePids(pidFile).reverse();

    if (process.platform === "win32" && pids.length) {

        try {
            execFileSync("taskkill", ["/pid", String(pids[pids.length - 1]), "/T", "/F"], { stdio: "ignore" });
        } catch {}

        return;
    }

    for (const pid of pids) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {}
    }
}


async function main() {

    console.log(`workspace: ${WORKSPACE_ROOT}\n`);

    /* ---------------------------------------------------------------- */
    console.log("filesystem");

    await test("fs_write creates a file and reports bytes", async () => {

        const result =
            await run("fs_write", {
                path: "src/app.js",
                content: "line1\nline2\nline3\n"
            });

        assert.equal(result.created, true);
        assert.equal(result.bytes_written, 18);
    });

    await test("fs_write append adds to the existing file", async () => {

        await run("fs_write", {
            path: "src/app.js",
            content: "line4\n",
            mode: "append"
        });

        const read =
            await run("fs_read", { path: "src/app.js" });

        assert.match(read.content, /line4/);
    });

    await test("fs_read supports line windows and tail", async () => {

        const window =
            await run("fs_read", {
                path: "src/app.js",
                offset: 1,
                limit: 2
            });

        assert.equal(window.content, "line2\nline3");
        assert.equal(window.partial, true);

        const tail =
            await run("fs_read", {
                path: "src/app.js",
                tail: 2
            });

        assert.match(tail.content, /line4/);
    });

    await test("fs_read reports binary files instead of returning bytes", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, "blob.bin"),
            Buffer.from([0x00, 0x01, 0x02, 0x00])
        );

        const result =
            await run("fs_read", { path: "blob.bin" });

        assert.equal(result.binary, true);
        assert.equal(result.content, null);
    });

    await test("fs_read_many isolates per-file failures", async () => {

        const result =
            await run("fs_read_many", {
                paths: ["src/app.js", "missing.txt"]
            });

        assert.equal(result.requested, 2);
        assert.equal(result.succeeded, 1);
        assert.equal(result.files[1].success, false);
    });

    await test("fs_list reports sizes when asked", async () => {

        const result =
            await run("fs_list", {
                path: ".",
                include_sizes: true
            });

        const entry =
            result.entries.find(
                item => item.name === "blob.bin"
            );

        assert.equal(entry.size_bytes, 4);
    });

    await test("fs_tree respects max_depth", async () => {

        await run("fs_mkdir", { path: "a/b/c/d" });

        const shallow =
            await run("fs_tree", {
                path: ".",
                max_depth: 1
            });

        assert.equal(shallow.depth_truncated, true);
    });

    await test("fs_stat returns type and mode", async () => {

        const result =
            await run("fs_stat", { path: "src/app.js" });

        assert.equal(result.type, "file");
        assert.equal(result.is_symlink, false);
        assert.match(result.mode, /^[0-7]{3}$/);
    });

    await test("fs_edit refuses an ambiguous match", async () => {

        await run("fs_write", {
            path: "dup.txt",
            content: "x\nx\n"
        });

        await rejects(
            run("fs_edit", {
                path: "dup.txt",
                old_text: "x",
                new_text: "y"
            }),
            /matched 2 times/
        );
    });

    await test("fs_edit applies the expected number of replacements", async () => {

        const result =
            await run("fs_edit", {
                path: "dup.txt",
                old_text: "x",
                new_text: "y",
                expected_replacements: 2
            });

        assert.equal(result.replacements, 2);
    });

    await test("fs_move refuses to overwrite unless told to", async () => {

        await run("fs_write", { path: "one.txt", content: "1" });
        await run("fs_write", { path: "two.txt", content: "2" });

        await rejects(
            run("fs_move", {
                source: "one.txt",
                destination: "two.txt"
            }),
            /already exists/
        );

        const moved =
            await run("fs_move", {
                source: "one.txt",
                destination: "two.txt",
                overwrite: true
            });

        assert.equal(moved.overwritten, true);
    });

    await test("fs_delete requires recursive for directories", async () => {

        await rejects(
            run("fs_delete", { path: "a" }),
            /Set recursive/
        );

        const deleted =
            await run("fs_delete", {
                path: "a",
                recursive: true
            });

        assert.equal(deleted.deleted, true);
    });

    await test("fs_info returns full metadata for a text file", async () => {

        await run("fs_write", {
            path: "meta.txt",
            content: "alpha beta\ngamma\n\ndelta\n"
        });

        const info =
            await run("fs_info", { path: "meta.txt" });

        assert.equal(info.type, "file");
        assert.equal(info.extension, ".txt");
        assert.equal(info.mime_type, "text/plain");
        assert.equal(info.size_bytes, 24);
        assert.equal(info.size_human, "24 B");

        assert.equal(info.content.binary, false);
        assert.equal(info.content.encoding, "utf-8");
        assert.equal(info.content.lines, 4);
        assert.equal(info.content.blank_lines, 1);
        assert.equal(info.content.words, 4);
        assert.equal(info.content.characters, 24);
        assert.equal(info.content.line_ending, "lf");
        assert.equal(info.content.ends_with_newline, true);
        assert.equal(info.content.longest_line_length, 10);

        assert.equal(info.hash.algorithm, "sha256");
        assert.match(info.hash.value, /^[a-f0-9]{64}$/);

        assert.ok(info.timestamps.created);
        assert.ok(info.timestamps.modified);
        assert.ok(info.timestamps.metadata_changed);
        assert.match(info.permissions.mode, /^[0-7]{3}$/);
        assert.equal(typeof info.ownership.uid, "number");
        assert.equal(typeof info.filesystem.inode, "number");
    });

    await test("fs_info detects CRLF, BOM and missing trailing newline", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, "crlf.txt"),
            Buffer.concat([
                Buffer.from([0xef, 0xbb, 0xbf]),
                Buffer.from("one\r\ntwo")
            ])
        );

        const info =
            await run("fs_info", { path: "crlf.txt" });

        assert.equal(info.content.line_ending, "crlf");
        assert.equal(info.content.has_bom, true);
        assert.equal(info.content.encoding, "utf-8-bom");
        assert.equal(info.content.lines, 2);
        assert.equal(info.content.ends_with_newline, false);
    });

    await test("fs_info reports binary files without text metrics", async () => {

        const info =
            await run("fs_info", { path: "blob.bin" });

        assert.equal(info.content.binary, true);
        assert.equal(info.content.encoding, null);
        assert.match(info.hash.value, /^[a-f0-9]{64}$/);
    });

    await test("fs_info summarises a directory", async () => {

        const info =
            await run("fs_info", { path: "src" });

        assert.equal(info.type, "directory");
        assert.ok(info.directory.files >= 1);
        assert.ok(info.directory.total_size_bytes > 0);
        assert.equal(info.content, undefined);
    });

    await test("fs_info can skip the hash and include a preview", async () => {

        const info =
            await run("fs_info", {
                path: "meta.txt",
                include_hash: false,
                include_preview: true,
                preview_lines: 1
            });

        assert.equal(info.hash, undefined);
        assert.equal(info.preview.head, "alpha beta");
    });

    await test("fs_info respects the workspace boundary", async () => {

        await rejects(
            run("fs_info", { path: "../../etc/passwd" }),
            /outside workspace/
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nworkspace boundary");

    await test("paths outside the workspace are rejected", async () => {

        await rejects(
            run("fs_read", { path: "../../etc/passwd" }),
            /outside workspace/
        );
    });

    await test("symlinks cannot escape the workspace", async () => {

        fs.symlinkSync(
            "/etc",
            path.join(WORKSPACE, "escape")
        );

        await rejects(
            run("fs_read", { path: "escape/passwd" }),
            /escapes the workspace/
        );
    });

    await test("the workspace root cannot be deleted", async () => {

        await rejects(
            run("fs_delete", { path: ".", recursive: true }),
            /workspace root cannot be deleted/
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nsearch");

    await test("search_start finds content and returns inline", async () => {

        const result =
            await run("search_start", {
                path: ".",
                query: "line2",
                wait_ms: 4000
            });

        assert.equal(result.status, "completed");
        assert.ok(result.results.length >= 1);
        assert.equal(result.results[0].line, 2);
    });

    await test("search_start honours file_pattern and files mode", async () => {

        const result =
            await run("search_start", {
                path: ".",
                query: "app",
                mode: "files",
                file_pattern: "*.js",
                wait_ms: 4000
            });

        assert.equal(result.results.length, 1);
        assert.match(result.results[0].path, /app\.js$/);
    });

    await test("search_list and search_stop manage sessions", async () => {

        const started =
            await run("search_start", {
                path: ".",
                query: "line",
                wait_ms: 4000
            });

        const list = await run("search_list", {});

        assert.ok(list.count >= 1);

        const stopped =
            await run("search_stop", {
                search_id: started.search_id
            });

        assert.ok(
            ["completed", "stopped"].includes(stopped.status)
        );

        const fetched =
            await run("search_get", {
                search_id: started.search_id
            });

        assert.equal(
            fetched.search_id,
            started.search_id
        );
    });

    await test("search_get rejects an unknown id", async () => {

        await rejects(
            run("search_get", { search_id: "nope" }),
            /Unknown search/
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nprocess");

    await test("terminal_exec returns a non-zero exit as data", async () => {

        const result =
            await run("terminal_exec", {
                command: "exit 3"
            });

        assert.equal(result.exit_code, 3);
        assert.equal(result.success, false);
    });

    await test("terminal_exec captures stdout", async () => {

        const result =
            await run("terminal_exec", {
                command: "echo hello-runtime"
            });

        assert.match(result.stdout, /hello-runtime/);
        assert.equal(result.success, true);
    });

    await test("terminal_exec times out instead of hanging", async () => {

        const result =
            await run("terminal_exec", {
                command: `"${process.execPath}" -e "setTimeout(() => {}, 5000)"`,
                timeout_ms: 300
            });

        assert.equal(result.timed_out, true);
    });

    await test("process_start, read, write and terminate a session", async () => {

        const started =
            await run("process_start", {
                command: `"${process.execPath}" -e "process.stdin.pipe(process.stdout)"`,
                wait_ms: 200
            });

        assert.equal(started.status, "running");

        await run("process_write", {
            process_id: started.process_id,
            input: "ping"
        });

        const output =
            await run("process_read", {
                process_id: started.process_id,
                wait_ms: 1000
            });

        assert.match(output.stdout, /ping/);

        const list =
            await run("process_list", {});

        assert.ok(list.count >= 1);

        const stopped =
            await run("process_terminate", {
                process_id: started.process_id
            });

        assert.notEqual(stopped.status, "running");
    });

    await test("an oversized result is shortened as a whole, not only per string", async () => {

        /* many short strings can still blow up a conversation */

        for (let index = 0; index < 300; index++) {

            fs.mkdirSync(
                path.join(WORKSPACE, "wide", `dir${index}`),
                { recursive: true }
            );

            for (let file = 0; file < 6; file++) {

                fs.writeFileSync(
                    path.join(WORKSPACE, "wide", `dir${index}`, `file${file}.ts`),
                    "x"
                );
            }
        }

        const tree =
            await run("fs_tree", { path: "wide", max_depth: 4 });

        const size =
            JSON.stringify(tree).length;

        assert.ok(
            size <= 45000,
            `the result was ${size} chars`
        );

        assert.equal(tree.result_truncated, true);
        assert.match(tree.truncation_note, /Narrow the request/);
    });

    await test("a batch read is bounded in total", async () => {

        const paths = [];

        for (let index = 0; index < 6; index++) {

            const name = `bulk${index}.txt`;

            fs.writeFileSync(
                path.join(WORKSPACE, name),
                "y".repeat(19000)
            );

            paths.push(name);
        }

        const result =
            await run("fs_read_many", { paths });

        assert.ok(
            JSON.stringify(result).length <= 45000,
            "the batch read was not bounded"
        );
    });

    await test("a small result is returned untouched", async () => {

        const listing =
            await run("fs_list", { path: "src" });

        assert.equal(listing.result_truncated, undefined);
        assert.equal(listing.output_truncated, undefined);
    });

    await test("a timed out command does not leave its children running", async () => {

        const pidFile = path.join(WORKSPACE, "timeout-tree-pids.txt");

        try {

            await run("terminal_exec", {
                command: processTreeCommand(pidFile),
                timeout_ms: 1000
            });

            assert.equal(readTreePids(pidFile).length, 2, "the test process tree did not start");
            await waitForTreeStopped(pidFile);

        } finally {
            cleanupTree(pidFile);
        }
    });

    await test("terminating a background process kills its whole tree", async () => {

        const pidFile = path.join(WORKSPACE, "background-tree-pids.txt");
        let started;

        try {

            started = await run("process_start", {
                command: processTreeCommand(pidFile),
                wait_ms: 400
            });

            assert.equal(readTreePids(pidFile).length, 2, "the test process tree did not start");

            await run("process_terminate", {
                process_id: started.process_id,
                grace_ms: 300
            });

            await waitForTreeStopped(pidFile);

        } finally {
            cleanupTree(pidFile);
        }
    });

    /* ---------------------------------------------------------------- */
    console.log("\nplan");

    await test("a plan is written, read back and summarised", async () => {

        const created =
            await run("plan_set", {
                objective: "Build the thing",
                phases: [
                    {
                        id: "P1",
                        title: "Core",
                        steps: [
                            { id: "P1.1", title: "first", agent: "implementation" },
                            { id: "P1.2", title: "second", agent: "testing" }
                        ]
                    },
                    {
                        id: "P2",
                        title: "Docs",
                        steps: ["write the readme"]
                    }
                ]
            });

        assert.equal(created.summary.steps, 3);
        assert.equal(created.summary.done, 0);
        assert.equal(created.summary.next_step.id, "P1.1");
        assert.equal(created.summary.next_step.agent, "implementation");
        assert.deepEqual(
            created.summary.assigned_open_steps.map(step => step.agent),
            ["implementation", "testing"]
        );
        assert.deepEqual(created.summary.routine.before_task, []);

        /* a bare string becomes a step with a generated id */
        const plan = await run("plan_get", {});

        assert.equal(plan.phases[1].steps[0].id, "P2.1");
        assert.equal(plan.phases[1].steps[0].title, "write the readme");
        assert.equal(plan.phases[1].steps[0].agent, null);
    });

    await test("an agent assignment survives plan_set and can be rerouted", async () => {

        let plan = await run("plan_get", {});

        assert.equal(plan.phases[0].steps[0].agent, "implementation");

        await run("plan_update", {
            id: "P1.1",
            agent: "code_analysis"
        });

        plan = await run("plan_get", {});

        assert.equal(plan.phases[0].steps[0].agent, "code_analysis");
        assert.equal(plan.summary.next_step.agent, "code_analysis");
    });

    await test("a step cannot be marked done without evidence", async () => {

        await rejects(
            run("plan_update", {
                updates: [
                    { id: "P1.1", status: "done" }
                ]
            }),
            /without evidence/
        );
    });

    await test("progress is recorded and the phase follows its steps", async () => {

        await run("plan_update", {
            updates: [
                {
                    id: "P1.1",
                    status: "done",
                    evidence: "tests passed"
                }
            ]
        });

        const afterFirst =
            await run("plan_get", { summary_only: true });

        assert.equal(afterFirst.summary.done, 1);
        assert.equal(afterFirst.summary.next_step.id, "P1.2");

        const plan = await run("plan_get", {});

        assert.equal(plan.phases[0].status, "in_progress");

        await run("plan_update", {
            updates: [
                {
                    id: "P1.2",
                    status: "done",
                    evidence: "tests passed"
                }
            ]
        });

        const finished = await run("plan_get", {});

        assert.equal(finished.phases[0].status, "done");
        assert.equal(finished.summary.complete, false);
    });

    await test("steps can be added to a phase before it starts", async () => {

        const updated =
            await run("plan_update", {
                add_steps: [
                    {
                        phase_id: "P2",
                        steps: [
                            { title: "add an example" }
                        ]
                    }
                ]
            });

        assert.equal(updated.summary.steps, 4);
    });

    await test("rewriting the plan keeps the progress already recorded", async () => {

        const rewritten =
            await run("plan_set", {
                objective: "Build the thing, revised",
                phases: [
                    {
                        id: "P1",
                        title: "Core",
                        steps: [
                            { id: "P1.1", title: "first" },
                            { id: "P1.2", title: "second" },
                            { id: "P1.3", title: "third" }
                        ]
                    }
                ]
            });

        assert.equal(rewritten.summary.done, 2);
        assert.equal(rewritten.summary.next_step.id, "P1.3");
    });

    await test("the plan is complete only when nothing is open", async () => {

        await run("plan_update", {
            updates: [
                {
                    id: "P1.3",
                    status: "done",
                    evidence: "done and verified"
                }
            ]
        });

        const summary =
            await run("plan_get", { summary_only: true });

        assert.equal(summary.summary.complete, true);
        assert.equal(summary.summary.next_step, null);
    });

    await test("an unknown id is rejected rather than silently ignored", async () => {

        await rejects(
            run("plan_update", {
                updates: [
                    { id: "nope", status: "done", evidence: "x" }
                ]
            }),
            /Unknown plan id/
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\ngit");

    await test("git tools operate on a repository", async () => {

        execFileSync("git", ["init", "-q", WORKSPACE]);

        execFileSync(
            "git",
            [
                "-C", WORKSPACE,
                "-c", "user.email=test@example.com",
                "-c", "user.name=test",
                "commit", "-q", "--allow-empty", "-m", "init"
            ]
        );

        const status =
            await run("git_status", { cwd: "." });

        assert.match(status.stdout, /##/);

        const log =
            await run("git_log", { cwd: ".", limit: 1 });

        assert.match(log.stdout, /init/);
    });

    await test("git_branch is immune to shell injection", async () => {

        const marker =
            path.join(WORKSPACE, "PWNED");

        await rejects(
            run("git_branch", {
                cwd: ".",
                action: "create",
                name: `x; touch ${marker}`
            }),
            /failed/
        );

        assert.equal(
            fs.existsSync(marker),
            false,
            "injected command must not run"
        );
    });

    await test("git_checkout is immune to shell injection", async () => {

        const marker =
            path.join(WORKSPACE, "PWNED2");

        await rejects(
            run("git_checkout", {
                cwd: ".",
                branch: `main; touch ${marker}`
            }),
            /failed/
        );

        assert.equal(
            fs.existsSync(marker),
            false,
            "injected command must not run"
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nruntime");

    await test("unimplemented tools are rejected", async () => {

        await rejects(
            run("does_not_exist", {}),
            /not implemented/
        );
    });

    await test("oversized output is truncated, not dropped", async () => {

        await run("fs_write", {
            path: "big.txt",
            content: "a".repeat(60000)
        });

        const result =
            await run("fs_read", { path: "big.txt" });

        assert.equal(result.output_truncated, true);
        assert.ok(result.content.length < 60000);
        assert.match(result.content, /truncated/);
    });

    await test("runtime_stats reports executed calls", async () => {

        const stats =
            await run("runtime_stats", {
                recent_limit: 5
            });

        assert.ok(stats.total_calls > 10);
        assert.ok(stats.tools.length > 5);
        assert.ok(stats.recent_calls.length <= 5);
        assert.ok(stats.files_changed.includes("src/app.js"));
        assert.ok(stats.files_changed.includes("big.txt"));
        assert.equal(stats.file_tracking_complete, false);
    });

    await test("registry, groups and implementations agree", async () => {

        const declared =
            require("../../agent/registry/tools.json")
                .map(tool => tool.function.name);

        const grouped =
            Object.values(
                require("../../agent/registry/tool_groups.json")
            ).flatMap(group => group.tools);

        const implemented =
            tools.implementedToolNames();

        assert.deepEqual(
            declared.filter(
                name => !implemented.includes(name)
            ),
            []
        );

        assert.deepEqual(
            implemented.filter(
                name => !declared.includes(name)
            ),
            []
        );

        assert.deepEqual(
            declared.filter(
                name => !grouped.includes(name)
            ),
            []
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nfriction found in a real run");

    await test("one plan update may be written flat", async () => {

        await run("plan_set", {
            objective: "finish the input package",
            phases: [
                {
                    id: "P1",
                    title: "input",
                    steps: [
                        { id: "P1.1", title: "write the manager" }
                    ]
                }
            ]
        });

        /*
        | A real run lost two iterations to this shape being refused.
        | The intent is unambiguous, so the runtime accepts it.
        */

        const flat =
            await run("plan_update", {
                id: "P1.1",
                status: "done",
                evidence: "npx tsc --build exited 0"
            });

        assert.deepEqual(flat.updated, ["P1.1"]);
        assert.equal(flat.summary.done, 1);

        /* a single object instead of an array is accepted too */
        const single =
            await run("plan_update", {
                updates: {
                    id: "P1.1",
                    status: "in_progress"
                }
            });

        assert.deepEqual(single.updated, ["P1.1"]);

        /* and an empty call still says what the shapes are */
        await rejects(
            run("plan_update", {}),
            /Provide updates, add_steps, or both/
        );
    });

    await test("a skill is an index in the prompt and full text on demand", async () => {

        const skills =
            require("../../agent/tools/skills");

        /* what every request carries */
        const index = skills._skillIndex();

        assert.ok(index.length >= 9);

        assert.deepEqual(
            Object.keys(index[0]).sort(),
            ["description", "name"]
        );

        assert.ok(
            JSON.stringify(index).length < 1500,
            `the index is ${JSON.stringify(index).length} chars`
        );

        /* what arrives when it is asked for */
        const loaded =
            await run("skill_get", { names: ["git", "planning"] });

        assert.deepEqual(
            loaded.skills.map(skill => skill.name),
            ["git", "planning"]
        );

        assert.ok(loaded.skills[0].instructions.length > 0);
        assert.ok(loaded.skills[0].constraints.length > 0);
        assert.ok(loaded.skills[0].tools.length > 0);

        /* a wrong name says what the right ones are */
        await rejects(
            run("skill_get", { name: "no_such_skill" }),
            /Unknown skill: no_such_skill\. Available skills: .*planning/
        );

        await rejects(
            run("skill_get", {}),
            /skill_get needs a name/
        );

        /* one known and one unknown returns the known one and says so */
        const partial =
            await run("skill_get", { names: ["git", "nope"] });

        assert.deepEqual(partial.missing, ["nope"]);
    });

    await test("the semantic-engine skill follows MCP availability", async () => {

        const skills = require("../../agent/tools/skills");
        const settings = require("../../agent/config");

        assert.ok(
            skills._skillIndex().some(item => item.name === "semantic_engine")
        );

        settings.set("MCP_ENABLED", false);
        try {
            assert.equal(
                skills._skillIndex().some(item => item.name === "semantic_engine"),
                false
            );

            await rejects(
                run("skill_get", { name: "semantic_engine" }),
                /Unknown skill: semantic_engine/
            );
        } finally {
            settings.reset("MCP_ENABLED");
        }

        assert.ok(
            skills._skillIndex().some(item => item.name === "semantic_engine")
        );
    });

    await test("a skill may carry data, and the data stays where it belongs", async () => {

        /*
        | A skill with resources lives in its own directory. The prompt
        | never sees the data, skill_get lists what exists, and
        | skill_read returns one slice of one file.
        */

        const loaded =
            await run("skill_get", { name: "ui_ux_pro_max" });

        const skill = loaded.skills[0];

        assert.deepEqual(
            skill.resources.map(resource => resource.id),
            ["spacing", "contrast"]
        );

        /* the listing carries titles, never the text */
        assert.equal(
            JSON.stringify(skill).includes("Every gap, padding"),
            false
        );

        assert.match(loaded.note, /skill_read/);

        const read =
            await run("skill_read", {
                name: "ui_ux_pro_max",
                resource: "spacing",
                limit: 5
            });

        assert.equal(read.resource, "spacing");
        assert.match(read.content, /4, 8, 12, 16, 24, 32, 48, 64/);
        assert.equal(read.end_line, 5);
        assert.ok(read.total_lines > 5);

        /* a resource is addressed by id, so a path cannot be smuggled in */
        await rejects(
            run("skill_read", {
                name: "ui_ux_pro_max",
                resource: "../../../etc/passwd"
            }),
            /Unknown resource .*It has: spacing/
        );

        await rejects(
            run("skill_read", {
                name: "ui_ux_pro_max",
                resource: "resources/spacing.md"
            }),
            /Unknown resource/
        );

        /* a skill without resources says so instead of failing oddly */
        await rejects(
            run("skill_read", { name: "git", resource: "anything" }),
            /has no resources/
        );

        /* and a data skill is in the index like any other */
        const skills = require("../../agent/tools/skills");

        assert.ok(
            skills._skillIndex().some(
                item => item.name === "ui_ux_pro_max"
            )
        );
    });

    await test("loading a skill is an event, attributed to the agent", async () => {

        const events =
            require("../../agent/events");

        const seen = [];

        const listen = event => seen.push(event);

        events.bus.on("skill:loaded", listen);

        try {

            await tools.executeTool(
                "skill_get",
                { name: "search" },
                { agent: "code_analysis#1" }
            );

        } finally {

            events.bus.off("skill:loaded", listen);
        }

        assert.equal(seen.length, 1);
        assert.equal(seen[0].agent, "code_analysis#1");
        assert.deepEqual(seen[0].skills, ["search"]);
        assert.ok(seen[0].chars > 0);
    });

    await test("a file search accepts a glob, not only a substring", async () => {

        /*
        | A real run asked for "*.test.*", got nothing, and spent two
        | more iterations guessing what this tool wanted.
        */

        await run("fs_write", {
            path: "tests/input.test.ts",
            content: "test"
        });

        await run("fs_write", {
            path: "vitest.config.ts",
            content: "config"
        });

        const glob =
            await run("search_start", {
                path: ".",
                query: "*.test.*",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            glob.results.map(item => item.path),
            ["tests/input.test.ts"]
        );

        const prefix =
            await run("search_start", {
                path: ".",
                query: "vitest.config*",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            prefix.results.map(item => item.path),
            ["vitest.config.ts"]
        );

        const withDirectory =
            await run("search_start", {
                path: ".",
                query: "tests/*.ts",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            withDirectory.results.map(item => item.path),
            ["tests/input.test.ts"]
        );

        /* a plain word still matches anywhere in the name */
        const substring =
            await run("search_start", {
                path: ".",
                query: "vitest",
                mode: "files",
                wait_ms: 3000
            });

        assert.deepEqual(
            substring.results.map(item => item.path),
            ["vitest.config.ts"]
        );
    });

    await test("a command that cds out of the workspace is refused", async () => {

        /*
        | "cd /workspace && npx tsc" on Windows fails inside the shell and
        | the agent reads the shell's error instead of its own mistake.
        */

        await rejects(
            run("terminal_exec", {
                command: "cd /workspace && npx tsc --build"
            }),
            /not inside the workspace.*cwd argument/s
        );

        /* a subdirectory of the workspace is still allowed */
        await run("fs_mkdir", { path: "sub" });

        const inside =
            await run("terminal_exec", {
                command: "cd sub && pwd",
                timeout_ms: 5000
            });

        assert.equal(inside.exit_code, 0);

        /* and an ordinary command is untouched */
        const plain =
            await run("terminal_exec", {
                command: "echo hello",
                timeout_ms: 5000
            });

        assert.match(plain.stdout, /hello/);
    });

    tools.shutdown();

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
