import { type Scene, type Entity, TransformComponent } from "@web-engine/engine-core";
import { Material, Mesh } from "@web-engine/engine-renderer";
import { loadGLB, type GLTFLoadOptions } from "@web-engine/engine-assets";
import { MeshComponent, MaterialComponent } from "../components/RenderComponents.js";

export interface GLBImportResult {
  entities: Entity[];
  meshes: Mesh[];
  materials: Material[];
}

/**
 * Loads a GLB/glTF binary file into a scene, creating entities with
 * transform, mesh and material components so they can be rendered by the
 * runtime RenderSystem. Returns the created entities plus the raw meshes
 * and materials for asset registration.
 */
export async function importGLBIntoScene(
  data: ArrayBuffer,
  scene: Scene,
  options: GLTFLoadOptions = {},
): Promise<GLBImportResult> {
  const result = await loadGLB(data, options);
  const entityByNode = new Map<number, Entity>();

  for (const node of result.nodes) {
    const entity = scene.createEntity(node.name);
    const transform = entity.getComponent<TransformComponent>("transform")!;
    transform.position = node.translation;
    transform.rotation = node.rotation;
    transform.scale = node.scale;

    if (node.meshIndex !== undefined) {
      const mesh = result.meshes[node.meshIndex];
      if (mesh) {
        entity.addComponent(new MeshComponent(entity, mesh));
        const material = resolveMaterial(node.materialIndices, result.materials);
        entity.addComponent(new MaterialComponent(entity, material));
      }
    }
    entityByNode.set(node.index, entity);
  }

  for (const node of result.nodes) {
    const entity = entityByNode.get(node.index)!;
    if (node.parent !== undefined && entityByNode.has(node.parent)) {
      const parentTransform = entityByNode.get(node.parent)!.getComponent<TransformComponent>("transform")!;
      parentTransform.addChild(entity.getComponent<TransformComponent>("transform")!);
    }
  }

  return { entities: [...entityByNode.values()], meshes: result.meshes, materials: result.materials };
}

function resolveMaterial(materialIndices: number[], materials: Material[]): Material | null {
  const index = materialIndices.find((i) => i < materials.length);
  if (index !== undefined) return materials[index];
  return materials[0] ?? null;
}
