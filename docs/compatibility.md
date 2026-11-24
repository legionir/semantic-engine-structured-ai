# Runtime compatibility

`package.json` declares Node.js `>=18`. The CI workflow exercises the supported
runtime on Node.js 20, 22, and 24 across its configured operating systems.

The MCP transports and optional server processes are configured independently;
this application does not bundle or require any particular MCP server.