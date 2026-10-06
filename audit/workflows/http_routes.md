# HTTP Routes Workflow

- Workflow: http_routes
- Description: Handlers and route definitions for HTTP endpoints discovered across `semantic-engine` and `structured-ai`.
- Representative files:
  - semantic-engine/src/blueprint/ApiMapExtractor.ts
  - semantic-engine/test-fixture/src/api/express-app.ts
  - structured-ai/test/web/routes.test.js

## Status
- Many KEEP entries resolved and marked `DONE` in `audit/manifest/entrypoints.tsv`.
- Noisy framework and node_modules results marked `OUT_OF_SCOPE` but preserved for provenance.

## Next steps
- Review remaining KEEP entries and map any ambiguous handlers to owners.
- Aggregate per-route cards if needed.
