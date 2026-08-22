import { BaseComponent, type Entity, type PropertyGroup } from "@web-engine/engine-core";
import { Camera, ProjectionType } from "@web-engine/engine-renderer";

export class CameraComponent extends BaseComponent {
  override readonly type = "camera";
  camera: Camera;
  isPrimary: boolean;

  constructor(entity: Entity, camera: Camera | null = null, isPrimary = false) {
    super(entity);
    this.camera = camera ?? new Camera(`${entity.id}:camera`);
    this.isPrimary = isPrimary;
  }

  override toJSON(): Record<string, unknown> {
    return {
      isPrimary: this.isPrimary,
      projectionType: this.camera.projectionType,
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
    };
  }

  static fromJSON(entity: Entity, data: Record<string, unknown>): CameraComponent {
    const component = new CameraComponent(entity, null, Boolean(data["isPrimary"]));
    if (data["projectionType"] === ProjectionType.Orthographic) {
      component.camera.projectionType = ProjectionType.Orthographic;
    } else {
      component.camera.projectionType = ProjectionType.Perspective;
    }
    component.camera.fov = Number(data["fov"] ?? 60);
    component.camera.near = Number(data["near"] ?? 0.1);
    component.camera.far = Number(data["far"] ?? 1000);
    return component;
  }

  getProperties(): PropertyGroup[] {
    const camera = this.camera;
    return [
      {
        label: "Camera",
        properties: [
          {
            key: "isPrimary",
            label: "Primary",
            type: "boolean",
            get: () => this.isPrimary,
            set: (value) => {
              this.isPrimary = Boolean(value);
            },
          },
          {
            key: "projectionType",
            label: "Projection",
            type: "enum",
            options: [
              { label: "Perspective", value: ProjectionType.Perspective },
              { label: "Orthographic", value: ProjectionType.Orthographic },
            ],
            get: () => camera.projectionType,
            set: (value) => {
              camera.projectionType = value as ProjectionType;
            },
          },
          {
            key: "fov",
            label: "Field of View",
            type: "number",
            min: 1,
            max: 179,
            step: 0.1,
            get: () => camera.fov,
            set: (value) => {
              camera.fov = Number(value);
            },
          },
          {
            key: "near",
            label: "Near",
            type: "number",
            min: 0.001,
            step: 0.001,
            get: () => camera.near,
            set: (value) => {
              camera.near = Number(value);
            },
          },
          {
            key: "far",
            label: "Far",
            type: "number",
            min: 0.1,
            step: 1,
            get: () => camera.far,
            set: (value) => {
              camera.far = Number(value);
            },
          },
        ],
      },
    ];
  }
}
