import { CullingInput, CullingOutput } from './workers/culling.worker';
import { InstancingInput, InstancingOutput } from './workers/instancing.worker';

export class PerformanceManager {
  private cullingWorker: Worker | null = null;
  private instancingWorker: Worker | null = null;
  private workerReady: boolean = false;

  async initialize(): Promise<void> {
    try {
      this.cullingWorker = new Worker(
        new URL('./workers/culling.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.instancingWorker = new Worker(
        new URL('./workers/instancing.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.workerReady = true;
    } catch (err) {
      console.warn('Web Workers not available, falling back to main thread', err);
      this.workerReady = false;
    }
  }

  async performCulling(input: CullingInput): Promise<CullingOutput> {
    if (!this.cullingWorker || !this.workerReady) {
      return this.mainThreadCulling(input);
    }
    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<CullingOutput>) => {
        this.cullingWorker!.removeEventListener('message', handler);
        this.cullingWorker!.removeEventListener('error', handler);
        resolve(event.data);
      };
      this.cullingWorker!.addEventListener('message', handler);
      this.cullingWorker!.addEventListener('error', () => reject(new Error('Culling worker error')));
      this.cullingWorker!.postMessage(input);
    });
  }

  async performInstancing(input: InstancingInput): Promise<InstancingOutput> {
    if (!this.instancingWorker || !this.workerReady) {
      return this.mainThreadInstancing(input);
    }
    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<InstancingOutput>) => {
        this.instancingWorker!.removeEventListener('message', handler);
        this.instancingWorker!.removeEventListener('error', handler);
        resolve(event.data);
      };
      this.instancingWorker!.addEventListener('message', handler);
      this.instancingWorker!.addEventListener('error', () => reject(new Error('Instancing worker error')));
      this.instancingWorker!.postMessage(input, [input.instances[0]?.transform?.buffer].filter(Boolean));
    });
  }

  private mainThreadCulling(input: CullingInput): CullingOutput {
    const visible: string[] = [];
    const lodAssignments = new Map<string, number>();
    for (const obj of input.objects) {
      const dx = obj.position.x - input.camera.position.x;
      const dy = obj.position.y - input.camera.position.y;
      const dz = obj.position.z - input.camera.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < input.camera.far + obj.boundingRadius && dist > input.camera.near - obj.boundingRadius) {
        visible.push(obj.id);
        const normalizedDist = Math.min(dist / input.camera.far, 1);
        lodAssignments.set(obj.id, Math.min(Math.floor(normalizedDist * obj.lodLevels), obj.lodLevels - 1));
      }
    }
    return { visible, lodAssignments, stats: { total: input.objects.length, visible: visible.length, culled: input.objects.length - visible.length } };
  }

  private mainThreadInstancing(input: InstancingInput): InstancingOutput {
    const limited = input.instances.slice(0, input.maxInstances);
    const sortedIds = limited.map(inst => ({ id: inst.id, distSq: Math.pow(inst.transform[12] - input.cameraPosition.x, 2) + Math.pow(inst.transform[13] - input.cameraPosition.y, 2) + Math.pow(inst.transform[14] - input.cameraPosition.z, 2) })).sort((a, b) => a.distSq - b.distSq).map(i => i.id);
    const instanceMatrices = new Float32Array(sortedIds.length * 16);
    let offset = 0;
    for (const id of sortedIds) {
      const inst = limited.find(i => i.id === id);
      if (inst) { instanceMatrices.set(inst.transform, offset); offset += 16; }
    }
    return { sortedInstances: sortedIds, instanceMatrices, instanceCount: limited.length };
  }

  isReady(): boolean { return this.workerReady; }

  terminate(): void {
    this.cullingWorker?.terminate();
    this.instancingWorker?.terminate();
    this.cullingWorker = null;
    this.instancingWorker = null;
    this.workerReady = false;
  }
}