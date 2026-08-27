import { describe, expect, it, vi } from 'vitest';
import { Scene, type TransformComponent } from '@web-engine/engine-core';
import { FrameMeter } from '../src/app/engine/frame-meter';
import { SpinSystem } from '../src/app/engine/spin-system';

describe('FrameMeter', () => {
  it('reports no fps before the first window closes', () => {
    const meter = new FrameMeter({ windowSeconds: 0.5 });
    meter.update(0.016, 0);
    expect(meter.measuredFps).toBeNull();
  });

  it('measures fps over the window and counts frames overall', () => {
    const meter = new FrameMeter({ windowSeconds: 0.5 });
    // 30 frames spread over exactly one second of world time.
    for (let i = 0; i <= 30; i += 1) meter.update(1 / 30, i / 30);

    expect(meter.latest.frames).toBeGreaterThan(30);
    expect(meter.measuredFps).toBeCloseTo(30, 0);
    expect(meter.latest.frameTimeMs).toBeGreaterThan(0);
    expect(meter.latest.worstFrameMs).toBeGreaterThan(0);
  });

  it('notifies subscribers once per window only', () => {
    const meter = new FrameMeter({ windowSeconds: 0.25 });
    const listener = vi.fn();
    const unsubscribe = meter.subscribe(listener);

    meter.update(0.1, 0);
    meter.update(0.1, 0.1);
    expect(listener).not.toHaveBeenCalled();

    meter.update(0.1, 0.3);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    meter.update(0.1, 0.7);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reset clears both the window and the totals', () => {
    const meter = new FrameMeter({ windowSeconds: 0.1 });
    meter.update(0.05, 0);
    meter.update(0.05, 0.05);
    meter.update(0.05, 0.1);
    meter.reset();
    expect(meter.latest).toEqual({ fps: 0, frames: 0, frameTimeMs: 0, worstFrameMs: 0 });
    expect(meter.measuredFps).toBeNull();
  });
});

describe('SpinSystem', () => {
  const makeTarget = (): TransformComponent => {
    const scene = new Scene();
    const entity = scene.createEntity('Turntable');
    return entity.getComponent<TransformComponent>('transform')!;
  };

  it('accumulates rotation on the configured axis', () => {
    const transform = makeTarget();
    const spy = vi.spyOn(transform, 'setRotation');
    const spin = new SpinSystem([transform], { degreesPerSecond: 90 });

    spin.update(0.5);
    expect(spin.angleDegrees).toBeCloseTo(45);
    expect(spy).toHaveBeenCalledWith(0, 45, 0);

    spin.update(0.5);
    expect(spin.angleDegrees).toBeCloseTo(90);
  });

  it('supports the x and z axes', () => {
    const xAxis = makeTarget();
    const xSpy = vi.spyOn(xAxis, 'setRotation');
    new SpinSystem([xAxis], { degreesPerSecond: 10, axis: 'x' }).update(1);
    expect(xSpy).toHaveBeenLastCalledWith(10, 0, 0);

    const zAxis = makeTarget();
    const zSpy = vi.spyOn(zAxis, 'setRotation');
    new SpinSystem([zAxis], { degreesPerSecond: 10, axis: 'z' }).update(1);
    expect(zSpy).toHaveBeenLastCalledWith(0, 0, 10);
  });

  it('does nothing while disabled and rewinds on reset', () => {
    const spin = new SpinSystem([makeTarget()], { degreesPerSecond: 90, enabled: false });
    spin.update(1);
    expect(spin.angleDegrees).toBe(0);

    spin.setEnabled(true);
    spin.update(1);
    expect(spin.angleDegrees).toBeCloseTo(90);

    spin.reset();
    expect(spin.angleDegrees).toBe(0);
    expect(spin.isEnabled).toBe(true);
  });

  it('wraps at 360 degrees so the value cannot drift forever', () => {
    const spin = new SpinSystem([makeTarget()], { degreesPerSecond: 1000 });
    spin.update(1);
    expect(spin.angleDegrees).toBeCloseTo(1000 % 360);
  });
});
