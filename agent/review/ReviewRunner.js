"use strict";

/*
|--------------------------------------------------------------------------
| Code review (roadmap P3-08)
|--------------------------------------------------------------------------
|
| A reviewer subagent reads one change set and answers with structured
| findings:
|
|   { summary, findings: [{ id, severity, file, line, title, detail,
|                           suggestion }] }
|
| Targets:
|
|   diff     everything not committed yet (staged, unstaged and new files),
|            read through a private index so the user's index is untouched
|   staged   only what is staged
|   branch   <base>...<ref> (base: the upstream default branch, else main /
|            master)
|   commit   one commit against its parent
|   pr       a GitHub pull request, read through the GitHub MCP server
|            (pull_request_read get_diff, or get_pull_request_diff); with
|            post: true the review is written back to the pull request
|            as a COMMENT review through the same server
|
| The reviewer is one request with its own instructions: it sees the diff,
| not the tools, which keeps a review fast, cheap and read-only. A finding
| that names a file outside the change set is kept but flagged
| (outside_diff), so a hallucinated path is visible.
|--------------------------------------------------------------------------
*/

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const settings = require("../config");
const childEnvironment = require("../tools/process/ChildEnvironment");

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const REF = /^(?!-)[A-Za-z0-9._\/~^@{}-]{1,200}$/;


function reviewError(code, message, status = 400) {

    return Object.assign(new Error(message), { code, status });
}


function git(cwd, argv, env = {}) {

    return new Promise((resolve, reject) => {
        execFile(
            "git",
            argv,
            {
                cwd,
                env: childEnvironment.build({ GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...env }),
                timeout: settings.get("GIT_TIMEOUT_MS"),
                maxBuffer: 64 * 1024 * 1024,
                windowsHide: true
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(reviewError("GIT_FAILED", `git ${argv.join(" ")} failed: ${String(stderr || error.message).trim()}`));
                    return;
                }
                resolve(stdout);
            }
        );
    });
}


function plainRef(value, field) {

    if (typeof value !== "string" || !REF.test(value) || value.includes("..")) {
        throw reviewError("INVALID_REF", `${field} is not a plain git ref: ${value}`);
    }

    return value;
}


async function assertRepository(root) {

    try {
        await git(root, ["rev-parse", "--git-dir"]);
    } catch {
        throw reviewError("NOT_A_REPOSITORY", `${root} is not a git repository; review the diff, a branch or a commit needs git (a pull request can still be reviewed through the GitHub MCP server).`, 409);
    }
}


async function hasHead(root) {

    try {
        await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
        return true;
    } catch {
        return false;
    }
}


async function workingDiff(root) {

    const indexPath = path.resolve(root, (await git(root, ["rev-parse", "--git-path", "index"])).trim());
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sai-review-"));
    const file = path.join(directory, "index");

    try {

        if (fs.existsSync(indexPath)) fs.copyFileSync(indexPath, file);

        const env = { GIT_INDEX_FILE: file };

        /* an exclude pathspec on an ignored folder makes `git add` fail */
        await git(root, ["add", "--all", "--", "."], env);
        await git(root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ".agent"], env);

        const base = (await hasHead(root)) ? "HEAD" : EMPTY_TREE;

        return await git(root, ["diff", "--cached", "--no-color", "--no-renames", base, "--", ".", ":(exclude).agent"], env);

    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}


async function defaultBase(root) {

    try {
        const head = (await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])).trim();
        if (head) return head;
    } catch {
        /* no remote default */
    }

    for (const candidate of ["main", "master"]) {
        try {
            await git(root, ["rev-parse", "--verify", "--quiet", candidate]);
            return candidate;
        } catch {
            /* try the next */
        }
    }

    throw reviewError("NO_BASE", "no base branch: name one (base) to compare the branch against");
}


/* GitHub owner/repo of the origin remote, for the MCP pull request tools */
async function githubRepository(root) {

    try {
        const url = (await git(root, ["remote", "get-url", "origin"])).trim();
        const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
        return match ? { owner: match[1], repo: match[2] } : null;
    } catch {
        return null;
    }
}


function mcpText(result) {

    if (typeof result === "string") return result;

    const content = result && Array.isArray(result.content) ? result.content : [];

    return content.filter(part => part && part.type === "text").map(part => part.text).join("\n");
}


/* the MCP entry for one of `names`, on a server whose name mentions github first */
function findMcpTool(manager, names, projectId) {

    let entries = [];

    try {
        entries = manager.catalogueEntries(projectId) || [];
    } catch {
        entries = [];
    }

    const matching = entries.filter(entry => names.includes(entry.tool));

    return matching.find(entry => /github/i.test(entry.server)) || matching[0] || null;
}


async function pullRequestDiff({ root, number, owner, repo, projectId, mcp }) {

    const manager = mcp || require("../mcp/McpManager").manager;
    const where = owner && repo ? { owner, repo } : await githubRepository(root);

    if (!where) {
        throw reviewError("NO_GITHUB_REPOSITORY", "owner/repo of the pull request are unknown: the origin remote is not on github.com; pass owner and repo");
    }

    const modern = findMcpTool(manager, ["pull_request_read"], projectId);
    const legacy = modern ? null : findMcpTool(manager, ["get_pull_request_diff"], projectId);

    if (!modern && !legacy) {
        throw reviewError("NO_GITHUB_MCP", "reviewing a pull request needs the GitHub MCP server (add it from the MCP catalog); it provides pull_request_read", 409);
    }

    const args = { owner: where.owner, repo: where.repo, pullNumber: number };
    const entry = modern || legacy;
    const result = await manager.call(entry.server, entry.tool, modern ? { method: "get_diff", ...args } : args);

    return { diff: mcpText(result), server: entry.server, ...where };
}


async function postPullRequestReview({ review, number, where, projectId, mcp }) {

    const manager = mcp || require("../mcp/McpManager").manager;
    const modern = findMcpTool(manager, ["pull_request_review_write"], projectId);
    const legacy = modern ? null : findMcpTool(manager, ["create_pull_request_review"], projectId);

    if (!modern && !legacy) {
        return { posted: false, reason: "the GitHub MCP server offers no review tool (pull_request_review_write)" };
    }

    const body = [
        `**Review by structured-ai** — ${review.summary}`,
        "",
        ...review.findings.map(item =>
            `- **${item.severity}** \`${item.file}${item.line ? `:${item.line}` : ""}\` ${item.title}${item.suggestion ? ` — ${item.suggestion}` : ""}`
        )
    ].join("\n");

    const args = { owner: where.owner, repo: where.repo, pullNumber: number, body, event: "COMMENT" };
    const entry = modern || legacy;

    await manager.call(entry.server, entry.tool, modern ? { method: "create", ...args } : args);

    return { posted: true, server: entry.server };
}


/* the diff text of a target, and the files it names */
async function collectDiff(root, { target = "diff", ref, base, number, owner, repo, projectId, mcp } = {}) {

    if (target === "pr") {

        const pr = Number(number);

        if (!Number.isInteger(pr) || pr <= 0) {
            throw reviewError("INVALID_PR", "number must be a pull request number");
        }

        const fetched = await pullRequestDiff({ root, number: pr, owner, repo, projectId, mcp });

        return { diff: fetched.diff, label: `pull request #${pr} (${fetched.owner}/${fetched.repo})`, where: fetched };
    }

    await assertRepository(root);

    if (target === "diff") {
        return { diff: await workingDiff(root), label: "uncommitted changes" };
    }

    if (target === "staged") {
        const against = (await hasHead(root)) ? "HEAD" : EMPTY_TREE;
        return { diff: await git(root, ["diff", "--cached", "--no-color", "--no-renames", against]), label: "staged changes" };
    }

    if (target === "branch") {
        const head = plainRef(ref || "HEAD", "ref");
        const from = base ? plainRef(base, "base") : await defaultBase(root);
        return { diff: await git(root, ["diff", "--no-color", "--no-renames", `${from}...${head}`]), label: `${head} against ${from}` };
    }

    if (target === "commit") {
        const commit = plainRef(ref || "HEAD", "ref");
        return { diff: await git(root, ["show", "--no-color", "--no-renames", "--format=commit %H%n%n%B", commit]), label: `commit ${commit}` };
    }

    throw reviewError("INVALID_TARGET", `target must be diff, staged, branch, commit or pr: ${target}`);
}


function filesOfDiff(diff) {

    const files = new Set();

    for (const match of String(diff).matchAll(/^\+\+\+ b\/(.+)$/gm)) files.add(match[1].trim());
    for (const match of String(diff).matchAll(/^diff --git a\/(.+?) b\//gm)) files.add(match[1].trim());

    return [...files];
}


function reviewerMessages(label, diff, files, focus) {

    return [
        {
            role: "system",
            content: [
                "You are a meticulous senior code reviewer. Review the change set below and report real problems only:",
                "bugs, security issues, data loss, race conditions, broken error handling, performance traps, missing tests for risky logic, and clear maintainability problems.",
                "Do not report style nits a formatter would fix, and do not praise.",
                "Each finding names the file (as it appears in the diff) and the line in the NEW version, says what is wrong and why, and gives a concrete fix.",
                `Severity is one of ${SEVERITIES.join(", ")}.`,
                "Answer with one JSON object and nothing else:",
                "{\"summary\": \"one paragraph\", \"findings\": [{\"severity\": \"high\", \"file\": \"path\", \"line\": 12, \"title\": \"short\", \"detail\": \"what and why\", \"suggestion\": \"the fix\"}]}.",
                "An empty findings list is a valid answer for a clean change."
            ].join(" ")
        },
        {
            role: "user",
            content: JSON.stringify({ change_set: label, files, ...(focus ? { focus } : {}), diff })
        }
    ];
}


function parseReview(text, files) {

    const raw = String(text || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start === -1 || end <= start) {
        throw reviewError("UNREADABLE_REVIEW", "the reviewer did not answer with a JSON object", 502);
    }

    let parsed;

    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    } catch (error) {
        throw reviewError("UNREADABLE_REVIEW", `the reviewer's answer is not valid JSON: ${error.message}`, 502);
    }

    const known = new Set(files);
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
        .filter(item => item && typeof item === "object")
        .slice(0, 100)
        .map((item, index) => {
            const severity = SEVERITIES.includes(String(item.severity).toLowerCase()) ? String(item.severity).toLowerCase() : "medium";
            const file = typeof item.file === "string" ? item.file.replace(/^[ab]\//, "").trim() : "";
            const line = Number.isInteger(Number(item.line)) && Number(item.line) > 0 ? Number(item.line) : null;
            return {
                id: `f${index + 1}`,
                severity,
                file,
                line,
                title: String(item.title || item.detail || "finding").slice(0, 200),
                detail: String(item.detail || "").slice(0, 2000),
                suggestion: String(item.suggestion || "").slice(0, 2000),
                ...(file && known.size > 0 && !known.has(file) ? { outside_diff: true } : {})
            };
        })
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

    return { summary: String(parsed.summary || "").slice(0, 3000), findings };
}


/*
| Runs one review. callAI(options) is the runtime's model request.
| Returns { target, label, files, truncated, summary, findings, posted? }.
*/
async function review({ root, callAI, target = "diff", ref, base, number, owner, repo, focus, post = false, projectId = null, mcp = null }) {

    const collected = await collectDiff(root, { target, ref, base, number, owner, repo, projectId, mcp });
    const limit = settings.get("REVIEW_MAX_DIFF_CHARS");
    const fullDiff = String(collected.diff || "");

    if (fullDiff.trim() === "") {
        return { target, label: collected.label, files: [], truncated: false, summary: "Nothing to review: the change set is empty.", findings: [] };
    }

    const truncated = fullDiff.length > limit;
    const diff = truncated ? fullDiff.slice(0, limit) : fullDiff;
    const files = filesOfDiff(fullDiff);

    const response = await callAI({
        messages: reviewerMessages(collected.label, diff, files, typeof focus === "string" ? focus.slice(0, 1000) : null),
        agentDefinition: { name: "reviewer", temperature: 0, max_tokens: 4000 },
        tools: undefined,
        responseFormat: null,
        role: "MAIN",
        scope: "reviewer"
    });

    const parsed = parseReview(response?.choices?.[0]?.message?.content, files);
    const result = { target, label: collected.label, files, truncated, ...parsed };

    if (target === "pr" && post === true) {
        result.posted = await postPullRequestReview({ review: result, number: Number(number), where: collected.where, projectId, mcp });
    }

    return result;
}


/* the task a fixing run gets for some findings */
function fixTask(findings, label = "the review") {

    const items = (Array.isArray(findings) ? findings : []).slice(0, 50);

    return [
        `Fix these findings from ${label}. For each one, check it is real first; fix it with the smallest correct change, and say which ones you did not fix and why.`,
        "",
        ...items.map((item, index) =>
            `${index + 1}. [${item.severity}] ${item.file}${item.line ? `:${item.line}` : ""} — ${item.title}${item.detail ? `\n   ${item.detail}` : ""}${item.suggestion ? `\n   Suggested fix: ${item.suggestion}` : ""}`
        )
    ].join("\n");
}


module.exports = {
    SEVERITIES,
    collectDiff,
    filesOfDiff,
    parseReview,
    review,
    fixTask
};
