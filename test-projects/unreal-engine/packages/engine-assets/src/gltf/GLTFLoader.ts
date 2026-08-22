import type { TransformComponent } from "@web-engine/engine-core";
import { Mat4, Quat, Vec3, type Vec3 as Vec3Type, type Quat as QuatType, generateUUID, type Scene, type Entity } from "@web-engine/engine-core";
import { Material, Mesh, MeshTopology, type MaterialParams } from "@web-engine/engine-renderer";
import { parseGLB, decodeAccessor, decodeIndices, getAccessorData } from "./GLBParser.js";
import type { GLTFDocument } from "./types.js";
import { GLTFComponentType, GLTFAttributeType } from "./types.js";

export interface LoadedGLTFFile {
  meshes: Mesh[];
  materials: Material[];
  nodes: LoadedGLTFNode[];
  rootNodes: number[];
  images: Map<number, HTMLImageElement>;
}

export interface LoadedGLTFNode {
  index: number;
  name: string;
  meshIndex: number | undefined;
  materialIndices: number[];
  translation: Vec3Type;
  rotation: QuatType;
  scale: Vec3Type;
  children: number[];
  parent: number | undefined;
}

export interface GLTFLoadOptions {
  idPrefix?: string;
  extractImages?: boolean;
  onImageLoaded?: (index: number, image: HTMLImageElement) => void;
}

export interface GLTFLoadResult {
  meshes: Mesh[];
  materials: Material[];
  nodes: LoadedGLTFNode[];
  rootNodeIndices: number[];
  images: Map<number, HTMLImageElement>;
}

export async function loadGLB(
  data: ArrayBuffer,
  options: GLTFLoadOptions = {},
): Promise<GLTFLoadResult> {
  const { json, binaryChunk } = parseGLB(data);
  const prefix = options.idPrefix ?? generateUUID();

  const materials = loadMaterials(json, prefix);
  const meshes = loadMeshes(json, binaryChunk, prefix);
  const { nodes, rootNodeIndices } = loadNodes(json, prefix);
  const images = await loadImages(json, binaryChunk, options);

  return { meshes, materials, nodes, rootNodeIndices, images };
}

function loadMaterials(doc: GLTFDocument, prefix: string): Material[] {
  const materials: Material[] = [];
  if (!doc.materials) return materials;
  for (let i = 0; i < doc.materials.length; i++) {
    const gltfMaterial = doc.materials[i];
    const params: MaterialParams = {
      name: gltfMaterial.name ?? `Material ${i}`,
      metallic: gltfMaterial.pbrMetallicRoughness?.metallicFactor ?? 0,
      roughness: gltfMaterial.pbrMetallicRoughness?.roughnessFactor ?? 1,
      opacity: gltfMaterial.alphaMode === "BLEND" ? 1 : 1,
    };
    if (gltfMaterial.pbrMetallicRoughness?.baseColorFactor) {
      params.baseColor = [...gltfMaterial.pbrMetallicRoughness.baseColorFactor] as [number, number, number, number];
    }
    materials.push(new Material(`${prefix}:material:${i}`, params));
  }
  return materials;
}

function loadMeshes(doc: GLTFDocument, binaryChunk: ArrayBuffer | null, prefix: string): Mesh[] {
  const meshes: Mesh[] = [];
  if (!doc.meshes) return meshes;
  for (let i = 0; i < doc.meshes.length; i++) {
    const gltfMesh = doc.meshes[i];
    const primitives = gltfMesh.primitives.map((primitive) => {
      const positionsRaw = getAccessorData(doc, primitive.attributes["POSITION"], binaryChunk);
      const positions = decodeAccessor(positionsRaw.data, positionsRaw.componentType, positionsRaw.type);

      let normals: Float32Array | undefined;
      if (primitive.attributes["NORMAL"] !== undefined) {
        const normalRaw = getAccessorData(doc, primitive.attributes["NORMAL"], binaryChunk);
        normals = decodeAccessor(normalRaw.data, normalRaw.componentType, normalRaw.type);
      }

      let uvs: Float32Array | undefined;
      if (primitive.attributes["TEXCOORD_0"] !== undefined) {
        const uvRaw = getAccessorData(doc, primitive.attributes["TEXCOORD_0"], binaryChunk);
        uvs = decodeAccessor(uvRaw.data, uvRaw.componentType, uvRaw.type);
      }

      let indices: Uint32Array | Uint16Array | undefined;
      if (primitive.indices !== undefined) {
        const indexRaw = getAccessorData(doc, primitive.indices, binaryChunk);
        indices = decodeIndices(indexRaw.data, indexRaw.componentType);
      }

      const mode = primitive.mode ?? 4;
      const topology = mode === 1 ? MeshTopology.Lines : mode === 0 ? MeshTopology.Points : MeshTopology.Triangles;

      return { positions, normals, uvs, indices, topology };
    });

    meshes.push(new Mesh(`${prefix}:mesh:${i}`, primitives, gltfMesh.name ?? `Mesh ${i}`));
  }
  return meshes;
}

function loadNodes(doc: GLTFDocument, _prefix: string): { nodes: LoadedGLTFNode[]; rootNodeIndices: number[] } {
  const nodes: LoadedGLTFNode[] = [];
  if (!doc.nodes) return { nodes, rootNodeIndices: [] };

  for (let i = 0; i < doc.nodes.length; i++) {
    const node = doc.nodes[i];
    const matrix = node.matrix;
    let translation: Vec3Type = [0, 0, 0];
    let rotation: QuatType = [0, 0, 0, 1];
    let scale: Vec3Type = [1, 1, 1];

    if (matrix) {
      const m = Mat4.fromValues(
        matrix[0], matrix[1], matrix[2], matrix[3],
        matrix[4], matrix[5], matrix[6], matrix[7],
        matrix[8], matrix[9], matrix[10], matrix[11],
        matrix[12], matrix[13], matrix[14], matrix[15],
      );
      Mat4.getTranslation(translation, m);
      const sx = Vec3.length(Vec3.fromValues(m[0], m[1], m[2]));
      const sy = Vec3.length(Vec3.fromValues(m[4], m[5], m[6]));
      const sz = Vec3.length(Vec3.fromValues(m[8], m[9], m[10]));
      scale = [sx, sy, sz];
      const norm = (v: number) => (Math.abs(v) > 1e-6 ? v : 0);
      const rm = [
        norm(m[0] / sx), norm(m[1] / sx), norm(m[2] / sx),
        norm(m[4] / sy), norm(m[5] / sy), norm(m[6] / sy),
        norm(m[8] / sz), norm(m[9] / sz), norm(m[10] / sz),
      ];
      Quat.fromMat3(rotation, rm as unknown as Float32Array);
    }
    if (node.translation) translation = [node.translation[0], node.translation[1], node.translation[2]];
    if (node.rotation) rotation = [node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]];
    if (node.scale) scale = [node.scale[0], node.scale[1], node.scale[2]];

    const materialIndices: number[] = [];
    if (node.mesh !== undefined) {
      const gltfMesh = doc.meshes?.[node.mesh];
      gltfMesh?.primitives.forEach((primitive) => {
        if (primitive.material !== undefined) materialIndices.push(primitive.material);
      });
    }

    nodes.push({
      index: i,
      name: node.name ?? `Node ${i}`,
      meshIndex: node.mesh,
      materialIndices,
      translation,
      rotation,
      scale,
      children: node.children ?? [],
      parent: undefined,
    });
  }

  nodes.forEach((node) => {
    node.children.forEach((childIndex) => {
      if (nodes[childIndex]) nodes[childIndex].parent = node.index;
    });
  });

  const rootNodeIndices = nodes.filter((n) => n.parent === undefined).map((n) => n.index);
  return { nodes, rootNodeIndices };
}

async function loadImages(doc: GLTFDocument, binaryChunk: ArrayBuffer | null, options: GLTFLoadOptions): Promise<Map<number, HTMLImageElement>> {
  const images = new Map<number, HTMLImageElement>();
  if (!doc.images) return images;
  if (options.extractImages === false) return images;

  const loadOne = (index: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      const gltfImage = doc.images![index];
      const img = new Image();
      const onLoad = () => {
        images.set(index, img);
        options.onImageLoaded?.(index, img);
        resolve();
      };
      const onError = () => reject(new Error(`Failed to load glTF image ${index}`));

      if (gltfImage.uri && gltfImage.uri.startsWith("data:")) {
        img.onload = onLoad;
        img.onerror = onError;
        img.src = gltfImage.uri;
      } else if (gltfImage.bufferView !== undefined && binaryChunk) {
        const bufferView = doc.bufferViews?.[gltfImage.bufferView];
        if (!bufferView) {
          resolve();
          return;
        }
        const offset = bufferView.byteOffset ?? 0;
        const blob = new Blob([new Uint8Array(binaryChunk, offset, bufferView.byteLength)], {
          type: gltfImage.mimeType ?? "image/png",
        });
        img.onload = onLoad;
        img.onerror = onError;
        img.src = URL.createObjectURL(blob);
      } else {
        resolve();
      }
    });
  };

  await Promise.all(doc.images.map((_img, index) => loadOne(index).catch(() => undefined)));
  return images;
}

export async function loadGLBIntoScene(
  data: ArrayBuffer,
  scene: Scene,
  options: GLTFLoadOptions = {},
): Promise<{ entities: Entity[] }> {
  const result = await loadGLB(data, options);

  const entityByNode = new Map<number, Entity>();

  for (const node of result.nodes) {
    const name = node.name;
    const entity = scene.createEntity(name);
    const transform = entity.getComponent<TransformComponent>("transform")!;
    transform.position = node.translation;
    transform.rotation = node.rotation;
    transform.scale = node.scale;
    entityByNode.set(node.index, entity);
  }

  for (const node of result.nodes) {
    const entity = entityByNode.get(node.index)!;
    if (node.parent !== undefined && entityByNode.has(node.parent)) {
      const parentTransform = entityByNode.get(node.parent)!.getComponent<TransformComponent>("transform")!;
      parentTransform.addChild(entity.getComponent<TransformComponent>("transform")!);
    }
  }

  return { entities: [...entityByNode.values()] };
}

export { GLTFComponentType, GLTFAttributeType };
