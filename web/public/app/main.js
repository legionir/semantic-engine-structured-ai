/*
 * Browser ESM entry point.
 *
 * auth-gate.js imports this file once the console is unlocked. It loads the
 * console controller, which mounts the views on the store, and exposes the
 * store and the module graph for diagnostics and extensions. There is no
 * build step: every import below is a relative URL the server serves as-is.
 */

import * as store from "./store.js";
import * as runtimeState from "./runtime-state.js";
import * as executionModel from "./execution-model.js";
import * as conversationModel from "./conversation-model.js";
import * as discussionModel from "./discussion-model.js";
import * as approvalState from "./approval-state.js";
import * as chat from "./chat.js";
import * as execution from "./execution-view.js";
import * as events from "./event-view.js";
import * as plan from "./plan-view.js";
import * as discussion from "./discussion-view.js";
import * as composer from "./composer-view.js";
import * as settings from "./settings-view.js";
import * as mcp from "./mcp-view.js";
import * as history from "./history-view.js";
import * as projectView from "./project-view.js";
import * as dom from "./dom.js";
import * as formatters from "./formatters.js";
import * as direction from "./direction.js";
import * as markdown from "./markdown.js";
import * as logs from "./logs-view.js";
import * as terminal from "./terminal-view.js";
import * as files from "./files-view.js";

/* The controller owns the browser wiring and mounts every view. */
import "./console.js";


export const modules = Object.freeze({
  store,
  runtimeState,
  executionModel,
  conversationModel,
  discussionModel,
  approvalState,
  chat,
  execution,
  events,
  plan,
  discussion,
  composer,
  settings,
  mcp,
  history,
  projectView,
  dom,
  formatters,
  direction,
  markdown,
  logs,
  terminal,
  files
});

if (typeof globalThis !== "undefined") {
  globalThis.StructuredAIApp = modules;
}
