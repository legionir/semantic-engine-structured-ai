// Web Worker for Frustum Culling and LOD selection
// Runs off the main thread to keep rendering smooth

interface CullingInput {
  objects: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    boundingRadius: number;
    lodLevels: number;
  }>;
  camera: {
    position: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
    fov: number;
    aspect: number;
    near: number;
    far: number;
  };
}

interface CullingOutput {
  visible: string[];
  lodAssignments: Map<string, number>;
  stats: { total: number; visible: number; culled: number };
}

function isInFrustum(obj: CullingInput['objects'][0], camera: CullingInput['camera']): boolean {
  // Simple sphere-frustum test
  const dx = obj.position.x - camera.position.x;
  const dy = obj.position.y - camera.position.y;
  const dz = obj.position.z - camera.position.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Check far/near plane
  if (dist > camera.far + obj.boundingRadius) return false;
  if (dist < camera.near - obj.boundingRadius) return false;

  // Check view cone
  const halfFov = (camera.fov / 2) * (Math.PI / 180);
  const viewAngle = Math.acos(
    (dx * camera.forward.x + dy * camera.forward.y + dz * camera.forward.z) / dist
  );

  return viewAngle < halfFov + Math.atan(obj.boundingRadius / dist);
}

function calculateLOD(obj: CullingInput['objects'][0], camera: CullingInput['camera']): number {
  const dx = obj.position.x - camera.position.x;
  const dy = obj.position.y - camera.position.y;
  const dz = obj.position.z - camera.position.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Normalize distance to 0-1 range
  const normalizedDist = Math.min(dist / camera.far, 1);

  // Calculate LOD level (0 = highest detail)
  const lod = Math.min(
    Math.floor(normalizedDist * obj.lodLevels),
    obj.lodLevels - 1
  );

  return lod;
}

self.onmessage = (event: MessageEvent<CullingInput>) => {
  const { objects, camera } = event.data;
  const visible: string[] = [];
  const lodAssignments = new Map<string, number>();

  for (const obj of objects) {
    if (isInFrustum(obj, camera)) {
      visible.push(obj.id);
      lodAssignments.set(obj.id, calculateLOD(obj, camera));
    }
  }

  const output: CullingOutput = {
    visible,
    lodAssignments,
    stats: {
      total: objects.length,
      visible: visible.length,
      culled: objects.length - visible.length,
    },
  };

  self.postMessage(output);
};