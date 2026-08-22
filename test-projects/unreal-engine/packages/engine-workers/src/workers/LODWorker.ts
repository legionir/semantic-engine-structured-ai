import type { Vec3 } from "@web-engine/engine-core";

/**
 * Input: camera position + renderables with LOD data.
 * Output: selected LOD level for each renderable.
 */
export interface LODLevel {
  /** Distance threshold beyond which this LOD applies. */
  distance: number;
  /** Mesh simplification hint (0 = full detail, higher = simpler). */
  level: number;
  /** Multiplier for triangle count (0..1) used by the instancing system. */
  lodFactor: number;
}

export interface LODRenderable {
  /** World-space centre of the object. */
  center: [number, number, number];
  /** Object-space bounding radius. */
  radius: number;
  /** The LOD levels defined for this renderable, sorted by distance ascending. */
  lodLevels: LODLevel[];
  /** Current active LOD index (set by worker). */
}

export interface LODInput {
  cameraPos: [number, number, number];
  renderables: LODRenderable[];
  /** Optional global scale factor applied to all LOD distances. */
  globalLODBias?: number;
}

export interface LODOutput {
  /** For each renderable, the selected LOD level index. */
  selectedLODs: number[];
}

// ── Worker message handler ──────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<LODInput>) => {
  const { cameraPos, renderables, globalLODBias } = e.data;
  const bias = globalLODBias ?? 1.0;
  const selectedLODs: number[] = [];

  const cx = cameraPos[0];
  const cy = cameraPos[1];
  const cz = cameraPos[2];

  for (let i = 0; i < renderables.length; i++) {
    const r = renderables[i];
    const dx = r.center[0] - cx;
    const dy = r.center[1] - cy;
    const dz = r.center[2] - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - r.radius;
    const clampedDist = Math.max(0, dist);

    let selected = r.lodLevels.length - 1; // lowest detail by default
    for (let j = 0; j < r.lodLevels.length; j++) {
      if (clampedDist < r.lodLevels[j].distance * bias) {
        selected = j;
        break;
      }
    }
    selectedLODs.push(selected);
  }

  const output: LODOutput = { selectedLODs };
  self.postMessage(output);
};
