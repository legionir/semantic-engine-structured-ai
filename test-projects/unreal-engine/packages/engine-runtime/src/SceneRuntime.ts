import { createTransformSystem, type Scene, type TransformSystem } from "@web-engine/engine-core";
import type { Light, Renderer } from "@web-engine/engine-renderer";
import { Camera } from "@web-engine/engine-renderer";
import { InputSystem } from "@web-engine/engine-input";
import { AudioSystem } from "@web-engine/engine-audio";
import { RenderSystem } from "./systems/RenderSystem.js";
import { CameraSyncSystem } from "./systems/CameraSyncSystem.js";
import type { CameraComponent } from "./components/CameraComponent.js";

export interface SceneRuntimeOptions {
  clearColor?: [number, number, number];
  defaultCamera?: Camera;
  autoResize?: boolean;
  /**
   * Whether to attach the input system to the canvas element.
   * Defaults to true.
   */
  enableInput?: boolean;
  /**
   * Whether to enable the audio system. Defaults to false.
   * Requires an AudioContext which may need user gesture to create.
   */
  enableAudio?: boolean;
}

export class SceneRuntime {
  readonly renderSystem: RenderSystem;
  readonly inputSystem: InputSystem;
  readonly audioSystem: AudioSystem | null;
  camera: Camera;
  readonly lights: Light[] = [];
  clearColor: [number, number, number];

  private readonly transformSystem: TransformSystem;
  private readonly cameraSyncSystem: CameraSyncSystem;
  private running = false;
  private paused = false;
  private frameHandle = 0;
  private lastTime = 0;
  private readonly autoResize: boolean;
  private readonly enableInput: boolean;
  private readonly enableAudio: boolean;
  private readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene: Scene;
  private detachInput: (() => void) | null = null;
  private audioContext: AudioContext | null = null;

  constructor(
    scene: Scene,
    renderer: Renderer,
    canvas: HTMLCanvasElement,
    options: SceneRuntimeOptions = {},
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.canvas = canvas;
    this.renderSystem = new RenderSystem(scene.world, renderer);
    this.inputSystem = new InputSystem(scene.world);
    this.clearColor = options.clearColor ?? [0.1, 0.12, 0.16];
    this.autoResize = options.autoResize ?? true;
    this.enableInput = options.enableInput ?? true;
    this.enableAudio = options.enableAudio ?? false;
    this.camera = options.defaultCamera ?? new Camera("runtime-camera");

    this.transformSystem = createTransformSystem(scene.world);
    this.cameraSyncSystem = new CameraSyncSystem(scene.world);
    scene.world.addSystem(this.transformSystem);
    scene.world.addSystem(this.cameraSyncSystem);

    // Audio system
    if (this.enableAudio) {
      this.audioContext = new AudioContext();
      this.audioSystem = new AudioSystem(scene.world, this.audioContext);
      scene.world.addSystem(this.audioSystem);
    } else {
      this.audioSystem = null;
    }

    const primaryCamera = scene.world.query<CameraComponent>("camera").find((c) => c.isPrimary);
    if (primaryCamera) {
      this.camera = primaryCamera.camera;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setLights(lights: Light[]): void {
    this.lights.length = 0;
    this.lights.push(...lights);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();

    // Attach input system to canvas
    if (this.enableInput) {
      this.detachInput = this.inputSystem.attachToElement(this.canvas);
      this.inputSystem.setupDefaultBindings();
    }

    // Resume audio context (needed after user gesture)
    if (this.audioContext?.state === "suspended") {
      this.audioContext.resume();
    }

    this.frameHandle = requestAnimationFrame(this.loop);
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    cancelAnimationFrame(this.frameHandle);

    // Suspend audio
    this.audioContext?.suspend();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.loop);

    // Resume audio
    this.audioContext?.resume();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.frameHandle);

    // Detach input listeners
    if (this.detachInput) {
      this.detachInput();
      this.detachInput = null;
    }

    this.inputSystem.reset();

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  tick(): void {
    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.update(delta);
  }

  update(deltaTime: number): void {
    this.scene.world.update(deltaTime);
    if (this.autoResize) {
      this.handleResize();
    }
    this.renderSystem.render(this.camera, this.lights, this.clearColor);

    // Reset input per-frame state
    this.inputSystem.reset();
  }

  dispose(): void {
    this.stop();
    this.renderSystem.dispose();
    this.audioSystem?.dispose();
    this.scene.world.clear();
  }

  private readonly loop = (): void => {
    if (!this.running || this.paused) return;
    this.tick();
    this.frameHandle = requestAnimationFrame(this.loop);
  };

  private handleResize(): void {
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.renderer.resize(width, height);
    }
    if (width > 0 && height > 0) {
      this.camera.updateProjectionMatrix(width / height);
    }
  }
}
