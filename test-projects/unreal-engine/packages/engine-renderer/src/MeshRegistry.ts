import { Mesh, MeshTopology, type MeshPrimitive } from "./Mesh.js";

export interface MeshAssetPrimitiveJSON {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  indices?: number[];
  topology: MeshTopology;
}

export interface MeshAssetJSON {
  id: string;
  name: string;
  primitives: MeshAssetPrimitiveJSON[];
}

function toFlatArray(data: ArrayBufferView | undefined): number[] | undefined {
  if (!data) return undefined;
  return Array.from(data as unknown as number[]);
}

export class MeshRegistry {
  private readonly meshes = new Map<string, Mesh>();

  register(mesh: Mesh): void {
    this.meshes.set(mesh.id, mesh);
  }

  unregister(id: string): void {
    this.meshes.delete(id);
  }

  get(id: string): Mesh | undefined {
    return this.meshes.get(id);
  }

  getMesh(id: string): Mesh | null {
    return this.meshes.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.meshes.has(id);
  }

  all(): Mesh[] {
    return [...this.meshes.values()];
  }

  size(): number {
    return this.meshes.size;
  }

  clear(): void {
    this.meshes.clear();
  }

  toJSON(): MeshAssetJSON[] {
    return [...this.meshes.values()].map((mesh) => ({
      id: mesh.id,
      name: mesh.name,
      primitives: mesh.primitives.map((primitive) => ({
        positions: toFlatArray(primitive.positions) ?? [],
        normals: toFlatArray(primitive.normals),
        uvs: toFlatArray(primitive.uvs),
        indices: toFlatArray(primitive.indices),
        topology: primitive.topology,
      })),
    }));
  }

  fromJSON(assets: MeshAssetJSON[]): Mesh[] {
    const created: Mesh[] = [];
    for (const asset of assets) {
      const primitives: MeshPrimitive[] = asset.primitives.map((p) => {
        const primitive: MeshPrimitive = {
          positions: Float32Array.from(p.positions),
          topology: p.topology,
        };
        if (p.normals) primitive.normals = Float32Array.from(p.normals);
        if (p.uvs) primitive.uvs = Float32Array.from(p.uvs);
        if (p.indices) {
          primitive.indices = Uint32Array.from(p.indices);
        }
        return primitive;
      });
      const mesh = new Mesh(asset.id, primitives, asset.name);
      this.meshes.set(mesh.id, mesh);
      created.push(mesh);
    }
    return created;
  }
}
