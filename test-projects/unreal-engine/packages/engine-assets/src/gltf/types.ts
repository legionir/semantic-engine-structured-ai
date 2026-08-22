export interface GLTFAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

export interface GLTFBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

export interface GLTFBuffer {
  uri?: string;
  byteLength: number;
}

export interface GLTFTexture {
  source?: number;
}

export interface GLTFImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

export interface GLTFMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  normalTexture?: { index: number };
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
}

export interface GLTFMeshPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GLTFMesh {
  name?: string;
  primitives: GLTFMeshPrimitive[];
}

export interface GLTFNode {
  name?: string;
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GLTFScene {
  nodes?: number[];
}

export interface GLTFDocument {
  asset: { version: string };
  buffers?: GLTFBuffer[];
  bufferViews?: GLTFBufferView[];
  accessors?: GLTFAccessor[];
  materials?: GLTFMaterial[];
  meshes?: GLTFMesh[];
  nodes?: GLTFNode[];
  scenes?: GLTFScene[];
  scene?: number;
  textures?: GLTFTexture[];
  images?: GLTFImage[];
  extensionsUsed?: string[];
}

export const GLTFComponentType = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
} as const;

export const GLTFAttributeType = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
} as const;

export type { GLTFAccessor as Accessor, GLTFBufferView as BufferView, GLTFDocument as Document };
