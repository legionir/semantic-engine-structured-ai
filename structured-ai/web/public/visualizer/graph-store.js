/* Graph state store — EXECUTION_PLAN Phase 25. */

export function createInitialGraphState(projectId = "current") {
  return {
    currentView: "architecture",
    projectId,
    nodes: [],
    edges: [],
    selectedNodeId: null,
    focusDepth: 2,
    resolvedOnly: false,
    zoom: { scale: 1, panX: 0, panY: 0 },
    isDragging: false,
    dragStart: { x: 0, y: 0 }
  };
}


function cloneGraph(state) {
  return {
    ...state,
    nodes: [...state.nodes],
    edges: [...state.edges],
    zoom: { ...state.zoom },
    dragStart: { ...state.dragStart }
  };
}


export function createGraphStore(projectId = "current") {
  let state = createInitialGraphState(projectId);
  const listeners = new Set();

  const publish = () => {
    listeners.forEach(listener => listener(state));
    return state;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setView(currentView) {
      state = { ...state, currentView };
      return publish();
    },
    setGraph(nodes, edges) {
      state = {
        ...state,
        nodes: [...(nodes || [])],
        edges: [...(edges || [])],
        selectedNodeId: null
      };
      return publish();
    },
    select(selectedNodeId) {
      state = { ...state, selectedNodeId };
      return publish();
    },
    setFocusDepth(focusDepth) {
      state = { ...state, focusDepth: Math.max(1, Math.min(3, Number(focusDepth) || 2)) };
      return publish();
    },
    setResolvedOnly(resolvedOnly) {
      state = { ...state, resolvedOnly: Boolean(resolvedOnly) };
      return publish();
    },
    setZoom(zoom) {
      state = { ...state, zoom: { ...state.zoom, ...zoom } };
      return publish();
    },
    setDragging(isDragging, dragStart = state.dragStart) {
      state = { ...state, isDragging, dragStart: { ...dragStart } };
      return publish();
    },
    reset() {
      state = createInitialGraphState(state.projectId);
      return publish();
    },
    replace(next) {
      state = { ...cloneGraph(state), ...next };
      return publish();
    }
  };
}
