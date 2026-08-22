/*
|--------------------------------------------------------------------------
| Semantic Engine (moved)
|--------------------------------------------------------------------------
|
| The engine used to own a private transport in this file: a stdio
| sidecar with Content-Length framing, an HTTP fallback, a pending call
| table and a timeout policy, none of which had anything to do with code
| intelligence and all of which any MCP server needs.
|
| That machinery now lives in agent/mcp, where every server gets it, and
| the engine is registered there as a built-in server that happens to be
| started by this runtime. What is left of the engine itself is in
| agent/mcp/semantic.js.
|
| This module stays because agent/tools/code.js, the tests and anything
| outside the runtime import it by path, and moving a file is not a
| reason to break them.
|--------------------------------------------------------------------------
*/

module.exports = require("../mcp/semantic");
