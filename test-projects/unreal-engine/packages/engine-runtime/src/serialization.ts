import { type ComponentFactory } from "@web-engine/engine-core";
import { Material, type Mesh } from "@web-engine/engine-renderer";
import { CameraComponent } from "./components/CameraComponent.js";
import { MaterialComponent, MeshComponent } from "./components/RenderComponents.js";

export interface RuntimeAssetLookup {
  getMesh(id: string): Mesh | null;
}

export function createRuntimeComponentFactories(lookup: Map<string, Mesh> | RuntimeAssetLookup): Map<string, ComponentFactory> {
  const getMesh = (id: string): Mesh | null => {
    if (lookup instanceof Map) {
      return lookup.get(id) ?? null;
    }
    return lookup.getMesh(id);
  };

  return new Map<string, ComponentFactory>([
    [
      "camera",
      (entity, data) => {
        entity.addComponent(CameraComponent.fromJSON(entity, data));
      },
    ],
    [
      "mesh",
      (entity, data) => {
        const meshId = data["mesh"] as string | null | undefined;
        const mesh = meshId ? getMesh(meshId) : null;
        const component = new MeshComponent(entity, mesh);
        component.visible = Boolean(data["visible"] ?? true);
        component.castShadow = Boolean(data["castShadow"] ?? false);
        entity.addComponent(component);
      },
    ],
    [
      "material",
      (entity, data) => {
        const materialData = data["material"] as Record<string, unknown> | undefined;
        const material = materialData ? Material.fromJSON(`${entity.id}:material`, materialData) : new Material(`${entity.id}:material`);
        entity.addComponent(new MaterialComponent(entity, material));
      },
    ],
  ]);
}
