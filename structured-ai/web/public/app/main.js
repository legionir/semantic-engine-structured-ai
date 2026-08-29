/*
 * Browser ESM entry point — EXECUTION_PLAN Phase 24.
 *
 * The canonical renderer is loaded through an explicit dependency graph;
 * domain modules remain separately testable and the browser has no build step.
 */

import { createStore } from "./store.js";
import { EventStream } from "./event-stream.js";
import { TaskRunner } from "./task-runner.js";
import * as api from "./api.js";
import * as chat from "./chat.js";
import * as execution from "./execution-view.js";
import * as events from "./event-view.js";
import * as settings from "./settings-view.js";
import * as mcp from "./mcp-view.js";
import * as history from "./history-view.js";
import * as plan from "./plan-view.js";
import * as modal from "./modal-manager.js";
import * as project from "./project-state.js";
import * as projectView from "./project-view.js";
import * as runtimeState from "./runtime-state.js";
import * as approvalState from "./approval-state.js";
import * as dom from "./dom.js";
import * as formatters from "./formatters.js";
import * as direction from "./direction.js";
import * as markdown from "./markdown.js";

/* The renderer owns browser wiring; this bootstrap owns the dependency
   graph and exposes the modules for diagnostics and extensions. */
import "./console.js";


export const store = createStore();
export const eventStream = new EventStream({
  onSnapshot: snapshot => store.snapshot(snapshot),
  onEvent: event => store.dispatch(event),
  onError: () => {}
});
export const taskRunner = new TaskRunner({ store });

export const modules = Object.freeze({
  api,
  chat,
  execution,
  events,
  settings,
  mcp,
  history,
  plan,
  modal,
  project,
  projectView,
  runtimeState,
  approvalState,
  dom,
  formatters,
  direction,
  markdown,
  store,
  eventStream,
  taskRunner
});

if (typeof globalThis !== "undefined") {
  globalThis.StructuredAIApp = modules;
}
