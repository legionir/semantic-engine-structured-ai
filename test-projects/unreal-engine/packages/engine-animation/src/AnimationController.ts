import { AnimationClip } from "./AnimationClip.js";

// ---------------------------------------------------------------------------
// AnimationController
// ---------------------------------------------------------------------------

export interface AnimationState {
  clip: AnimationClip;
  time: number;
  speed: number;
  weight: number;         // 0..1 blend weight when multiple clips are active
  loop: boolean;
  playing: boolean;
}

export interface CrossfadeOptions {
  /** Duration of the crossfade in seconds. */
  duration: number;
  /** Start time in the target clip (0 by default). */
  targetStartTime?: number;
}

export class AnimationController {
  private readonly states = new Map<string, AnimationState>();
  private activeStateId: string | null = null;
  private previousStateId: string | null = null;
  private crossfadeTime = 0;
  private crossfadeDuration = 0;
  private crossfadeFromId: string | null = null;

  /** Global speed multiplier applied to all clips. */
  globalSpeed = 1;

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  /** Register a clip under a logical name. */
  addClip(id: string, clip: AnimationClip, speed = 1, loop = true): void {
    this.states.set(id, {
      clip,
      time: 0,
      speed,
      weight: 1,
      loop,
      playing: false,
    });
  }

  /** Remove a registered clip. */
  removeClip(id: string): void {
    this.states.delete(id);
    if (this.activeStateId === id) this.activeStateId = null;
    if (this.previousStateId === id) this.previousStateId = null;
  }

  getClip(id: string): AnimationState | undefined {
    return this.states.get(id);
  }

  hasClip(id: string): boolean {
    return this.states.has(id);
  }

  /** List all registered clip ids. */
  getClipIds(): string[] {
    return [...this.states.keys()];
  }

  /**
   * Play a registered clip. If a crossfade duration is given it blends from
   * the currently playing clip to the new one.
   */
  play(id: string, crossfade?: CrossfadeOptions): void {
    const state = this.states.get(id);
    if (!state) throw new Error(`Animation clip "${id}" not found.`);

    if (crossfade && crossfade.duration > 0 && this.activeStateId && this.activeStateId !== id) {
      // Start crossfade
      this.crossfadeFromId = this.activeStateId;
      this.crossfadeTime = 0;
      this.crossfadeDuration = crossfade.duration;
      this.previousStateId = this.activeStateId;

      // Reset target time if requested
      state.time = crossfade.targetStartTime ?? 0;
      state.playing = true;
      this.activeStateId = id;
    } else {
      // Immediate switch
      if (this.activeStateId && this.activeStateId !== id) {
        const prev = this.states.get(this.activeStateId);
        if (prev) prev.playing = false;
      }
      this.crossfadeFromId = null;
      this.crossfadeDuration = 0;
      this.crossfadeTime = 0;
      this.previousStateId = null;

      state.time = crossfade?.targetStartTime ?? 0;
      state.playing = true;
      this.activeStateId = id;
    }
  }

  /** Stop a specific clip or all clips if no id is given. */
  stop(id?: string): void {
    if (id) {
      const state = this.states.get(id);
      if (state) state.playing = false;
      if (this.activeStateId === id) this.activeStateId = null;
    } else {
      this.states.forEach((s) => (s.playing = false));
      this.activeStateId = null;
      this.crossfadeFromId = null;
      this.crossfadeDuration = 0;
      this.crossfadeTime = 0;
    }
  }

  /** The currently active clip id, or null. */
  get activeClipId(): string | null {
    return this.activeStateId;
  }

  /** The currently active state, or null. */
  get activeState(): AnimationState | null {
    return this.activeStateId ? this.states.get(this.activeStateId) ?? null : null;
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /**
   * Advance all playing clips by `deltaTime` seconds.
   * Returns the sampled result from the active clip(s) with blending.
   *
   * @returns A map of targetNode -> { property -> sampledValues } or null if nothing is playing.
   */
  update(deltaTime: number): Map<string, Map<string, number[]>> | null {
    if (!this.activeStateId) return null;

    const active = this.states.get(this.activeStateId);
    if (!active || !active.playing) return null;

    // --- Crossfade ---
    let fromResult: Map<string, Map<string, number[]>> | null = null;
    let blendFactor = 1;

    if (this.crossfadeFromId && this.crossfadeDuration > 0) {
      this.crossfadeTime += deltaTime;
      blendFactor = Math.min(1, this.crossfadeTime / this.crossfadeDuration);

      const fromState = this.states.get(this.crossfadeFromId);
      if (fromState && fromState.playing) {
        // Sample from state BEFORE advancing its time
        fromResult = fromState.clip.sample(fromState.time, fromState.loop);
        fromState.time += deltaTime * fromState.speed * this.globalSpeed;
      }

      if (blendFactor >= 1) {
        // Crossfade complete
        this.crossfadeFromId = null;
        this.crossfadeDuration = 0;
        this.crossfadeTime = 0;
        this.previousStateId = null;
      }

      // During crossfade: sample active clip at its current time (before advancing)
      const activeResult = active.clip.sample(active.time, active.loop);
      active.time += deltaTime * active.speed * this.globalSpeed;

      if (fromResult && blendFactor < 1) {
        return this.blendResults(fromResult, activeResult, blendFactor);
      }
      return activeResult;
    }

    // Normal (non-crossfade): advance time BEFORE sampling
    // so the first update produces the expected interpolated state
    active.time += deltaTime * active.speed * this.globalSpeed;
    return active.clip.sample(active.time, active.loop);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private blendResults(
    from: Map<string, Map<string, number[]>>,
    to: Map<string, Map<string, number[]>>,
    t: number,
  ): Map<string, Map<string, number[]>> {
    const result = new Map<string, Map<string, number[]>>();

    // Merge all nodes from both maps
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
