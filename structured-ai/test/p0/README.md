# P0 regression tests

Each file locks the acceptance criteria of one P0 roadmap item.
They assert the **desired** behaviour, so they are expected to FAIL on the
current `main` and turn green as each P0 item is fixed.

| File | Item |
|------|------|
| p01.test.js | P0-1 Workspace trust / locked security settings |
| p02.test.js | P0-2 Policy on every path, deny-by-default |
| p03.test.js | P0-3 Path normalization and symlink safety |
| p04.test.js | P0-4 Web server robustness and token scoping |
| p05.test.js | P0-5 Secret isolation and redaction |
| p06.test.js | P0-6 MCP stdio spec compliance and stream robustness |
| p07.test.js | P0-7 Runtime reliability |

Run one: `node test/p0/p01.test.js`
