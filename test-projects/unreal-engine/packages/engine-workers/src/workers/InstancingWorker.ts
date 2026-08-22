import type { Mat4 } from "@web-engine/engine-core";

/**
 * Input: visible renderables grouped by material/mesh key.
 * Output: per-instance data arrays for GPU instanced drawing.
 */
export interface InstanceGroup {
  /** Unique key combining mesh + material identity. */
  groupKey: string;
  /** Array of world matrices (16 floats each) as a flat Float64Array. */
  matrices: Float64Array;
  /** Number of instances in this group. */
  count: number;
}

export interface InstancingInput {
  /** Renderable visibility data: for each renderable, its world matrix, mesh id, material id. */
  renderables: InstancingRenderable[];
  /** Indices of visible renderables (from frustum culling). */
  visibleIndices: number[];
  /** Optional maximum instances per batch. */
  maxBatchSize?: number;
}

export interface InstancingRenderable {
  worldMatrix: Float64Array;
  meshId: string;
  materialId: string;
  /** LOD factor (0..1) from the LOD system. */
  lodFactor: number;
}

export interface InstancingOutput {
  /** Groups of instances for the renderer. */
  groups: InstanceGroup[];
  /** Total draw calls after batching. */
  drawCallCount: number;
}

// ── Worker message handler ──────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<InstancingInput>) => {
  const { renderables, visibleIndices, maxBatchSize } = e.data;
  const batchLimit = maxBatchSize ?? 256;

  // Group visible renderables by (meshId, materialId)
  const groups = new Map<string, Float64Array[]>();

  for (const idx of visibleIndices) {
    const r = renderables[idx];
    const key = `${r.meshId}|${r.materialId}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(r.worldMatrix);
  }

  const resultGroups: InstanceGroup[] = [];
  let drawCallCount = 0;

  for (const [groupKey, matrices] of groups) {
    // Split into batches if exceeding maxBatchSize
    for (let offset = 0; offset < matrices.length; offset += batchLimit) {
      const batch = matrices.slice(offset, offset + batchLimit);
      const flat = new Float64Array(batch.length * 16);
      for (let i = 0; i < batch.length; i++) {
        flat.set(batch[i], i * 16);
      }
      resultGroups.push({
        groupKey,
        matrices: flat,
        count: batch.length,
      });
      drawCallCount++;
    }
  }

  const output: InstancingOutput = {
    groups: resultGroups,
    drawCallCount,
  };
  self.postMessage(output);
};
