# Test layout

The Phase 29 test suite is organized by the boundary it protects. Test files
are executable Node scripts (there is intentionally no test runner dependency),
and each script keeps the historical `ok`/`FAIL` output and exit-code contract.

```text
test/
├── contracts/        public action, event, prompt, tool, API, persistence, discussion contracts
├── prompt/           prompt builder and request differential tests
├── runtime/          extracted runtime engine and legacy runtime regression suite
├── actions/          action parser unit tests
├── context/          context and archive regression tests
├── tools/            filesystem, process, project and tool-runtime tests
├── mcp/              standard MCP client tests
├── web/              web server regression and route-boundary tests
├── ui/               browser console tests
├── projects/         registry/API and project-run acceptance tests
├── discussion/       discussion engine and project transcript tests
├── persistence/      JSONL journal/eventstore and repository tests
├── hooks/            hook boundary and legacy hook regression tests
├── policy/           policy/approval boundary tests
├── events/           event boundary tests
├── application/      application lifecycle tests
├── cli/              CLI module unit tests
├── e2e/              full runtime, CLI and REPL acceptance tests
└── mvp/              multi-project MVP acceptance tests
```

The former root-level monolith suites were moved without changing their
assertions:

- `runtime.test.js` → `runtime/runtime.test.js`
- `tools.test.js` → `tools/tools.test.js`
- `hooks.test.js` → `hooks/legacy.test.js`
- `journal.test.js`, `eventstore.test.js` → `persistence/`
- `mcp.test.js` and generic MCP contract tests → `mcp/`
- `archive.test.js` → `context/archive.test.js`
- `project-run.test.js` → `projects/project-run.test.js`
- `e2e.test.js`, `cli.test.js`, `interactive.test.js` → `e2e/`
- `ui.test.js` → `ui/ui.test.js`
- `discussion.test.js` → `discussion/discussion.test.js`
- `web.test.js` → `web/web.test.js`

`npm test` retains the established serial order. Focused domain commands are
available through the `test:*` scripts in `package.json`; `test:contracts`
executes all public-boundary contract suites.
