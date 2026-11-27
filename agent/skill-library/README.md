# Skill library

Third-party skills shipped with the runtime, one folder per library. Each skill is a
standard `SKILL.md` folder; `references/` holds the long text the skill points to, read
with `skill_read`.

| Library | Skills | Source | License |
|---|---|---|---|
| `persona/` | 190 role personas + 28 composite audits | [legionir/persona](https://github.com/legionir/persona) (`claude-code-format`, commit in `manifest.json`) | Apache-2.0 (`persona/LICENSE`) |

How the runtime uses them:

- **Every** library skill is available: `skill_get` loads it, and `/skill <name> <message>`
  sends its full text with that one message. A `/skill` message carries no skill index.
- Only the skills that are **sent to the AI** appear in the prompt's skill index. For a
  library that is its `manifest.json` `recommended` list unless the operator changes it
  (console: menu → Skills; API: `PUT /api/skills/prompt`). The choice is stored in
  `<data home>/skills-prompt.json`.
- A project's own skills (`.agent/skills`, `.claude/skills`) and the registry skills take
  precedence over a library skill with the same name.

Update a library from its source:

```bash
git clone --depth 1 -b claude-code-format https://github.com/legionir/persona /tmp/persona
node tools/sync-skill-library.js /tmp/persona
```
