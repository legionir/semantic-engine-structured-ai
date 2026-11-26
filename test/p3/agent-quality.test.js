"use strict";

/*
|--------------------------------------------------------------------------
| Agent quality (roadmap group 5: P3-03 .. P3-09)
|--------------------------------------------------------------------------
|
| Plan mode, git_push / git_worktree, goal and cost cap, path-scoped
| rules, the headless output validator, the reviewer and per-task git
| snapshots: unit checks of each module, then the acceptance scenarios
| through the real runtime (runAgent) and the console routes, with a stub
| model endpoint.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { removeTempDirs } = require("../helpers/cleanup");

/* a restored file comes back through git's checkout filters (CRLF under
   core.autocrlf on Windows), so contents are compared line by line */
const read = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const temp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const WORKSPACE = temp("p3-ws-");
const PLAIN = temp("p3-plain-");
const REMOTE = temp("p3-remote-");
const OUTSIDE = temp("p3-outside-");
const DATA_HOME = temp("p3-data-");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "gpt-4o";
process.env.AGENT_APPROVAL = "auto";
process.env.MAX_PLAN_CONTINUATIONS = "0";

const REPO = path.resolve(__dirname, "..", "..");

const git = (args, cwd = WORKSPACE) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function initRepository(root) {

    git(["init", "-q"], root);
    git(["config", "user.email", "test@example.com"], root);
    git(["config", "user.name", "test"], root);
    git(["config", "commit.gpgsign", "false"], root);
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(path.join(root, "keep.txt"), "keep\n");
    fs.writeFileSync(path.join(root, "edit.txt"), "before\n");
    fs.writeFileSync(path.join(root, "gone.txt"), "gone\n");
    git(["add", "-A"], root);
    git(["commit", "-qm", "init"], root);
}

initRepository(WORKSPACE);
git(["init", "-q", "--bare"], REMOTE);
git(["remote", "add", "origin", REMOTE]);

fs.mkdirSync(path.join(WORKSPACE, ".agent", "rules"), { recursive: true });
fs.writeFileSync(path.join(WORKSPACE, ".agent", "rules", "web.md"), "---\nglobs: web/**\n---\nRULE-WEB: use signals in the console.\n");
fs.writeFileSync(path.join(WORKSPACE, ".agent", "rules", "always.md"), "RULE-ALWAYS: keep functions small.\n");
fs.writeFileSync(path.join(WORKSPACE, ".agent", "rules", "listed.md"), "---\ndescription: release checklist\nalwaysApply: false\n---\nRULE-LISTED body\n");
fs.mkdirSync(path.join(WORKSPACE, "web"));
fs.mkdirSync(path.join(WORKSPACE, "agent"));
fs.writeFileSync(path.join(WORKSPACE, "web", "a.txt"), "web file\n");
fs.writeFileSync(path.join(WORKSPACE, "agent", "b.txt"), "agent file\n");
fs.writeFileSync(path.join(WORKSPACE, ".git", "info", "exclude"), ".agent/\nweb/\nagent/\n");

const results = [];

async function test(name, fn) {

    try {
        await fn();
        results.push(true);
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push(false);
        console.log(`  FAIL ${name}\n       ${error.stack || error.message}`);
    }
}


/* ------------------------------------------------------------ stub model */

const requests = [];

const textOf = message =>
    typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");

function reply(payload) {

    return {
        role: "assistant",
        content: JSON.stringify({ version: "1.0", delegations: null, data: null, error: null, ...payload })
    };
}

const final = text => reply({ action: "final", tool_calls: null, response: { type: "text", content: text } });

const call = (id, name, args) => reply({
    action: "tool_call",
    tool_calls: [{ id, name, arguments: args, depends_on: [] }],
    response: null
});

const counters = {};

function decide(body) {

    const messages = body.messages || [];
    const system = textOf(messages[0] || {});
    const all = messages.map(textOf).join("\n");
    const tools = messages.filter(message => message.role === "tool").map(textOf);

    if (system.includes("You check whether an autonomous coding agent met the goal")) {
        counters.goal = (counters.goal || 0) + 1;
        return { role: "assistant", content: JSON.stringify(counters.goal === 1 ? { met: false, reason: "goal.txt is missing" } : { met: true, reason: "goal.txt exists" }) };
    }

    if (system.includes("meticulous senior code reviewer")) {
        return {
            role: "assistant",
            content: JSON.stringify({
                summary: "One risky change.",
                findings: [
                    { severity: "low", file: "keep.txt", line: 1, title: "nit", detail: "minor", suggestion: "none" },
                    { severity: "high", file: "edit.txt", line: 1, title: "wrong value", detail: "after is wrong", suggestion: "write before" },
                    { severity: "bogus", file: "nowhere.js", line: "x", title: "invented" }
                ]
            })
        };
    }

    if (all.includes("[plan-mode]")) {
        if (tools.length === 0) return call("p1", "fs_write", { path: "planned.txt", content: "no\n" });
        if (tools.length === 1) return call("p2", "terminal_exec", { command: "git status" });
        if (tools.length === 2) return call("p3", "plan_set", { objective: "Write planned.txt", phases: [{ title: "Do it", steps: [{ title: "write planned.txt" }] }] });
        return final("Plan: write planned.txt");
    }

    if (all.includes("[approved]")) {
        if (tools.length === 0) return call("a1", "fs_write", { path: "planned.txt", content: "yes\n" });
        return final("done");
    }

    if (all.includes("[cost]")) {
        return call(`c${tools.length}`, "fs_read", { path: "keep.txt" });
    }

    if (all.includes("[goal]")) {
        if (all.includes("goal_not_met") && !tools.some(text => text.includes("goal.txt"))) {
            return call("g1", "fs_write", { path: "goal.txt", content: "goal\n" });
        }
        return final("I am done");
    }

    if (all.includes("[snapshot]")) {
        if (tools.length === 0) return call("s1", "fs_write", { path: "created.txt", content: "new\n" });
        if (tools.length === 1) return call("s2", "fs_write", { path: "edit.txt", content: "after\n" });
        if (tools.length === 2) return call("s3", "fs_delete", { path: "gone.txt" });
        return final("changed three files");
    }

    if (all.includes("[rules]")) {
        if (tools.length === 0) return call("r1", "fs_read", { path: "agent/b.txt" });
        if (tools.length === 1) return call("r2", "fs_read", { path: "web/a.txt" });
        return final("read both");
    }

    return final("ok");
}

const model = http.createServer((req, res) => {

    let raw = "";

    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        requests.push(body);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
            model: "gpt-4o",
            choices: [{ message: decide(body) }],
            usage: { prompt_tokens: 2000, completion_tokens: 500 }
        }));
    });
});


async function main() {

    console.log("agent quality (group 5)");

    await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;

    const settings = require(path.join(REPO, "agent", "config"));
    const gitTools = require(path.join(REPO, "agent", "tools", "git"));
    const { planModeRefusal } = require(path.join(REPO, "agent", "policy", "PlanModeGate"));
    const { PolicyEngine } = require(path.join(REPO, "agent", "policy"));
    const Pricing = require(path.join(REPO, "agent", "providers", "ModelPricing"));
    const { RunCost } = require(path.join(REPO, "agent", "runtime", "RunBudget"));
    const ScopedRules = require(path.join(REPO, "agent", "prompt", "ScopedRules"));
    const Headless = require(path.join(REPO, "agent", "cli", "HeadlessOutput"));
    const Review = require(path.join(REPO, "agent", "review", "ReviewRunner"));
    const Snapshots = require(path.join(REPO, "agent", "runtime", "RunSnapshots"));
    const RunGoal = require(path.join(REPO, "agent", "runtime", "RunGoal"));

    const toolContext = { root: WORKSPACE, agent: "main_agent" };

    /* -------------------------------------------------------- P3-04 */

    await test("git_worktree adds inside the workspace, lists, removes, and refuses outside paths", async () => {

        const added = await gitTools.git_worktree({ cwd: ".", action: "add", path: ".worktrees/feature", new_branch: "feature-x" }, toolContext);
        assert.ok(fs.existsSync(path.join(WORKSPACE, ".worktrees", "feature", "keep.txt")));
        assert.equal(added.path, path.join(WORKSPACE, ".worktrees", "feature"));

        const listed = await gitTools.git_worktree({ cwd: ".", action: "list" }, toolContext);
        assert.equal(listed.worktrees.length, 2);
        assert.equal(listed.worktrees[1].branch, "feature-x");

        await assert.rejects(
            gitTools.git_worktree({ cwd: ".", action: "add", path: path.join(OUTSIDE, "wt") }, toolContext),
            /outside the workspace and GIT_WORKTREE_ROOTS/
        );

        await assert.rejects(
            gitTools.git_worktree({ cwd: ".", action: "add", path: "../escape" }, toolContext),
            /outside the workspace/
        );

        await assert.rejects(gitTools.git_worktree({ cwd: ".", action: "remove", path: "." }, toolContext), /main worktree/);
        await assert.rejects(gitTools.git_worktree({ cwd: ".", action: "remove", path: "keep.txt" }, toolContext), /not a worktree/);

        await gitTools.git_worktree({ cwd: ".", action: "remove", path: ".worktrees/feature" }, toolContext);
        assert.equal(fs.existsSync(path.join(WORKSPACE, ".worktrees", "feature")), false);

        /* a GIT_WORKTREE_ROOTS folder is allowed */
        settings.set("GIT_WORKTREE_ROOTS", OUTSIDE);
        try {
            await gitTools.git_worktree({ cwd: ".", action: "add", path: path.join(OUTSIDE, "wt"), ref: "feature-x" }, toolContext);
            assert.ok(fs.existsSync(path.join(OUTSIDE, "wt", "keep.txt")));
            await gitTools.git_worktree({ cwd: ".", action: "remove", path: path.join(OUTSIDE, "wt") }, toolContext);
        } finally {
            settings.set("GIT_WORKTREE_ROOTS", "");
        }
    });

    await test("git_push pushes plainly, refuses force by default and every refspec trick", async () => {

        await gitTools.git_push({ cwd: ".", remote: "origin", branch: git(["branch", "--show-current"]), set_upstream: true }, toolContext);
        assert.equal(git(["rev-parse", "HEAD"]), git(["rev-parse", git(["branch", "--show-current"])], REMOTE));

        await assert.rejects(gitTools.git_push({ cwd: ".", force: true }, toolContext), /Force push is disabled/);
        await assert.rejects(gitTools.git_push({ cwd: ".", branch: "+main" }, toolContext), /not a plain name/);
        await assert.rejects(gitTools.git_push({ cwd: ".", branch: ":main" }, toolContext), /not a plain name/);
        await assert.rejects(gitTools.git_push({ cwd: ".", branch: "a:b" }, toolContext), /not a plain name/);
        await assert.rejects(gitTools.git_push({ cwd: ".", remote: "--receive-pack=x", branch: "main" }, toolContext), /not a plain name/);
    });

    await test("policy: git_push and worktree changes need approval, listing worktrees is free", () => {

        const engine = new PolicyEngine({
            policy: require(path.join(REPO, "agent", "registry", "policy.json")),
            toolGroups: require(path.join(REPO, "agent", "registry", "tool_groups.json"))
        });

        assert.equal(engine.evaluate("git_push", { cwd: "." }, "main_agent").decision, "require_approval");
        assert.equal(engine.evaluate("git_worktree", { cwd: ".", action: "add", path: "x" }, "main_agent").decision, "require_approval");
        assert.equal(engine.evaluate("git_worktree", { cwd: ".", action: "list" }, "main_agent").decision, "allow");
    });

    /* -------------------------------------------------------- P3-03 unit */

    await test("plan mode gate: writes refused, read-only work allowed", () => {

        for (const tool of ["fs_write", "fs_edit", "apply_patch", "fs_delete", "git_commit", "git_push", "process_start"]) {
            assert.match(planModeRefusal(tool, {}), /plan mode/, tool);
        }

        assert.equal(planModeRefusal("fs_read", { path: "x" }), null);
        assert.equal(planModeRefusal("plan_set", {}), null);
        assert.equal(planModeRefusal("terminal_exec", { command: "git status" }), null);
        assert.match(planModeRefusal("terminal_exec", { command: "rm -rf build" }), /read-only commands/);
        assert.equal(planModeRefusal("git_branch", { action: "list" }), null);
        assert.match(planModeRefusal("git_branch", { action: "create", name: "x" }), /plan mode/);
        assert.match(planModeRefusal("mcp_call", { tool: "x" }), /readOnlyHint/);
        assert.equal(planModeRefusal("mcp_call", { tool: "x" }, { catalogueEntry: () => ({ annotations: { readOnlyHint: true } }) }), null);
    });

    /* -------------------------------------------------------- P3-05 unit */

    await test("model prices: table, prefix, provider prefix, override, endpoint cost, unpriced", () => {

        const one = Pricing.costOf("gpt-4o-2024-08-06", { prompt_tokens: 1000000, completion_tokens: 1000000 });
        assert.equal(one.priced, true);
        assert.equal(one.cost_usd, 12.5);

        assert.equal(Pricing.costOf("openai/gpt-4o-mini", { prompt_tokens: 1000000, completion_tokens: 0 }).cost_usd, 0.15);
        assert.equal(Pricing.costOf("x", { prompt_tokens: 10, completion_tokens: 10, cost: 0.42 }).cost_usd, 0.42);

        const unknown = Pricing.costOf("llama-local", { prompt_tokens: 10, completion_tokens: 10 });
        assert.equal(unknown.priced, false);
        assert.equal(unknown.cost_usd, null);

        settings.set("MODEL_PRICES", JSON.stringify({ "llama-local": { input: 1, output: 2 } }));
        try {
            assert.equal(Pricing.costOf("llama-local", { prompt_tokens: 1000000, completion_tokens: 1000000 }).cost_usd, 3);
        } finally {
            settings.set("MODEL_PRICES", "");
        }

        const cost = new RunCost({ maxUsd: 1 });
        assert.equal(cost.add("gpt-4o", one), true);
        assert.equal(cost.snapshot().max_cost_usd, 1);
        assert.equal(new RunCost().cap(0), 0);
        assert.equal(new RunCost().cap(2), 2);
        assert.equal(new RunCost({ maxUsd: 0 }).cap(2), 0, "a run's own 0 means no cap");
    });

    await test("goal verdicts are parsed strictly", () => {

        assert.deepEqual(RunGoal.parseVerdict("sure: {\"met\": true, \"reason\": \"ok\"}"), { met: true, reason: "ok" });
        assert.equal(RunGoal.parseVerdict("{\"met\": \"yes\"}"), null);
        assert.equal(RunGoal.parseVerdict("no json"), null);
    });

    /* -------------------------------------------------------- P3-06 unit */

    await test("scoped rules: a web/** rule stays out while working in agent/", () => {

        assert.ok(ScopedRules.globToRegExp("web/**").test("web/app/x.js"));
        assert.ok(!ScopedRules.globToRegExp("web/**").test("agent/web/x.js"));
        assert.ok(ScopedRules.globToRegExp("*.tsx").test("web/app/x.tsx"));
        assert.ok(ScopedRules.globToRegExp("src/**/*.{js,ts}").test("src/a/b/c.ts"));
        assert.ok(ScopedRules.globToRegExp("src/**/*.{js,ts}").test("src/c.js"));

        const run = {};
        ScopedRules.noteToolCall(run, WORKSPACE, "fs_read", { path: "agent/b.txt" });

        const before = ScopedRules.rulesFor(WORKSPACE, run.touchedPaths);
        const texts = before.rules.map(rule => rule.content).join("\n");
        assert.ok(texts.includes("RULE-ALWAYS"));
        assert.ok(!texts.includes("RULE-WEB"), "the web rule is absent while working in agent/");
        assert.ok(!texts.includes("RULE-LISTED"));
        assert.equal(before.listed[0].path, ".agent/rules/listed.md");

        ScopedRules.noteToolCall(run, WORKSPACE, "apply_patch", { patch: "*** Begin Patch\n*** Update File: web/a.txt\n@@\n-x\n+y\n*** End Patch" });
        assert.ok(ScopedRules.rulesFor(WORKSPACE, run.touchedPaths).rules.some(rule => rule.content.includes("RULE-WEB")));

        ScopedRules.noteToolCall(run, WORKSPACE, "fs_read", { path: path.join(OUTSIDE, "x") });
        assert.ok(![...run.touchedPaths].some(item => item.includes("..")));
    });

    /* -------------------------------------------------------- P3-07 unit */

    await test("headless validator: types, required, enums, nested items, oneOf; fenced answers", () => {

        const schema = {
            type: "object",
            required: ["status", "items"],
            additionalProperties: false,
            properties: {
                status: { enum: ["ok", "fail"] },
                count: { type: "integer", minimum: 0 },
                items: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 } } } },
                id: { oneOf: [{ type: "string" }, { type: "integer" }] }
            }
        };

        assert.deepEqual(Headless.validate({ status: "ok", items: [{ name: "a" }], count: 2, id: 3 }, schema), []);

        const errors = Headless.validate({ status: "maybe", items: [{}], count: -1, extra: 1 }, schema);
        assert.ok(errors.some(item => /must be one of/.test(item)));
        assert.ok(errors.some(item => /\$\.items\[0\]: missing required property name/.test(item)));
        assert.ok(errors.some(item => /must be >= 0/.test(item)));
        assert.ok(errors.some(item => /property extra is not allowed/.test(item)));

        assert.deepEqual(Headless.extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
        assert.equal(Headless.checkOutput({ response: { content: "not json" } }, schema).ok, false);
        assert.equal(Headless.budgetStop({ cancelledReason: "cost_cap" }), "budget");
        assert.equal(Headless.budgetStop(new Error("Run stopped at x: the run budget of 10 ms (MAX_RUN_MS) was spent")), "budget");
        assert.equal(Headless.budgetStop(new Error("boom")), null);
    });

    /* -------------------------------------------------------- P3-08 unit */

    await test("reviewer: diff target includes new files without touching the index; findings normalised", async () => {

        fs.writeFileSync(path.join(WORKSPACE, "edit.txt"), "after\n");
        fs.writeFileSync(path.join(WORKSPACE, "brand-new.txt"), "fresh\n");
        const indexBefore = git(["diff", "--cached", "--name-only"]);

        const collected = await Review.collectDiff(WORKSPACE, { target: "diff" });
        assert.ok(collected.diff.includes("brand-new.txt"));
        assert.ok(collected.diff.includes("+after"));
        assert.ok(!collected.diff.includes(".agent/rules"), "the runtime folder is not reviewed");
        assert.equal(git(["diff", "--cached", "--name-only"]), indexBefore, "the user's index is untouched");

        const commit = await Review.collectDiff(WORKSPACE, { target: "commit", ref: "HEAD" });
        assert.ok(commit.diff.includes("keep.txt"));

        await assert.rejects(Review.collectDiff(WORKSPACE, { target: "commit", ref: "--output=/tmp/x" }), /not a plain git ref/);
        await assert.rejects(Review.collectDiff(PLAIN, { target: "diff" }), error => error.code === "NOT_A_REPOSITORY");
        await assert.rejects(Review.collectDiff(WORKSPACE, { target: "pr", number: 5, mcp: { catalogueEntries: () => [] } }), error => error.code === "NO_GITHUB_REPOSITORY" || error.code === "NO_GITHUB_MCP");

        const parsed = Review.parseReview(JSON.stringify({
            summary: "s",
            findings: [{ severity: "LOW", file: "b/x.js", line: 3, title: "t" }, { severity: "critical", file: "y.js", line: "?", title: "u" }]
        }), ["x.js"]);
        assert.equal(parsed.findings[0].severity, "critical");
        assert.equal(parsed.findings[0].line, null);
        assert.equal(parsed.findings[0].outside_diff, true);
        assert.equal(parsed.findings[1].file, "x.js");

        fs.writeFileSync(path.join(WORKSPACE, "edit.txt"), "before\n");
        fs.rmSync(path.join(WORKSPACE, "brand-new.txt"));
    });

    await test("reviewer: a pull request is read and answered through the GitHub MCP server", async () => {

        const calls = [];
        const mcp = {
            catalogueEntries: () => [
                { server: "github", tool: "pull_request_read" },
                { server: "github", tool: "pull_request_review_write" }
            ],
            call: async (server, tool, args) => {
                calls.push({ server, tool, args });
                return tool === "pull_request_read"
                    ? { content: [{ type: "text", text: "diff --git a/edit.txt b/edit.txt\n--- a/edit.txt\n+++ b/edit.txt\n@@ -1 +1 @@\n-before\n+after\n" }] }
                    : { content: [{ type: "text", text: "ok" }] };
            }
        };

        const result = await Review.review({
            root: WORKSPACE,
            target: "pr",
            number: 7,
            owner: "acme",
            repo: "app",
            post: true,
            mcp,
            callAI: async () => ({ choices: [{ message: { content: "{\"summary\":\"fine\",\"findings\":[{\"severity\":\"medium\",\"file\":\"edit.txt\",\"line\":1,\"title\":\"check\"}]}" } }] })
        });

        assert.equal(calls[0].args.method, "get_diff");
        assert.equal(calls[0].args.pullNumber, 7);
        assert.equal(result.findings[0].file, "edit.txt");
        assert.equal(result.posted.posted, true);
        assert.equal(calls[1].tool, "pull_request_review_write");
        assert.match(calls[1].args.body, /edit\.txt:1/);
        assert.match(Review.fixTask(result.findings, "PR #7"), /1\. \[medium\] edit\.txt:1 — check/);
    });

    /* -------------------------------------------------------- P3-09 unit */

    await test("snapshots: a project without git gets a clear message", async () => {

        await assert.rejects(Snapshots.capture(PLAIN, "run-x", "before"), error => error.code === "NOT_A_REPOSITORY" && /not a git repository/.test(error.message) && /git init/.test(error.message));
        assert.equal(await Snapshots.captureQuietly(PLAIN, "run-x", "before"), null);
    });

    /* ------------------------------------------------- runtime scenarios */

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const events = require(path.join(REPO, "agent", "events"));
    const seen = [];

    events.bus.on("event", event => seen.push(event));

    await test("P3-03 plan mode: every write is refused with a policy error, the plan is kept", async () => {

        const action = await runtime.runAgent({ task: "[plan-mode] add planned.txt", plan_mode: true });

        assert.equal(action.error, null);
        assert.equal(fs.existsSync(path.join(WORKSPACE, "planned.txt")), false, "nothing was written");

        const planRequests = requests.filter(body => (body.messages || []).map(textOf).join("\n").includes("[plan-mode]"));
        const last = planRequests.at(-1).messages;
        const toolTexts = last.filter(message => message.role === "tool").map(textOf);

        assert.match(toolTexts[0], /plan mode: the plan has not been approved yet/);
        assert.match(toolTexts[0], /PolicyDenied|policy/i);
        assert.ok(!/plan mode/.test(toolTexts[1]), "a read-only command runs in plan mode");
        assert.ok(last.some(message => message.role === "system" && textOf(message).includes("Plan mode is on")), "the agent is told it plans");

        const plan = runtime.currentPlanSummary();
        assert.equal(plan.exists, true);
        assert.equal(plan.objective, "Write planned.txt");
    });

    await test("P3-03 after approval the same plan is executed without plan mode", async () => {

        const action = await runtime.runAgent({ task: "[approved] The plan is approved. Execute it." });

        assert.equal(action.error, null);
        assert.equal(read(path.join(WORKSPACE, "planned.txt")), "yes\n");

        const body = requests.filter(item => (item.messages || []).map(textOf).join("\n").includes("[approved]"))[0];
        const context = body.messages.map(textOf).find(text => text.includes("\"runtime_context\""));
        assert.ok(context.includes("Write planned.txt"), "the approved run sees the plan");
        assert.ok(!context.includes("Plan mode is on"));
        fs.rmSync(path.join(WORKSPACE, "planned.txt"));
    });

    await test("P3-05 the cost cap stops the run with a report; the cost is published", async () => {

        seen.length = 0;

        let failure = null;

        try {
            await runtime.runAgent({ task: "[cost] read forever", max_cost_usd: 0.02 });
        } catch (error) {
            failure = error;
        }

        assert.ok(failure, "the run stopped");
        assert.equal(failure.cancelledReason, "cost_cap");
        assert.match(failure.message, /cost cap of \$0\.02 was reached: \$0\.0\d+ spent on \d+ model request/);

        const costs = seen.filter(event => event.type === "run:cost");
        assert.ok(costs.length >= 2);
        assert.equal(costs[0].request_cost_usd, 0.01, "2000 input + 500 output tokens of gpt-4o");
        assert.ok(costs.at(-1).cost_usd >= 0.02);
        assert.equal(seen.filter(event => event.type === "run:cost_cap").length, 1);
    });

    await test("P3-05 a goal not met sends the agent back; met ends the run", async () => {

        seen.length = 0;

        const action = await runtime.runAgent({ task: "[goal] make goal.txt", goal: "goal.txt exists in the workspace" });

        assert.equal(action.error, null);
        assert.ok(fs.existsSync(path.join(WORKSPACE, "goal.txt")));

        const verdicts = seen.filter(event => event.type === "run:goal").map(event => event.outcome);
        assert.deepEqual(verdicts, ["continue", "met"]);

        const end = seen.find(event => event.type === "run:end");
        assert.equal(end.goal.met, true);
        assert.ok(end.cost.cost_usd > 0);
        fs.rmSync(path.join(WORKSPACE, "goal.txt"));
    });

    let snapshotRun = null;

    await test("P3-09 a run is recorded under hidden refs; branch, HEAD and index untouched", async () => {

        seen.length = 0;
        git(["add", "keep.txt"]);
        const head = git(["rev-parse", "HEAD"]);
        const branch = git(["branch", "--show-current"]);
        fs.writeFileSync(path.join(WORKSPACE, "keep.txt"), "keep\nstaged\n");
        git(["add", "keep.txt"]);
        const staged = git(["diff", "--cached", "--name-only"]);

        const action = await runtime.runAgent({ task: "[snapshot] change three files" });
        assert.equal(action.error, null);

        const snapshots = seen.filter(event => event.type === "run:snapshot");
        assert.deepEqual(snapshots.map(event => event.phase), ["before", "after"]);
        snapshotRun = snapshots[0].run_id;

        assert.equal(git(["rev-parse", "HEAD"]), head);
        assert.equal(git(["branch", "--show-current"]), branch);
        assert.equal(git(["diff", "--cached", "--name-only"]), staged);
        assert.ok(git(["for-each-ref", "refs/structured-ai/runs"]).includes(snapshotRun));
    });

    /* ---------------------------------------------------- console routes */

    const { createServer } = require(path.join(REPO, "web", "server.js"));
    const projects = require(path.join(REPO, "agent", "projects", "index.js"));
    projects.registry().register({ id: "prj-plain", name: "Plain", rootPath: PLAIN });

    const web = createServer(runtime, { apiRateLimit: 100000 });
    const address = await web.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { "content-type": "application/json", authorization: `Bearer ${web.token}` };

    const api = async (method, url, body) => {
        const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    };

    await test("P3-09 the console lists a task, shows its diff and reverts it exactly", async () => {

        const listed = await api("GET", "/api/snapshots");
        assert.equal(listed.status, 200);
        assert.ok(listed.body.runs.some(run => run.run_id === snapshotRun && run.before && run.after));

        const diff = await api("GET", `/api/snapshots/${encodeURIComponent(snapshotRun)}`);
        assert.equal(diff.status, 200);
        assert.deepEqual(diff.body.files.map(file => `${file.status} ${file.path}`).sort(), ["A created.txt", "D gone.txt", "M edit.txt"]);
        assert.match(diff.body.patch, /\+after/);

        /* a file changed again after the run is a conflict */
        fs.writeFileSync(path.join(WORKSPACE, "edit.txt"), "edited later\n");
        const conflict = await api("POST", `/api/snapshots/${encodeURIComponent(snapshotRun)}/revert`, {});
        assert.equal(conflict.status, 409);
        assert.deepEqual(conflict.body.conflicts, ["edit.txt"]);
        assert.equal(read(path.join(WORKSPACE, "edit.txt")), "edited later\n");

        const reverted = await api("POST", `/api/snapshots/${encodeURIComponent(snapshotRun)}/revert`, { force: true });
        assert.equal(reverted.status, 200);
        assert.equal(fs.existsSync(path.join(WORKSPACE, "created.txt")), false, "a created file is removed");
        assert.equal(read(path.join(WORKSPACE, "edit.txt")), "before\n", "an edited file is restored");
        assert.equal(read(path.join(WORKSPACE, "gone.txt")), "gone\n", "a deleted file is back");
        assert.equal(read(path.join(WORKSPACE, "keep.txt")), "keep\nstaged\n", "an untouched file stays");
    });

    await test("P3-09 a project without git answers 409 with a clear message", async () => {

        const result = await api("GET", "/api/snapshots?projectId=prj-plain");
        assert.equal(result.status, 409);
        assert.equal(result.body.code, "NOT_A_REPOSITORY");
        assert.match(result.body.error, /not a git repository/);
    });

    await test("P3-08 the console review returns sorted structured findings and a fix task", async () => {

        fs.writeFileSync(path.join(WORKSPACE, "edit.txt"), "after\n");

        const result = await api("POST", "/api/review", { target: "diff" });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.findings.map(item => item.severity), ["high", "medium", "low"]);
        assert.equal(result.body.findings[0].file, "edit.txt");
        assert.equal(result.body.findings[1].outside_diff, true);
        assert.match(result.body.fix_task, /\[high\] edit\.txt:1 — wrong value/);

        const bad = await api("POST", "/api/review", { target: "nope" });
        assert.equal(bad.status, 400);

        fs.writeFileSync(path.join(WORKSPACE, "edit.txt"), "before\n");
    });

    await test("P3-03 / P3-05 the task routes validate and carry plan_mode, goal and max_cost_usd", async () => {

        assert.equal((await api("POST", "/api/tasks", { task: "x", plan_mode: "yes" })).status, 400);
        assert.equal((await api("POST", "/api/tasks", { task: "x", max_cost_usd: -1 })).status, 400);

        seen.length = 0;
        const started = await api("POST", "/api/tasks", { task: "[plan-mode] again", plan_mode: true });
        assert.equal(started.status, 202);

        const deadline = Date.now() + 20000;
        let status = null;
        while (Date.now() < deadline && !status) {
            status = seen.find(event => event.type === "run:status" && event.status !== "running");
            await new Promise(done => setTimeout(done, 50));
        }

        assert.ok(status, "the turn ended");
        assert.equal(status.status, "done");
        assert.equal(status.plan_mode, true, "the panel is told to offer approve / revise");
        assert.equal(fs.existsSync(path.join(WORKSPACE, "planned.txt")), false);
    });

    await test("P3-06 a scoped rule reaches the model only after a matching file is touched", async () => {

        const before = requests.length;
        const action = await runtime.runAgent({ task: "[rules] read two files" });
        assert.equal(action.error, null);

        const runRequests = requests.slice(before).filter(body => (body.messages || []).map(textOf).join("\n").includes("[rules]"));
        const contextOf = body => body.messages.map(textOf).find(text => text.includes("\"runtime_context\"")) || "";

        assert.ok(contextOf(runRequests[0]).includes("RULE-ALWAYS"));
        assert.ok(!contextOf(runRequests[0]).includes("RULE-WEB"));
        assert.ok(!contextOf(runRequests[1]).includes("RULE-WEB"), "reading agent/ does not bring the web rule");
        assert.ok(contextOf(runRequests[2]).includes("RULE-WEB"), "reading web/ does");
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    try {
        if (typeof web.closeAllConnections === "function") web.closeAllConnections();
        await Promise.race([new Promise(done => web.close(done)), new Promise(done => setTimeout(done, 1000))]);
        await runtime.shutdown?.();
    } catch {
        /* best effort */
    }

    model.close();

    await removeTempDirs(runtime, WORKSPACE, PLAIN, REMOTE, OUTSIDE, DATA_HOME);

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
