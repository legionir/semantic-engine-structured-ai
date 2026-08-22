import { WorkerPoolManager } from "./WorkerPoolManager.js";
import type {
  FrustumCullingInput,
  FrustumCullingRenderable,
  FrustumCullingOutput,
} from "./workers/FrustumCullingWorker.js";
import type {
  LODInput,
  LODRenderable,
  LODOutput,
  LODLevel,
} from "./workers/LODWorker.js";
import type {
  InstancingInput,
  InstancingRenderable,
  InstancingOutput,
  InstanceGroup,
} from "./workers/InstancingWorker.js";

/**
 * Configuration for the parallel performance pipeline.
 */
export interface PerformanceManagerOptions {
  /** Worker pool size per worker type. Defaults to hardwareConcurrency / 2. */
  poolSize?: number;
  /** Global LOD distance bias. < 1 makes LODs switch closer, > 1 farther. */
  globalLODBias?: number;
  /** Maximum instances per draw batch. Defaults to 256. */
  maxBatchSize?: number;
  /** Enable/disable frustum culling. Defaults to true. */
  enableCulling?: boolean;
  /** Enable/disable LOD selection. Defaults to true. */
  enableLOD?: boolean;
  /** Enable/disable instancing batching. Defaults to true. */
  enableInstancing?: boolean;
}

/**
 * Renderable snapshot for the performance pipeline.
 */
export interface PerformanceRenderable {
  id: string;
  worldMatrix: Float64Array;
  center: [number, number, number];
  radius: number;
  meshId: string;
  materialId: string;
  visible: boolean;
  lodLevels: LODLevel[];
}

/**
 * Result of the performance pipeline each frame.
 */
export interface PerformanceResult {
  /** Renderable ids that passed frustum culling. */
  visibleIds: string[];
  /** LOD level selected for each visible renderable (same order as visibleIds). */
  lodLevels: number[];
  /** Instance groups for batched rendering. */
  instanceGroups: InstanceGroup[];
  /** Total draw calls after batching. */
  drawCallCount: number;
  /** Timing breakdown in ms. */
  timings: {
    total: number;
    culling: number;
    lod: number;
    instancing: number;
  };
}

/**
 * Orchestrates the parallel performance pipeline:
 *   frustum culling → LOD selection → instancing batching
 * using Web Workers for each stage.
 */
export class PerformanceManager {
  private cullingPool: WorkerPoolManager | null = null;
  private lodPool: WorkerPoolManager | null = null;
  private instancingPool: WorkerPoolManager | null = null;
  private readonly options: Required<PerformanceManagerOptions>;
  private initialized = false;

  constructor(options: PerformanceManagerOptions = {}) {
    const defaultPoolSize = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
    this.options = {
      poolSize: options.poolSize ?? defaultPoolSize,
      globalLODBias: options.globalLODBias ?? 1.0,
      maxBatchSize: options.maxBatchSize ?? 256,
      enableCulling: options.enableCulling ?? true,
      enableLOD: options.enableLOD ?? true,
      enableInstancing: options.enableInstancing ?? true,
    };
  }

  /**
   * Initialise worker pools. Must be called once before process() is called.
   * Call this after the first user interaction since browsers require user
   * gesture to create workers in some contexts.
   */
  init(): void {
    if (this.initialized) return;

    const poolSize = this.options.poolSize;

    if (this.options.enableCulling) {
      this.cullingPool = new WorkerPoolManager(
        new URL("./workers/FrustumCullingWorker.js", import.meta.url),
        poolSize,
      );
    }

    if (this.options.enableLOD) {
      this.lodPool = new WorkerPoolManager(
        new URL("./workers/LODWorker.js", import.meta.url),
        poolSize,
      );
    }

    if (this.options.enableInstancing) {
      this.instancingPool = new WorkerPoolManager(
        new URL("./workers/InstancingWorker.js", import.meta.url),
        poolSize,
      );
    }

    this.initialized = true;
  }

  /**
   * Run the full performance pipeline: culling → LOD → instancing.
   * @param renderables - Snapshot of all renderables in the scene.
   * @param viewProj - The combined view-projection matrix as 16 float64.
   * @param cameraPos - Camera world position for LOD distance calc.
   * @returns Promise resolving to PerformanceResult.
   */
  async process(
    renderables: PerformanceRenderable[],
    viewProj: Float64Array,
    cameraPos: [number, number, number],
  ): Promise<PerformanceResult> {
    if (!this.initialized) {
      this.init();
    }

    const start = performance.now();
    const timings = { total: 0, culling: 0, lod: 0, instancing: 0 };

    // ── Stage 1: Frustum Culling ────────────────────────────────────
    let visibleIndices: number[] = [];
    let visibleRenderables: PerformanceRenderable[] = [];

    if (this.cullingPool) {
      const t0 = performance.now();

      const cullingInput: FrustumCullingInput = {
        viewProj,
        renderables: renderables.map((r) => ({
          worldMatrix: r.worldMatrix,
          center: r.center,
          radius: r.radius,
        })),
      };

      const cullingResult = await this.cullingPool.run<FrustumCullingOutput>(
        cullingInput,
        [viewProj.buffer],
      );

      visibleIndices = cullingResult.visibleIndices;
      visibleRenderables = visibleIndices.map((i) => renderables[i]);
      timings.culling = performance.now() - t0;
    } else {
      // No culling: all renderables are visible
      visibleIndices = renderables.map((_, i) => i);
      visibleRenderables = renderables;
    }

    // ── Stage 2: LOD Selection ──────────────────────────────────────
    let selectedLODs: number[] = [];

    if (this.lodPool && this.options.enableLOD) {
      const t0 = performance.now();

      const lodInput: LODInput = {
        cameraPos,
        renderables: visibleRenderables.map((r) => ({
          center: r.center,
          radius: r.radius,
          lodLevels: r.lodLevels,
        })),
        globalLODBias: this.options.globalLODBias,
      };

      const lodResult = await this.lodPool.run<LODOutput>(lodInput);
      selectedLODs = lodResult.selectedLODs;
      timings.lod = performance.now() - t0;
    } else {
      // No LOD: all at level 0
      selectedLODs = visibleRenderables.map(() => 0);
    }

    // ── Stage 3: Instancing Batching ────────────────────────────────
    let instanceGroups: InstanceGroup[] = [];
    let drawCallCount = 0;

    if (this.instancingPool && this.options.enableInstancing) {
      const t0 = performance.now();

      const instancingInput: InstancingInput = {
        renderables: visibleRenderables.map((r, i) => ({
          worldMatrix: r.worldMatrix,
          meshId: r.meshId,
          materialId: r.materialId,
          lodFactor: r.lodLevels[selectedLODs[i]]?.lodFactor ?? 1.0,
        })),
        visibleIndices: visibleIndices,
        maxBatchSize: this.options.maxBatchSize,
      };

      const instancingResult = await this.instancingPool.run<InstancingOutput>(instancingInput);
      instanceGroups = instancingResult.groups;
      drawCallCount = instancingResult.drawCallCount;
      timings.instancing = performance.now() - t0;
    } else {
      // No instancing: each visible renderable is its own draw call
      drawCallCount = visibleRenderables.length;
    }

    timings.total = performance.now() - start;

    return {
      visibleIds: visibleRenderables.map((r) => r.id),
      lodLevels: selectedLODs,
      instanceGroups,
      drawCallCount,
      timings,
    };
  }

  /** Terminate all workers and free resources. */
  dispose(): void {
    this.cullingPool?.dispose();
    this.cullingPool = null;
    this.lodPool?.dispose();
    this.lodPool = null;
    this.instancingPool?.dispose();
    this.instancingPool = null;
    this.initialized = false;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}
