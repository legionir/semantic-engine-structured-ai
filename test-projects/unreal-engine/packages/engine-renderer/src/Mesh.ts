import { createVec3, type Vec3 } from "@web-engine/engine-core";

export enum MeshTopology {
  Triangles = "triangles",
  Lines = "lines",
  Points = "points",
}

export interface MeshPrimitive {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint32Array | Uint16Array;
  topology: MeshTopology;
}

export class Mesh {
  readonly id: string;
  name: string;
  readonly primitives: MeshPrimitive[];

  constructor(id: string, primitives: MeshPrimitive[], name = "Mesh") {
    this.id = id;
    this.primitives = primitives;
    this.name = name;
  }

  get bounds(): { min: Vec3; max: Vec3 } {
    const min = createVec3(Infinity, Infinity, Infinity);
    const max = createVec3(-Infinity, -Infinity, -Infinity);
    for (const primitive of this.primitives) {
      const positions = primitive.positions;
      for (let i = 0; i < positions.length; i += 3) {
        min[0] = Math.min(min[0], positions[i]);
        min[1] = Math.min(min[1], positions[i + 1]);
        min[2] = Math.min(min[2], positions[i + 2]);
        max[0] = Math.max(max[0], positions[i]);
        max[1] = Math.max(max[1], positions[i + 1]);
        max[2] = Math.max(max[2], positions[i + 2]);
      }
    }
    return { min, max };
  }
}

export function createBoxMesh(id = "box", size = 1): Mesh {
  const s = size / 2;
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, -s, s, s, s, s, s, s, -s, s,
    -s, -s, -s, -s, -s, s, -s, s, s, -s, s, -s,
    s, -s, -s, s, s, -s, s, s, s, s, -s, s,
    -s, -s, -s, s, -s, -s, s, -s, s, -s, -s, s,
    -s, s, -s, -s, s, s, s, s, s, s, s, -s,
  ]);
  const normals = new Float32Array([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ]);
  return new Mesh(id, [{ positions, normals, indices, topology: MeshTopology.Triangles }]);
}

export function createSphereMesh(id = "sphere", radius = 0.5, widthSegments = 16, heightSegments = 12): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    const phi = v * Math.PI;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const theta = u * Math.PI * 2;
      const x = -radius * Math.cos(theta) * Math.sin(phi);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(theta) * Math.sin(phi);
      positions.push(x, y, z);
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      normals.push(x / len, y / len, z / len);
    }
  }

  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * (widthSegments + 1) + ix;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return new Mesh(id, [{
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    topology: MeshTopology.Triangles,
  }]);
}

export function createPlaneMesh(id = "plane", width = 1, height = 1): Mesh {
  const hw = width / 2;
  const hh = height / 2;
  return new Mesh(id, [{
    positions: new Float32Array([-hw, 0, -hh, hw, 0, -hh, hw, 0, hh, -hw, 0, hh]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    topology: MeshTopology.Triangles,
  }]);
}
