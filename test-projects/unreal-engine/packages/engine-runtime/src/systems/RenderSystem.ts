import { Mat4, Vec3, type World } from "@web-engine/engine-core";
import type { Camera, Light} from "@web-engine/engine-renderer";
import { Material, type Renderer, type Renderable } from "@web-engine/engine-renderer";
import type { TransformComponent } from "@web-engine/engine-core";
import type { MeshComponent, MaterialComponent } from "../components/RenderComponents.js";

export class RenderSystem {
  readonly priority = 10;
  private readonly renderables = new Map<string, Renderable>();

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
  ) {}

  getRenderables(): Renderable[] {
    return [...this.renderables.values()];
  }

  updateRenderables(): void {
    const seen = new Set<string>();
    this.world.queryAll("transform").forEach((entity) => {
      const meshComp = entity.getComponent<MeshComponent>("mesh");
      if (!meshComp || !meshComp.mesh) return;

      const transform = entity.getComponent<TransformComponent>("transform")!;
      const materialComp = entity.getComponent<MaterialComponent>("material");
      const material = materialComp?.material ?? new Material(`${entity.id}:material`);

      seen.add(entity.id);
      this.renderer.createMeshResources(meshComp.mesh);
      this.renderer.createMaterialResources(material);

      const renderable = this.renderables.get(entity.id);
      if (!renderable) {
        this.renderables.set(entity.id, {
          id: entity.id,
          mesh: meshComp.mesh,
          material,
          worldMatrix: Mat4.clone(transform.getWorldMatrix()),
          boundingSphereRadius: computeRadius(meshComp.mesh),
          boundingSphereCenter: Vec3.create(),
          visible: meshComp.visible,
          castShadow: meshComp.castShadow,
        });
      } else {
        renderable.mesh = meshComp.mesh;
        renderable.material = material;
        renderable.visible = meshComp.visible;
        Mat4.copy(renderable.worldMatrix, transform.getWorldMatrix());
      }
    });

    this.renderables.forEach((renderable, id) => {
      if (!seen.has(id)) {
        this.renderer.destroyMeshResources(renderable.mesh);
        this.renderables.delete(id);
      }
    });
  }

  render(camera: Camera, lights: Light[], clearColor?: Vec3): void {
    this.updateRenderables();
    this.renderer.render(this.getRenderables(), camera, lights, clearColor);
  }

  dispose(): void {
    this.renderables.forEach((renderable) => {
      this.renderer.destroyMeshResources(renderable.mesh);
    });
    this.renderables.clear();
  }
}

function computeRadius(mesh: { primitives: Array<{ positions: Float32Array }> }): number {
  let maxSq = 0;
  for (const primitive of mesh.primitives) {
    const p = primitive.positions;
    for (let i = 0; i < p.length; i += 3) {
      const d = p[i] * p[i] + p[i + 1] * p[i + 1] + p[i + 2] * p[i + 2];
      if (d > maxSq) maxSq = d;
    }
  }
  return Math.sqrt(maxSq);
}
