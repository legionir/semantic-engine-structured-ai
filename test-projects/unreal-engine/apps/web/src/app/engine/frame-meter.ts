import type { System } from '@web-engine/engine-core';

export interface FrameSample {
  /** Frames in the last completed measurement window. */
  readonly fps: number;
  /** Total frames since the meter was created or reset. */
  readonly frames: number;
  /** Mean frame duration of the last window, in milliseconds. */
  readonly frameTimeMs: number;
  /** Longest single frame in the last window, in milliseconds. */
  readonly worstFrameMs: number;
}

export interface FrameMeterOptions {
  /** Length of the measurement window in seconds. Defaults to 0.5. */
  readonly windowSeconds?: number;
}

/**
 * Counts frames and rolling frame time.
 *
 * `SceneRuntime` owns the `requestAnimationFrame` loop and does not expose a
 * frame counter, so the HUD reads its numbers from a system that runs inside
 * the world instead — the same extension point a game would use.
 */
export class FrameMeter implements System {
  /** Runs last, after the render system (priority 10). */
  readonly priority = 90;

  readonly windowSeconds: number;

  private frames = 0;
  private totalFrames = 0;
  private windowStart = -1;
  private lastTime = 0;
  private worstFrameMs = 0;
  private sample: FrameSample = { fps: 0, frames: 0, frameTimeMs: 0, worstFrameMs: 0 };
  private fps: number | null = null;
  private readonly listeners = new Set<(sample: FrameSample) => void>();

  constructor(options: FrameMeterOptions = {}) {
    this.windowSeconds = options.windowSeconds ?? 0.5;
  }

  get latest(): FrameSample {
    return this.sample;
  }

  /** Most recent window fps, or null before the first window completes. */
  get measuredFps(): number | null {
    return this.fps;
  }

  subscribe(listener: (sample: FrameSample) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.frames = 0;
    this.totalFrames = 0;
    this.windowStart = -1;
    this.worstFrameMs = 0;
    this.fps = null;
    this.sample = { fps: 0, frames: 0, frameTimeMs: 0, worstFrameMs: 0 };
  }

  update(_deltaTime: number, time: number): void {
    this.totalFrames += 1;
    if (this.windowStart < 0) {
      /* The frame that opens a window is its anchor, not one of its samples;
         counting it would inflate the first measurement. */
      this.windowStart = time;
      this.lastTime = time;
      return;
    }
    this.frames += 1;

    const frameDuration = Math.max(0, time - this.lastTime);
    this.lastTime = time;
    this.worstFrameMs = Math.max(this.worstFrameMs, frameDuration * 1000);

    const elapsed = time - this.windowStart;
    if (elapsed < this.windowSeconds) return;

    const fps = this.frames / elapsed;
    this.fps = Math.round(fps * 10) / 10;
    this.sample = {
      fps: this.fps,
      frames: this.totalFrames,
      frameTimeMs: Math.round((elapsed / this.frames) * 1000 * 10) / 10,
      worstFrameMs: Math.round(this.worstFrameMs * 10) / 10,
    };
    this.frames = 0;
    this.worstFrameMs = 0;
    this.windowStart = time;
    this.listeners.forEach((listener) => listener(this.sample));
  }
}
