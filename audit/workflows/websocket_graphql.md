# WebSocket / GraphQL Workflow

- Workflow: websocket_graphql
- Description: WebSocket and GraphQL transport handlers used by `semantic-engine` worker/gateway.
- Representative files:
  - semantic-engine/src/gateway/GatewayServer.ts
  - semantic-engine/src/cli/commands/worker-command.ts
  - semantic-engine/src/server/wsProjectChannel.ts

## Status
- Core files located and many entries marked `DONE` in `audit/manifest/entrypoints.tsv`.
- Generated/dist and node_modules artifacts marked `OUT_OF_SCOPE`.

## Next steps
- Link each DONE entry to a per-workflow card with handler details (source:line) if downstream consumers require it.
