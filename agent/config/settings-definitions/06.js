"use strict";

/* Agent quality settings (roadmap group 5: P3-03 .. P3-09). */

module.exports = [
    {
        "key": "GIT_ALLOW_FORCE_PUSH",
        "group": "tools",
        "type": "boolean",
        "default": false,
        "description": "Whether git_push may be asked for force: true (sent as --force-with-lease). Off: every force push is refused, approved or not (roadmap P3-04)."
    },
    {
        "key": "GIT_WORKTREE_ROOTS",
        "group": "tools",
        "type": "string",
        "default": "",
        "description": "Comma-separated absolute folders git_worktree may create worktrees in, besides the workspace itself (roadmap P3-04). A path outside both is refused."
    },
    {
        "key": "RUN_SNAPSHOTS",
        "group": "persistence",
        "type": "boolean",
        "default": true,
        "description": "Before and after every run in a git workspace, record the whole working tree under refs/structured-ai/runs/<run> without touching the branch or the index, so a task can be diffed and reverted as a unit (roadmap P3-09)."
    },
    {
        "key": "MAX_RUN_COST_USD",
        "group": "budget",
        "type": "number",
        "default": 0,
        "min": 0,
        "description": "Dollar cap for one run, from the token usage the endpoint reports and the model's price (roadmap P3-05). 0: no cap; the cost is still counted and shown."
    },
    {
        "key": "MODEL_PRICES",
        "group": "budget",
        "type": "string",
        "default": "",
        "description": "JSON object of extra or corrected prices in dollars per million tokens, by model name or prefix: {\"my-model\": {\"input\": 0.5, \"output\": 1.5}}. Merged over the built-in table."
    },
    {
        "key": "GOAL_MAX_CHECKS",
        "group": "budget",
        "type": "number",
        "default": 3,
        "min": 0,
        "max": 20,
        "description": "How many times a run with a goal is sent back to work when its final answer does not meet the goal (roadmap P3-05). 0 checks the goal but never sends it back."
    },
    {
        "key": "PROJECT_RULES_ENABLED",
        "group": "context",
        "type": "boolean",
        "default": true,
        "description": "Read rule files from .agent/rules, .claude/rules and .cursor/rules (roadmap P3-06). A rule with globs front matter reaches the model only once the agent works on a matching file; one without globs always applies."
    },
    {
        "key": "PROJECT_RULES_MAX_CHARS",
        "group": "context",
        "type": "number",
        "default": 12000,
        "min": 500,
        "max": 200000,
        "description": "Most characters of project rules placed in one request."
    },
    {
        "key": "REVIEW_MAX_DIFF_CHARS",
        "group": "context",
        "type": "number",
        "default": 60000,
        "min": 2000,
        "max": 1000000,
        "description": "Longest diff the reviewer reads in one review (roadmap P3-08); a longer one is cut and the cut is reported."
    }
];
