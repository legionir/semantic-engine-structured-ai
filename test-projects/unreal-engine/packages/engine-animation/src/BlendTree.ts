import { AnimationClip } from "./AnimationClip.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlendTree1DChild {
  clip: AnimationClip;
  threshold: number;
}

export interface BlendTree2DChild {
  clip: AnimationClip;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// BlendTree1D
// ---------------------------------------------------------------------------

export class BlendTree1D {
  /**
   * @param parameterName  Name of the parameter that drives the blend.
   * @param children  Child clips with their thresholds.
   */
  constructor(
    public readonly parameterName: string,
    public readonly children: BlendTree1DChild[],
  ) {
    if (children.length === 0) {
      throw new Error("BlendTree1D must have at least one child.");
    }
    // Sort children by threshold
    this.children.sort((a, b) => a.threshold - b.threshold);
  }

  /**
   * Sample the blend tree at the given parameter value.
   * Returns the blended result (node -> property -> values).
   */
  sample(value: number, time: number, loop = true): Map<string, Map<string, number[]>> {
    const len = this.children.length;

    // Clamp to extremes
    if (value <= this.children[0].threshold) {
      return this.children[0].clip.sample(time, loop);
    }
    if (value >= this.children[len - 1].threshold) {
      return this.children[len - 1].clip.sample(time, loop);
    }

    // Find the two surrounding children
    for (let i = 0; i < len - 1; i++) {
      const a = this.children[i];
      const b = this.children[i + 1];
      if (value >= a.threshold && value <= b.threshold) {
        const range = b.threshold - a.threshold;
        const t = range > 0 ? (value - a.threshold) / range : 0;

        const resultA = a.clip.sample(time, loop);
        const resultB = b.clip.sample(time, loop);

        return this.blendResults(resultA, resultB, t);
      }
    }

    // Fallback
    return this.children[0].clip.sample(time, loop);
  }

  private blendResults(
    from: Map<string, Map<string, number[]>>,
    to: Map<string, Map<string, number[]>>,
    t: number,
  ): Map<string, Map<string, number[]>> {
    const result = new Map<string, Map<string, number[]>>();

    const allNodes = new Set([...from.keys(), ...to.keys()]);
    for (const node of allNodes) {
      const fromProps = from.get(node) ?? new Map();
      const toProps = to.get(node) ?? new Map();
      const nodeMap = new Map<string, number[]>();

      const allProps = new Set([...fromProps.keys(), ...toProps.keys()]);
      for (const prop of allProps) {
        const fv = fromProps.get(prop);
        const tv = toProps.get(prop);
        if (fv && tv) {
          const len = Math.min(fv.length, tv.length);
          const blended = new Array<number>(len);
          for (let i = 0; i < len; i++) {
            blended[i] = fv[i] * (1 - t) + tv[i] * t;
          }
          nodeMap.set(prop, blended);
        } else {
          nodeMap.set(prop, (fv ?? tv)!.slice());
        }
      }
      result.set(node, nodeMap);
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// BlendTree2D
// ---------------------------------------------------------------------------

export class BlendTree2D {
  /**
   * @param parameterX  Name of the X parameter.
   * @param parameterY  Name of the Y parameter.
   * @param children  Child clips with their (x, y) positions.
   */
  constructor(
    public readonly parameterX: string,
    public readonly parameterY: string,
    public readonly children: BlendTree2DChild[],
  ) {
    if (children.length === 0) {
      throw new Error("BlendTree2D must have at least one child.");
    }
  }

  /**
   * Sample the blend tree at the given (x, y) parameter values.
   * Uses barycentric (triangular) interpolation for 2D blending.
   */
  sample(valueX: number, valueY: number, time: number, loop = true): Map<string, Map<string, number[]>> {
    const n = this.children.length;

    if (n === 1) {
      return this.children[0].clip.sample(time, loop);
    }

    // Find the three closest points that form a triangle containing (valueX, valueY)
    // using Delaunay-like approach: pick the closest point, then two neighbors
    const sorted = [...this.children]
      .map((c, i) => ({ child: c, index: i, dist: Math.hypot(c.x - valueX, c.y - valueY) }))
      .sort((a, b) => a.dist - b.dist);

    // If the closest point is very close, use it directly
    if (sorted[0].dist < 0.0001) {
      return sorted[0].child.clip.sample(time, loop);
    }

    // Take the three closest points and compute barycentric weights
    const p0 = sorted[0];
    const p1 = sorted[1];
    const p2 = sorted[2];

    const x1 = p0.child.x;
    const y1 = p0.child.y;
    const x2 = p1.child.x;
    const y2 = p1.child.y;
    const x3 = p2.child.x;
    const y3 = p2.child.y;

    const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);

    if (Math.abs(denom) < 1e-10) {
      // Degenerate triangle, fall back to nearest neighbor
      return sorted[0].child.clip.sample(time, loop);
    }

    const w0 = ((y2 - y3) * (valueX - x3) + (x3 - x2) * (valueY - y3)) / denom;
    const w1 = ((y3 - y1) * (valueX - x3) + (x1 - x3) * (valueY - y3)) / denom;
    const w2 = 1 - w0 - w1;

    // Clamp weights to [0, 1] for robustness
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const cw0 = clamp(w0);
    const cw1 = clamp(w1);
    const cw2 = clamp(w2);
    const total = cw0 + cw1 + cw2;
    const nw0 = total > 0 ? cw0 / total : 1 / 3;
    const nw1 = total > 0 ? cw1 / total : 1 / 3;
    const nw2 = total > 0 ? cw2 / total : 1 / 3;

    const r0 = p0.child.clip.sample(time, loop);
    const r1 = p1.child.clip.sample(time, loop);
    const r2 = p2.child.clip.sample(time, loop);

    return this.blendThree(r0, r1, r2, nw0, nw1, nw2);
  }

  private blendThree(
    a: Map<string, Map<string, number[]>>,
    b: Map<string, Map<string, number[]>>,
    c: Map<string, Map<string, number[]>>,
    wa: number,
    wb: number,
    wc: number,
  ): Map<string, Map<string, number[]>> {
    const result = new Map<string, Map<string, number[]>>();

    const allNodes = new Set([...a.keys(), ...b.keys(), ...c.keys()]);
    for (const node of allNodes) {
      const aProps = a.get(node) ?? new Map();
      const bProps = b.get(node) ?? new Map();
      const cProps = c.get(node) ?? new Map();
      const nodeMap = new Map<string, number[]>();

      const allProps = new Set([...aProps.keys(), ...bProps.keys(), ...cProps.keys()]);
      for (const prop of allProps) {
        const av = aProps.get(prop);
        const bv = bProps.get(prop);
        const cv = cProps.get(prop);
        const len = Math.max(av?.length ?? 0, bv?.length ?? 0, cv?.length ?? 0);
        const blended = new Array<number>(len);
        for (let i = 0; i < len; i++) {
          blended[i] = (av?.[i] ?? 0) * wa + (bv?.[i] ?? 0) * wb + (cv?.[i] ?? 0) * wc;
        }
        nodeMap.set(prop, blended);
      }
      result.set(node, nodeMap);
    }

    return result;
  }
}
