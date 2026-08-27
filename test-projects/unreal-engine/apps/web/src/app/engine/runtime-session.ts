import type { Scene, SceneSnapshot } from '@web-engine/engine-core';
import type { Renderer, RendererInfo } from '@web-engine/engine-renderer';
import { SceneRuntime } from '@web-engine/engine-runtime';
import { createSceneModel, summarizeScene, type DemoSceneModel } from './default-scene';
import { FrameMeter } from './frame-meter';
import { SpinSystem } from './spin-system';
import {
  createRenderer,
  describeRenderer,
  pickRendererKind,
  shouldFallBackToWebGL2,
  type RendererKind,
} from './renderer-choice';
import type { RendererPreference } from '../../config';

export interface RuntimeSessionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly preference: RendererPreference;
  /** Whether `navigator.gpu` exists; injected so the choice is unit-testable. */
  readonly webgpuAvailable: boolean;
  /** Audio needs a user gesture for its `AudioContext`, so it starts disabled. */
  readonly enableAudio?: boolean;
  /** Scene document to restore (`null`/absent shows the demo scene). */
  readonly snapshot?: SceneSnapshot | null;
  /** Pre-resolved model; wins over `snapshot`. */
  readonly model?: DemoSceneModel;
  readonly spinDegreesPerSecond?: number;
}

export interface RuntimeSession {
  readonly scene: Scene;
  readonly runtime: SceneRuntime;
  readonly renderer: Renderer;
  readonly rendererKind: RendererKind;
  readonly rendererLabel: string;
  /** Set when WebGPU was tried first and failed. */
  readonly fallbackReason: string | null;
  readonly meter: FrameMeter;
  readonly spin: SpinSystem;
  readonly model: DemoSceneModel;
  readonly canSpin: boolean;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
  info(): RendererInfo | null;
  summary(): { entities: number; meshes: number };
}

/**
 * Own one canvas: pick a backend, resolve a scene, run the engine's loop.
 *
 * This is the only place that knows how the renderer, the scene model and
 * `SceneRuntime` are stitched together, which keeps `main.ts` a thin mount and
 * makes the WebGPU→WebGL2 degradation a single, testable decision.
 */
export async function createRuntimeSession(
  options: RuntimeSessionOptions
): Promise<RuntimeSession> {
  const { canvas, preference, webgpuAvailable, enableAudio = false, spinDegreesPerSecond } = options;

  let kind = pickRendererKind(preference, webgpuAvailable);
  let renderer = createRenderer(kind);
  let fallbackReason: string | null = null;

  try {
    await renderer.init(canvas);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldFallBackToWebGL2(kind, preference)) throw new Error(message, { cause: error });
    kind = 'webgl2';
    renderer = createRenderer(kind);
    fallbackReason = message;
    await renderer.init(canvas);
  }

  const model = options.model ?? createSceneModel({ snapshot: options.snapshot ?? null });
  const runtime = new SceneRuntime(model.scene, renderer, canvas, {
    autoResize: true,
    enableInput: true,
    enableAudio,
  });
  runtime.setLights(model.lights);

  const spinTargets = model.turntable ? [model.turntable] : [];
  const spin = new SpinSystem(spinTargets, { degreesPerSecond: spinDegreesPerSecond });
  const meter = new FrameMeter();
  model.scene.world.addSystem(spin);
  model.scene.world.addSystem(meter);

  let disposed = false;

  return {
    scene: model.scene,
    runtime,
    renderer,
    rendererKind: kind,
    rendererLabel: describeRenderer(safeInfo(renderer)),
    fallbackReason,
    meter,
    spin,
    model,
    canSpin: spinTargets.length > 0,
    start(): void {
      if (!disposed) runtime.start();
    },
    pause(): void {
      if (!disposed) runtime.pause();
    },
    resume(): void {
      if (!disposed) runtime.resume();
    },
    stop(): void {
      if (!disposed) runtime.stop();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      model.scene.world.removeSystem(spin);
      model.scene.world.removeSystem(meter);
      runtime.dispose();
      renderer.dispose();
    },
    info(): RendererInfo | null {
      return safeInfo(renderer);
    },
    summary(): { entities: number; meshes: number } {
      return summarizeScene(model.scene);
    },
  };
}

function safeInfo(renderer: Renderer): RendererInfo | null {
  try {
    return renderer.getInfo();
  } catch {
    /* Backends throw when they were never initialized or already torn down, and
       the HUD uses this for display only. */
    return null;
  }
}
