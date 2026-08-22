import { BaseComponent, type Entity, type PropertyGroup, type Vec4 } from "@web-engine/engine-core";
import type { Mesh } from "@web-engine/engine-renderer";
import { Material } from "@web-engine/engine-renderer";

export class MeshComponent extends BaseComponent {
  override readonly type = "mesh";
  mesh: Mesh | null;
  visible: boolean;
  castShadow: boolean;

  constructor(entity: Entity, mesh: Mesh | null = null, visible = true, castShadow = false) {
    super(entity);
    this.mesh = mesh;
    this.visible = visible;
    this.castShadow = castShadow;
  }

  override toJSON(): Record<string, unknown> {
    return {
      mesh: this.mesh?.id ?? null,
      visible: this.visible,
      castShadow: this.castShadow,
    };
  }

  getProperties(): PropertyGroup[] {
    return [
      {
        label: "Mesh",
        properties: [
          {
            key: "visible",
            label: "Visible",
            type: "boolean",
            get: () => this.visible,
            set: (value) => {
              this.visible = Boolean(value);
            },
          },
          {
            key: "castShadow",
            label: "Cast Shadow",
            type: "boolean",
            get: () => this.castShadow,
            set: (value) => {
              this.castShadow = Boolean(value);
            },
          },
        ],
      },
    ];
  }
}

export class MaterialComponent extends BaseComponent {
  override readonly type = "material";
  material: Material;

  constructor(entity: Entity, material: Material | null = null) {
    super(entity);
    this.material = material ?? new Material(`${entity.id}:material`);
  }

  override toJSON(): Record<string, unknown> {
    return { material: this.material.toJSON() };
  }

  getProperties(): PropertyGroup[] {
    const material = this.material;
    return [
      {
        label: "Material",
        properties: [
          {
            key: "baseColor",
            label: "Base Color",
            type: "color",
            get: () => [...material.baseColor],
            set: (value) => {
              material.baseColor = value as Vec4;
            },
          },
          {
            key: "metallic",
            label: "Metallic",
            type: "number",
            min: 0,
            max: 1,
            step: 0.01,
            get: () => material.metallic,
            set: (value) => {
              material.metallic = Number(value);
            },
          },
          {
            key: "roughness",
            label: "Roughness",
            type: "number",
            min: 0,
            max: 1,
            step: 0.01,
            get: () => material.roughness,
            set: (value) => {
              material.roughness = Number(value);
            },
          },
          {
            key: "emissive",
            label: "Emissive",
            type: "color",
            get: () => [...material.emissive],
            set: (value) => {
              material.emissive = value as Vec4;
            },
          },
          {
            key: "opacity",
            label: "Opacity",
            type: "number",
            min: 0,
            max: 1,
            step: 0.01,
            get: () => material.opacity,
            set: (value) => {
              material.opacity = Number(value);
            },
          },
        ],
      },
    ];
  }
}
