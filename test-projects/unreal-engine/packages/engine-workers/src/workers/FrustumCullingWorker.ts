import type { Vec3, Mat4 } from "@web-engine/engine-core";

/**
 * Input: camera frustum + renderable data.
 * Output: indices of visible renderables.
 */
export interface FrustumCullingInput {
  viewProj: Float64Array;   // 16 floats, column-major
  renderables: FrustumCullingRenderable[];
}

export interface FrustumCullingRenderable {
  worldMatrix: Float64Array; // 16 floats
  center: [number, number, number];
  radius: number;
}

export interface FrustumCullingOutput {
  visibleIndices: number[];
}

// ── Frustum plane extraction ────────────────────────────────────────────────

function extractFrustumPlanes(vp: Float64Array): Float64Array[] {
  // vp = projection * view (column-major)
  const planes: Float64Array[] = [];

  // Left   : row 3 + row 0
  // Right  : row 3 - row 0
  // Bottom : row 3 + row 1
  // Top    : row 3 - row 1
  // Near   : row 3 + row 2
  // Far    : row 3 - row 2

  const m = vp;
  const signs = [
    [ 1,  1,  1,  1], // left
    [-1, -1, -1, -1], // right
    [ 1,  1,  1,  1], // bottom
    [-1, -1, -1, -1], // top
    [ 1,  1,  1,  1], // near
    [-1, -1, -1, -1], // far
  ];

  const rowIndices = [
    [3, 0],  // left:   row3 + row0
    [3, 0],  // right:  row3 - row0
    [3, 1],  // bottom: row3 + row1
    [3, 1],  // top:    row3 - row1
    [3, 2],  // near:   row3 + row2
    [3, 2],  // far:    row3 - row2
  ];

  for (let p = 0; p < 6; p++) {
    const [r3, ri] = rowIndices[p];
    const sign = signs[p];
    const plane = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      plane[i] = m[r3 * 4 + i] + sign[i] * m[ri * 4 + i];
    }
    // Normalise
    const len = Math.sqrt(plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]);
    if (len > 0) {
      plane[0] /= len;
      plane[1] /= len;
      plane[2] /= len;
      plane[3] /= len;
    }
    planes.push(plane);
  }
  return planes;
}

function sphereInFrustum(planes: Float64Array[], cx: number, cy: number, cz: number, r: number): boolean {
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    const d = p[0] * cx + p[1] * cy + p[2] * cz + p[3];
    if (d < -r) return false;
  }
  return true;
}

// ── Worker message handler ──────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<FrustumCullingInput>) => {
  const { viewProj, renderables } = e.data;
  const planes = extractFrustumPlanes(viewProj);
  const visibleIndices: number[] = [];

  for (let i = 0; i < renderables.length; i++) {
    const r = renderables[i];
    if (sphereInFrustum(planes, r.center[0], r.center[1], r.center[2], r.radius)) {
      visibleIndices.push(i);
    }
  }

  const output: FrustumCullingOutput = { visibleIndices };
  self.postMessage(output);
};
