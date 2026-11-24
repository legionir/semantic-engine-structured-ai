/* Selection/focus state — EXECUTION_PLAN Phase 25. */

import { nodesWithinFocus } from "./graph-model.js";

export class SelectionState {
  constructor(depth = 2) {
    this.selectedNodeId = null;
    this.focusDepth = depth;
  }

  select(nodeId) {
    this.selectedNodeId = nodeId;
    return nodeId;
  }

  reset() {
    this.selectedNodeId = null;
  }

  setDepth(depth) {
    this.focusDepth = Math.max(1, Math.min(3, Number(depth) || 2));
  }

  focusedIds(nodes, edges) {
    return this.selectedNodeId
      ? nodesWithinFocus(nodes, edges, this.selectedNodeId, this.focusDepth)
      : new Set((nodes || []).map(node => node.id));
  }
}
