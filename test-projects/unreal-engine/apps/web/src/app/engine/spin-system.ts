import type { System, TransformComponent } from '@web-engine/engine-core';

export interface SpinSystemOptions {
  /** Degrees per second. Defaults to 24. */
  readonly degreesPerSecond?: number;
  readonly axis?: 'x' | 'y' | 'z';
  readonly enabled?: boolean;
}

/**
 * Rotates a set of transforms on the local render side.
 *
 * This is deliberately a plain `System` added to the scene world rather than a
 * hook inside the frame loop: it proves the web client can extend a runtime
 * scene the same way an editor or a game would. Its priority runs it after the
 * transform system (0) and the camera sync system (5), and before the render
 * system (10), so a rotated parent's children are up to date when the frame is
 * submitted.
 */
export class SpinSystem implements System {
  readonly priority = 6;

  private angle = 0;
  private enabled: boolean;
  private readonly degreesPerSecond: number;
  private readonly axis: 'x' | 'y' | 'z';

  constructor(
    private readonly targets: readonly TransformComponent[],
    options: SpinSystemOptions = {}
  ) {
    this.degreesPerSecond = options.degreesPerSecond ?? 24;
    this.axis = options.axis ?? 'y';
    this.enabled = options.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get angleDegrees(): number {
    return this.angle;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Rewind to the authored orientation. */
  reset(): void {
    this.angle = 0;
    this.targets.forEach((target) => target.setRotation(0, 0, 0));
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    this.angle = (this.angle + deltaTime * this.degreesPerSecond) % 360;
    const a = this.angle;
    const [x, y, z] = this.axis === 'x' ? [a, 0, 0] : this.axis === 'z' ? [0, 0, a] : [0, a, 0];
    this.targets.forEach((target) => target.setRotation(x, y, z));
  }
}
