// Web Worker for Instance Management
// Handles instance data transforms and updates off the main thread

export interface InstanceData {
  id: string;
  meshId: string;
  transform: Float32Array; // 4x4 matrix
  color?: [number, number, number, number];
}

export interface InstancingInput {
  instances: InstanceData[];
  cameraPosition: { x: number; y: number; z: number };
  maxInstances: number;
}

export interface InstancingOutput {
  sortedInstances: string[];
  instanceMatrices: Float32Array;
  instanceCount: number;
}

function sortByDistance(instances: InstanceData[], cameraPos: { x: number; y: number; z: number }): string[] {
  return instances
    .map(inst => ({
      id: inst.id,
      distSq: Math.pow(inst.transform[12] - cameraPos.x, 2) +
               Math.pow(inst.transform[13] - cameraPos.y, 2) +
               Math.pow(inst.transform[14] - cameraPos.z, 2),
    }))
    .sort((a, b) => a.distSq - b.distSq)
    .map(i => i.id);
}

function buildInstanceBuffer(instances: InstanceData[], sortedIds: string[]): Float32Array {
  const buffer = new Float32Array(sortedIds.length * 16);
  let offset = 0;

  for (const id of sortedIds) {
    const inst = instances.find(i => i.id === id);
    if (inst) {
      buffer.set(inst.transform, offset);
      offset += 16;
    }
  }

  return buffer;
}

self.onmessage = (event: MessageEvent<InstancingInput>) => {
  const { instances, cameraPosition, maxInstances } = event.data;

  // Limit instances
  const limited = instances.slice(0, maxInstances);

  // Sort by distance (front-to-back for correct alpha blending)
  const sortedIds = sortByDistance(limited, cameraPosition);

  // Build the instance matrix buffer
  const instanceMatrices = buildInstanceBuffer(limited, sortedIds);

  const output: InstancingOutput = {
    sortedInstances: sortedIds,
    instanceMatrices,
    instanceCount: limited.length,
  };

  self.postMessage(output, [instanceMatrices.buffer]);
};