// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InterpolationMode = "step" | "linear" | "catmullrom";

/** A single keyframe for a property on a single target. */
export interface Keyframe {
  time: number;
  value: number[];
  inTangent?: number[];   // for catmull-rom
  outTangent?: number[];
}

/** A channel maps one property of one target node to a set of keyframes. */
export interface Channel {
  targetNode: string;         // entity id or bone name
  property: "translation" | "rotation" | "scale" | "weights";
  keyframes: Keyframe[];
  interpolation: InterpolationMode;
}

// ---------------------------------------------------------------------------
// AnimationClip
// ---------------------------------------------------------------------------

export class AnimationClip {
  readonly name: string;
  readonly channels: Channel[];
  readonly duration: number;

  /**
   * @param name  Clip identifier.
   * @param channels  Animated property channels.
   * @param duration  Total duration in seconds. If <= 0, computed from keyframes.
   */
  constructor(name: string, channels: Channel[], duration = 0) {
    this.name = name;
    this.channels = channels;
    this.duration = duration > 0 ? duration : this.computeDuration();
  }

  private computeDuration(): number {
    let max = 0;
    for (const ch of this.channels) {
      for (const kf of ch.keyframes) {
        if (kf.time > max) max = kf.time;
      }
    }
    return max;
  }

  /**
   * Sample all channels at `time` (clamped to [0, duration]).
   * Returns a map targetNode -> { property -> value[] }.
   */
  sample(time: number, loop = true): Map<string, Map<string, number[]>> {
    let t = loop ? time % this.duration : Math.max(0, Math.min(time, this.duration));
    // When time is exactly at a multiple of duration while looping, use the end
    if (loop && time > 0 && t === 0) t = this.duration;
    const result = new Map<string, Map<string, number[]>>();

    for (const ch of this.channels) {
      let values = this.sampleChannel(ch, t);
      if (!values) continue;

      let nodeMap = result.get(ch.targetNode);
      if (!nodeMap) {
        nodeMap = new Map();
        result.set(ch.targetNode, nodeMap);
      }
      nodeMap.set(ch.property, values);
    }

    return result;
  }

  private sampleChannel(ch: Channel, t: number): number[] | null {
    const kfs = ch.keyframes;
    if (kfs.length === 0) return null;
    if (kfs.length === 1) return [...kfs[0].value];

    // Find the two surrounding keyframes
    let idx = 0;
    for (let i = 0; i < kfs.length - 1; i++) {
      if (t >= kfs[i].time && t <= kfs[i + 1].time) {
        idx = i;
        break;
      }
    }
    // If t is before the first keyframe, return the first
    if (t <= kfs[0].time) return [...kfs[0].value];
    // If t is after the last, return the last
    if (t >= kfs[kfs.length - 1].time) return [...kfs[kfs.length - 1].value];

    const a = kfs[idx];
    const b = kfs[idx + 1];
    const range = b.time - a.time;
    const factor = range > 0 ? (t - a.time) / range : 0;

    switch (ch.interpolation) {
      case "step":
        return [...a.value];

      case "linear":
        return this.lerpValues(a.value, b.value, factor);

      case "catmullrom": {
        const prev = idx > 0 ? kfs[idx - 1] : a;
        const next = idx + 2 < kfs.length ? kfs[idx + 2] : b;
        return this.catmullRomValues(prev.value, a.value, b.value, next.value, factor);
      }

      default:
        return this.lerpValues(a.value, b.value, factor);
    }
  }

  private lerpValues(a: number[], b: number[], t: number): number[] {
    const len = Math.min(a.length, b.length);
    const out = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      out[i] = a[i] + (b[i] - a[i]) * t;
    }
    return out;
  }

  private catmullRomValues(p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] {
    const len = Math.min(p0.length, p1.length, p2.length, p3.length);
    const out = new Array<number>(len);
    const t2 = t * t;
    const t3 = t2 * t;
    for (let i = 0; i < len; i++) {
      // Catmull-Rom: 0.5 * ((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3)
      out[i] = 0.5 * (
        (2 * p1[i]) +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
      );
    }
    return out;
  }
}
