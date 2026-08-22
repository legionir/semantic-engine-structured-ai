import type { Mat4} from "@web-engine/engine-core";
import { type Vec3 } from "@web-engine/engine-core";
import type { Camera } from "./Camera.js";
import type { Light } from "./Light.js";
import type { Material } from "./Material.js";
import type { Mesh } from "./Mesh.js";

export interface Renderable {
  id: string;
  mesh: Mesh;
  material: Material;
  worldMatrix: Mat4;
  /** World-space bounding sphere for culling. */
  boundingSphereRadius: number;
  /** World-space center for culling. */
  boundingSphereCenter: Vec3;
  visible: boolean;
  castShadow: boolean;
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  vertices: number;
}

export interface RendererInfo {
  name: string;
  renderer: "webgpu" | "webgl2";
  capabilities: {
    maxTextureSize: number;
    maxUniformBuffers: number;
    webgl2: boolean;
    webgpu: boolean;
  };
}

export interface Renderer {
  readonly name: string;
  readonly kind: "webgpu" | "webgl2";

  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number): void;

  createMeshResources(mesh: Mesh): void;
  destroyMeshResources(mesh: Mesh): void;
  createMaterialResources(material: Material): void;
  destroyMaterialResources(material: Material): void;

  render(renderables: Renderable[], camera: Camera, lights: Light[], clearColor?: Vec3): RenderStats;
  getInfo(): RendererInfo;
  dispose(): void;
}
