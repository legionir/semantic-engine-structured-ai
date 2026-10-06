/*
 * Domain store — EXECUTION_PLAN Phase 24.
 *
 * The browser state is intentionally plain data. Reducers consume the same
 * runtime events as the canonical console and never infer project
 * identity from user-entered tool arguments.
 */

export const DOMAIN_NAMES = Object.freeze([
  "runtimeState",
  "conversationState",
  "executionState",
  "eventState",
  "approvalState",
  "settingsState",
  "mcpState",
  "historyState",
  "planState",
  "projectState"
]);


export function createInitialState() {
  return {
    runtimeState: {
      status: "idle",
      task: null,
      answer: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      waiting: null
    },
    conversationState: {
      messages: []
    },
    executionState: {
      agents: {},
      order: [],
      graphs: {},
      calls: {},
      loops: [],
      hooks: []
    },
    eventState: {
      events: [],
      filter: "",
      type: ""
    },
    approvalState: {
      pending: {}
    },
    settingsState: {
      settings: []
    },
    mcpState: {
      servers: [],
      tools: []
    },
    historyState: {
      sessions: [],
      opening: false
    },
    planState: {
      plan: null
    },
    projectState: {
      projects: [],
      currentProjectId: null,
      dashboard: {
        open: false,
        projectId: null,
        tab: "overview"
      }
    }
  };
}


function messageKey(message) {
  return [
    message?.message_id || "",
    message?.execution_key || "",
    message?.turn_id || "",
    message?.iteration ?? "",
    message?.content || ""
  ].join("|");
}


function withEvent(state, event) {
  const next = {
    ...state,
    eventState: {
      ...state.eventState,
      events: [...state.eventState.events, event]
    }
  };

  if (event.project_id &&
      next.projectState.currentProjectId &&
      event.project_id !== next.projectState.currentProjectId) {
    return state;
  }

  switch (event.type) {
    case "run:start":
      next.runtimeState = {
        ...next.runtimeState,
        status: "running",
        task: event.task || null,
        startedAt: event.at || null,
        error: null,
        answer: null
      };
      break;
    case "run:end":
    case "run:status":
      next.runtimeState = {
        ...next.runtimeState,
        status: event.status || (event.success ? "done" : next.runtimeState.status),
        answer: event.answer ?? next.runtimeState.answer,
        error: event.error ?? next.runtimeState.error,
        finishedAt: event.at || next.runtimeState.finishedAt
      };
      break;
    case "agent:response":
    case "agent:thinking": {
      const messages = next.conversationState.messages;
      const key = messageKey(event);
      const alreadyPresent = messages.some(message => messageKey(message) === key);
      next.conversationState = {
        ...next.conversationState,
        messages: alreadyPresent ? messages : [...messages, event]
      };
      break;
    }
    case "approval:request":
      next.approvalState = {
        ...next.approvalState,
        pending: {
          ...next.approvalState.pending,
          [event.id]: event
        }
      };
      break;
    case "approval:resolved": {
      const pending = { ...next.approvalState.pending };
      delete pending[event.id];
      next.approvalState = { ...next.approvalState, pending };
      break;
    }
    case "plan:update":
    case "plan:autoroute:end":
      next.planState = {
        ...next.planState,
        plan: event.plan || event.summary || next.planState.plan
      };
      break;
    default:
      break;
  }

  return next;
}


export function reduceState(state, event) {
  if (!event || typeof event !== "object") return state;
  return withEvent(state, event);
}


export function applySnapshot(state, snapshot = {}) {
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  let next = {
    ...state,
    runtimeState: {
      ...state.runtimeState,
      status: snapshot.status || state.runtimeState.status,
      task: snapshot.task ?? state.runtimeState.task,
      answer: snapshot.answer ?? state.runtimeState.answer,
      error: snapshot.error ?? state.runtimeState.error,
      startedAt: snapshot.started_at ?? state.runtimeState.startedAt,
      finishedAt: snapshot.finished_at ?? state.runtimeState.finishedAt
    },
    conversationState: {
      ...state.conversationState,
      messages: Array.isArray(snapshot.messages) ? [...snapshot.messages] : []
    },
    eventState: {
      ...state.eventState,
      events: []
    },
    approvalState: {
      ...state.approvalState,
      pending: Object.fromEntries(
        (snapshot.pending_approvals || []).map(item => [item.id, item])
      )
    },
    planState: {
      ...state.planState,
      plan: snapshot.plan || state.planState.plan
    }
  };

  for (const event of events) next = reduceState(next, event);
  return next;
}


export function createStore(seed = {}) {
  let state = {
    ...createInitialState(),
    ...seed
  };
  const listeners = new Set();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(event) {
      state = reduceState(state, event);
      listeners.forEach(listener => listener(state, event));
      return state;
    },
    snapshot(snapshotValue) {
      state = applySnapshot(state, snapshotValue);
      listeners.forEach(listener => listener(state, { type: "snapshot" }));
      return state;
    },
    reset() {
      state = createInitialState();
      listeners.forEach(listener => listener(state, { type: "reset" }));
      return state;
    }
  };
}
